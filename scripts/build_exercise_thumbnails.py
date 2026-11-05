"""Статичные миниатюры для GIF упражнений.

Для каждого GIF из переданных JSON (манифест публикации с `new.image_url` или
выгрузка каталога с `image_url`) делает первый кадр в WebP, короткая сторона
168 px — три экранных пикселя на точку миниатюры 56 px, и кладёт в бакет туда,
где его ищет фронт (`front/src/exerciseImage.ts`, правило то же):
- GIF каталога в бакете: `<имя>.thumb.webp` рядом с файлом;
- GIF с другого сайта: `exercises/thumbs/<хост><путь>.thumb.webp`.
База не меняется; нет кадра — фронт покажет сам GIF.

Запуск (нужны Pillow и настроенный yc с доступом к бакету):
    python scripts/build_exercise_thumbnails.py docs/exercise-media/published-20261104.json catalogue.json --upload

Без --upload только собирает кадры и печатает размеры. Повторный запуск безопасен.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from PIL import Image

BUCKET = "gymapp-kpg-photos"
PUBLIC_ROOT = f"https://storage.yandexcloud.net/{BUCKET}/"
CATALOGUE_GIF = re.compile(r"^https://storage\.yandexcloud\.net/gymapp-kpg-photos/(exercises/catalogue/[^?#]+)\.gif$")
THUMBNAIL_SHORT_SIDE = 168
WEBP_QUALITY = 70
CACHE_CONTROL = "public,max-age=31536000,immutable"
# Часть сайтов отказывает клиентам без браузерного User-Agent (HTTP 406).
USER_AGENT = "Mozilla/5.0 (compatible; GymApp thumbnail builder)"


def thumbnail_key(url: str) -> str | None:
    """Ключ кадра в бакете или None, если для этой картинки кадр не нужен."""
    match = CATALOGUE_GIF.match(url)
    if match:
        return f"{match.group(1)}.thumb.webp"
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.query or parsed.fragment or not parsed.path.lower().endswith(".gif"):
        return None
    return f"exercises/thumbs/{parsed.hostname}{parsed.path[:-4]}.thumb.webp"


def image_urls(sources: list[Path]) -> list[str]:
    urls: set[str] = set()
    for source in sources:
        for row in json.loads(source.read_text(encoding="utf-8")):
            for value in ((row.get("new") or {}).get("image_url"), row.get("image_url")):
                if isinstance(value, str) and thumbnail_key(value):
                    urls.add(value)
    return sorted(urls)


def download(url: str, target: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        target.write_bytes(response.read())


def make_thumbnail(gif: Path, target: Path) -> None:
    with Image.open(gif) as image:
        image.seek(0)
        frame = image.convert("RGB")
    scale = THUMBNAIL_SHORT_SIDE / min(frame.size)
    if scale < 1:
        frame = frame.resize((round(frame.width * scale), round(frame.height * scale)), Image.LANCZOS)
    frame.save(target, "WEBP", quality=WEBP_QUALITY, method=6)


def upload(path: Path, key: str) -> None:
    # Вывод yc в лог не пускаем, в журнал идёт только код возврата.
    result = subprocess.run(
        ["yc", "storage", "s3api", "put-object", f"--bucket={BUCKET}", f"--key={key}",
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
    parser.add_argument("sources", type=Path, nargs="+")
    parser.add_argument("--upload", action="store_true")
    parser.add_argument("--keep", type=Path, help="папка, куда сохранить готовые кадры для просмотра")
    args = parser.parse_args()

    urls = image_urls(args.sources)
    done, failed = 0, []
    source_total = thumbnail_total = 0
    with tempfile.TemporaryDirectory() as folder:
        work = Path(folder)
        for index, url in enumerate(urls):
            gif, thumbnail = work / f"{index}.gif", work / f"{index}.webp"
            key = thumbnail_key(url)
            try:
                download(url, gif)
                make_thumbnail(gif, thumbnail)
            except Exception as error:  # Один недоступный файл не должен остановить остальные.
                failed.append(f"{url}: {error}")
                continue
            source_total += gif.stat().st_size
            thumbnail_total += thumbnail.stat().st_size
            if args.keep:
                args.keep.mkdir(parents=True, exist_ok=True)
                (args.keep / f"{index:03d}.webp").write_bytes(thumbnail.read_bytes())
            if args.upload:
                upload(thumbnail, key)
                verify_public(PUBLIC_ROOT + key, thumbnail.read_bytes())
            done += 1
    print(f"{done} of {len(urls)} files: GIF {source_total / 1e6:.1f} MB, thumbnails {thumbnail_total / 1e3:.0f} KB"
          f"{', uploaded and verified' if args.upload else ''}")
    for line in failed:
        print("skipped", line)
    return 1 if failed and not done else 0


if __name__ == "__main__":
    sys.exit(main())
