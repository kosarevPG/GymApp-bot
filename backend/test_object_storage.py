import base64
import unittest
from unittest.mock import patch

import object_storage


ENV = {
    "S3_BUCKET": "bucket",
    "S3_ACCESS_KEY_ID": "AKID",
    "S3_SECRET_ACCESS_KEY": "SECRET",
}
PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n fake").decode()


class ObjectStorageTests(unittest.TestCase):
    def test_rejects_unsupported_type(self):
        with patch.dict("os.environ", ENV, clear=False):
            with self.assertRaises(object_storage.UploadError):
                object_storage.upload_image(PNG, "application/pdf")

    def test_rejects_broken_base64(self):
        with patch.dict("os.environ", ENV, clear=False):
            with self.assertRaises(object_storage.UploadError):
                object_storage.upload_image("not base64!!", "image/png")

    def test_rejects_oversized_image(self):
        payload = base64.b64encode(b"x" * (object_storage.MAX_BYTES + 1)).decode()
        with patch.dict("os.environ", ENV, clear=False):
            with self.assertRaises(object_storage.UploadError) as ctx:
                object_storage.upload_image(payload, "image/jpeg")
        self.assertIn("larger than", str(ctx.exception))

    def test_reports_missing_configuration(self):
        empty = {"S3_BUCKET": "", "S3_ACCESS_KEY_ID": "", "S3_SECRET_ACCESS_KEY": ""}
        with patch.dict("os.environ", empty, clear=False):
            with self.assertRaises(object_storage.UploadError) as ctx:
                object_storage.upload_image(PNG, "image/png")
        self.assertIn("not configured", str(ctx.exception))

    def test_signed_put_carries_expected_headers(self):
        captured = {}

        class FakeResponse:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): return False

        def fake_urlopen(request, timeout=None):
            captured["url"] = request.full_url
            captured["method"] = request.get_method()
            captured["headers"] = {k.lower(): v for k, v in request.headers.items()}
            captured["body"] = request.data
            return FakeResponse()

        with patch.dict("os.environ", ENV, clear=False):
            with patch.object(object_storage, "urlopen", fake_urlopen):
                url = object_storage.upload_image(PNG, "image/png")

        self.assertEqual(captured["method"], "PUT")
        self.assertEqual(captured["body"], base64.b64decode(PNG))
        self.assertTrue(url.startswith("https://storage.yandexcloud.net/bucket/exercises/"))
        self.assertTrue(url.endswith(".png"))
        self.assertEqual(captured["url"], url)

        auth = captured["headers"]["authorization"]
        self.assertIn("AWS4-HMAC-SHA256 Credential=AKID/", auth)
        self.assertIn("/ru-central1/s3/aws4_request", auth)
        self.assertIn(
            "SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date", auth
        )
        # Подпись должна быть посчитана, а не оставлена пустой.
        signature = auth.split("Signature=")[1]
        self.assertEqual(len(signature), 64)

    def test_extension_follows_content_type(self):
        class FakeResponse:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): return False

        with patch.dict("os.environ", ENV, clear=False):
            with patch.object(object_storage, "urlopen", lambda *a, **k: FakeResponse()):
                jpeg = object_storage.upload_image(PNG, "image/jpeg; charset=binary")
                webp = object_storage.upload_image(PNG, "IMAGE/WEBP")

        self.assertTrue(jpeg.endswith(".jpg"))
        self.assertTrue(webp.endswith(".webp"))


if __name__ == "__main__":
    unittest.main()
