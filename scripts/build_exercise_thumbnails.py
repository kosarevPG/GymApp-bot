"""Статичные миниатюры для GIF каталога упражнений.

Для каждого `<имя>.gif` из манифеста публикации делает `<имя>.thumb.webp` (первый
кадр, короткая сторона 168 px — три экранных пикселя на точку миниатюры 56 px) и
кладёт рядом в тот же бакет. Адрес миниатюры фронт выводит из адреса GIF, поэтому
база не меняется; нет файла — фронт покажет сам GIF.

Запуск (нужны Pillow и настроенный yc с доступом к бакету):
    python scripts/build_exercise_thumbnails.py docs/exercise-media/published-20261104.json --upload

Без --upload только собирает файлы и печатает размеры. Повторный запуск безопасен:
содержимое то же, ключ тот же.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from PIL import Image

THUMBNAIL_SHORT_SIDE = 168
WEBP_QUALITY = 70
CACHE_CONTROL = "public,max-age=31536000,immutable"


def catalogue_urls(manifest: Path) -> list[str]:
    rows = json.loads(manifest.read_text(encoding="utf-8"))
    urls = {row["new"]["image_url"] for row in rows if row.get("new", {}).get("image_url")}
    return sorted(url for url in urls if url.endswith(".gif"))


def make_thumbnail(gif: Path, target: Path) -> None:
    with Image.open(gif) as image:
        image.seek(0)
        frame = image.convert("RGB")
    scale = THUMBNAIL_SHORT_SIDE / min(frame.size)
    if scale < 1:
        frame = frame.resize((round(frame.width * scale), round(frame.height * scale)), Image.LANCZOS)
    frame.save(target, "WEBP", quality=WEBP_QUALITY, method=6)


def upload(path: Path, bucket: str, key: str) -> None:
    # Вывод yc в лог не пускаем, в журнал идёт только код возврата.
    result = subprocess.run(
        ["yc", "storage", "s3api", "put-object", f"--bucket={bucket}", f"--key={key}",
         f"--body={path}", "--content-type=image/webp", f"--cache-control={CACHE_CONTROL}"],
        capture_output=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"yc put-object failed for {key}: exit {result.returncode}")


def verify_public(url: str, expected: bytes) -> None:
    with urllib.request.urlopen(url, timeout=20) as response:
        body = response.read()
    if hashlib.sha256(body).digest() != hashlib.sha256(expected).digest():
        raise RuntimeError(f"Public copy differs from the built file: {url}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--upload", action="store_true")
    args = parser.parse_args()

    urls = catalogue_urls(args.manifest)
    source_total = thumbnail_total = 0
    with tempfile.TemporaryDirectory() as folder:
        work = Path(folder)
        for index, url in enumerate(urls):
            gif = work / f"{index}.gif"
            thumbnail = work / f"{index}.webp"
            urllib.request.urlretrieve(url, gif)
            make_thumbnail(gif, thumbnail)
            source_total += gif.stat().st_size
            thumbnail_total += thumbnail.stat().st_size
            if args.upload:
                parts = urlparse(url).path.lstrip("/").split("/", 1)
                bucket, key = parts[0], parts[1].removesuffix(".gif") + ".thumb.webp"
                upload(thumbnail, bucket, key)
                verify_public(url.removesuffix(".gif") + ".thumb.webp", thumbnail.read_bytes())
    print(f"{len(urls)} files: GIF {source_total / 1e6:.1f} MB, thumbnails {thumbnail_total / 1e3:.0f} KB"
          f"{', uploaded and verified' if args.upload else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
