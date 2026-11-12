"""Vision layer: grounding, model failover, pixel WCAG, path resolution."""
import base64
import io
import json

import pytest
from PIL import Image, ImageDraw

from app import db, seed
from app.engine import vision
from app.engine.visual import resolve_image
from app.settings import settings


@pytest.fixture(autouse=True)
def _db():
    db.init()
    seed.seed()
    seed.ensure_users()
    yield


@pytest.fixture(autouse=True)
def _vision_key():
    old = settings.gemini_api_key
    settings.gemini_api_key = "test-key"
    yield
    settings.gemini_api_key = old


def _png_bytes(draw_fn, size=(320, 180)) -> bytes:
    img = Image.new("RGB", size, (140, 140, 140))
    draw_fn(ImageDraw.Draw(img))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _write_image(tmp_path, draw_fn=None) -> str:
    def _default(d):
        # solid "text bar" stands in for headline glyphs (bitmap fonts are
        # too sparse for the band heuristic to see)
        d.rectangle([8, 8, 140, 24], fill=(130, 130, 130))
    data = _png_bytes(draw_fn or _default)
    from pathlib import Path
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    p = upload_dir / "creative.png"
    p.write_bytes(data)
    return f"/uploads/{p.name}"


FIXTURE = {
    "ocr_text": "SUMMER SALE 50% OFF",
    "logo_present": False,
    "findings": [
        {"category": "visual", "severity": "critical",
         "rule": "Missing brand logo", "excerpt": "logo",
         "suggestion": "Place logo top-right.", "confidence": 0.9,
         "region": "top-right"},
        {"category": "visual", "severity": "warning",
         "rule": "Off-palette headline", "excerpt": "SUMMER SALE 50% OFF",
         "suggestion": "Recolor to #FF6B35.", "confidence": 0.8,
         "region": "top-left"},
        # hallucinated excerpt -> must be dropped by grounding
        {"category": "visual", "severity": "critical",
         "rule": "Fake text", "excerpt": "this text is not in the image",
         "suggestion": "x", "confidence": 0.9, "region": "center"},
        # invalid severity -> dropped
        {"category": "visual", "severity": "bogus",
         "rule": "Bad severity", "excerpt": "logo",
         "suggestion": "x", "confidence": 0.5, "region": "logo"},
    ],
}


def _fake_request_factory(calls: list, response=None, fail_all=False):
    def _fake(model: str, payload: dict) -> dict:
        calls.append(model)
        if fail_all:
            raise RuntimeError("503 high demand")
        return {
            "candidates": [{"content": {"parts": [
                {"text": json.dumps(response or FIXTURE)}]}}],
            "usageMetadata": {"promptTokenCount": 100,
                              "candidatesTokenCount": 50},
        }
    return _fake


def test_no_key_returns_empty(monkeypatch, tmp_path):
    settings.gemini_api_key = ""
    p = _write_image(tmp_path)
    assert vision.check(p) == ([], 0)


def test_missing_file_returns_empty(monkeypatch, tmp_path):
    assert vision.check("/uploads/nope.png") == ([], 0)


def test_grounding_drops_hallucinated_excerpt(monkeypatch, tmp_path):
    p = _write_image(tmp_path)
    monkeypatch.setattr(vision, "_request",
                        _fake_request_factory([]))
    findings, tokens = vision.check(p)
    excerpts = [f["excerpt"] for f in findings]
    assert "this text is not in the image" not in excerpts   # ungrounded
    assert "SUMMER SALE 50% OFF" in excerpts                 # verbatim kept
    assert all(f["severity"] != "bogus" for f in findings)
    assert tokens == 150
    # contrast pass adds deterministic findings too (gray-on-gray)
    assert any("WCAG" in f["rule"] for f in findings)


def test_model_failover_tries_chain(monkeypatch, tmp_path):
    p = _write_image(tmp_path)
    calls: list = []
    settings.gemini_vision_models = "model-a,model-b"
    try:
        # first model fails, second succeeds
        def _fake(model, payload):
            calls.append(model)
            if model == "model-a":
                raise RuntimeError("503")
            return {"candidates": [{"content": {"parts": [
                {"text": json.dumps(FIXTURE)}]}}],
                "usageMetadata": {"promptTokenCount": 10}}
        monkeypatch.setattr(vision, "_request", _fake)
        findings, tokens = vision.check(p)
        assert calls == ["model-a", "model-b"]
        assert findings and tokens == 10
        # all fail -> graceful empty
        calls.clear()
        monkeypatch.setattr(vision, "_request",
                            _fake_request_factory(calls, fail_all=True))
        assert vision.check(p) == ([], 0)
        assert calls == ["model-a", "model-b"]
    finally:
        settings.gemini_vision_models = "gemini-3.8-flash,gemini-flash-lite-latest"


def test_contrast_flags_low_contrast_band():
    def draw(d):
        d.rectangle([0, 0, 320, 45], fill=(140, 140, 140))
        d.rectangle([8, 8, 300, 36], fill=(130, 130, 130))  # text mass
    data = _png_bytes(draw)
    import tempfile, pathlib
    with tempfile.TemporaryDirectory() as td:
        f = pathlib.Path(td) / "x.png"
        f.write_bytes(data)
        out = vision._contrast_findings(f)
    assert out, "low-contrast headline band must be flagged"
    assert "4.5" in out[0]["rule"]
    assert out[0]["evidence"].startswith("Pixel-sampled WCAG")


def test_resolve_image_paths(tmp_path, monkeypatch):
    # file inside upload dir, stored as /uploads/name
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path))
    (tmp_path / "a.png").write_bytes(_png_bytes(lambda d: None))
    assert resolve_image("/uploads/a.png") == tmp_path / "a.png"
    # legacy absolute path still resolves
    assert resolve_image(str(tmp_path / "a.png")) == tmp_path / "a.png"
    assert resolve_image("/uploads/missing.png") is None
    assert resolve_image("") is None


def test_encode_image_downscales_before_upload(tmp_path):
    """Vision payloads are resized/JPEG-encoded, not sent at full resolution."""
    import base64
    import io
    from PIL import Image
    from app.engine.vision import _encode_image

    p = tmp_path / "big.png"
    Image.new("RGB", (3000, 2000), "red").save(p)
    mime, b64 = _encode_image(p)
    assert mime == "image/jpeg"
    with Image.open(io.BytesIO(base64.b64decode(b64))) as im:
        assert max(im.size) <= 1280
