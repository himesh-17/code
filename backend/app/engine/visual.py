"""Visual consistency — Pillow dominant colors vs the brand palette.

Covers the proposal's colour-compliance check without Google Vision:
extract the image's top colours, flag any that are far from every
approved brand hex (and flag pure black, which the guidelines ban)."""
from pathlib import Path
import tempfile
from .. import db, storage
from ..settings import settings


def resolve_image(path: str) -> Path | None:
    """DB stores the public URL (/uploads/x.png); the file lives in
    settings.upload_dir (ephemeral on Render) and/or in Supabase Storage.
    Accepts absolute legacy paths too."""
    if not path:
        return None
    p = Path(path)
    if p.is_file():
        return p
    p = Path(settings.upload_dir) / p.name
    if p.is_file():
        return p
    # local copy gone (redeploy) — pull it back from Supabase Storage
    data = storage.fetch(p.name)
    if data is None:
        return None
    tmp = Path(tempfile.gettempdir()) / f"brandguard_{p.name}"
    tmp.write_bytes(data)
    return tmp


def _hex(rgb: tuple[int, int, int]) -> str:
    return "#{:02X}{:02X}{:02X}".format(*rgb)


def _dist(a: str, b: str) -> float:
    """Euclidean distance in RGB space, normalised 0..1."""
    ha, hb = a.lstrip("#"), b.lstrip("#")
    ra, ga, ba = (int(ha[i:i + 2], 16) for i in (0, 2, 4))
    rb, gb, bb = (int(hb[i:i + 2], 16) for i in (0, 2, 4))
    return (((ra - rb) ** 2 + (ga - gb) ** 2 + (ba - bb) ** 2) ** 0.5) / 441.67


def dominant_colors(path: str, k: int = 5) -> list[str]:
    from PIL import Image
    img = Image.open(path).convert("RGB")
    img.thumbnail((200, 200))
    small = img.quantize(colors=k)          # fast palette extraction
    palette = small.getpalette()[: k * 3]
    counts = sorted(small.getcolors() or [], reverse=True)
    out = []
    for _, idx in counts[:k]:
        r, g, b = palette[idx * 3: idx * 3 + 3]
        out.append(_hex((r, g, b)))
    return out


def check(path: str, tolerance: float = 0.18) -> list[dict]:
    """tolerance: max normalised RGB distance (0=strict, 1=anything)."""
    p = resolve_image(path)
    if not p:
        return []
    try:
        colors = dominant_colors(str(p))
    except Exception:
        return []

    with db.get() as conn:
        brand = db.rows(conn, "SELECT hex, name FROM brand_color")
    if not brand:
        return []

    out = []
    for c in colors:
        if c.upper() == "#000000":
            out.append({
                "category": "visual", "severity": "warning",
                "rule": "Pure black #000000 is banned — use Ink #0F172A",
                "excerpt": c,
                "suggestion": "Replace #000000 with Ink #0F172A.",
            })
            continue
        nearest = min(brand, key=lambda b: _dist(c, b["hex"]))
        if _dist(c, nearest["hex"]) > tolerance:
            out.append({
                "category": "visual", "severity": "warning",
                "rule": f"Colour {c} outside brand palette "
                        f"(nearest: {nearest['name']} {nearest['hex']})",
                "excerpt": c,
                "suggestion": f"Use an approved brand colour, e.g. "
                              f"{nearest['hex']} ({nearest['name']}).",
            })
    return out
