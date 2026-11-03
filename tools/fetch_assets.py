#!/usr/bin/env python3
"""
Download real, permissively licensed artwork and install it as the 24 DS4 Bridge
controller images (256x256 RGBA PNG) into BOTH:
    mobile app/app/src/main/res/drawable-xxhdpi/
    web simulator/public/assets/

Run:   python tools/fetch_assets.py            (download + build + verify)
       python tools/fetch_assets.py --urls     (just print the download URLs)
       python tools/fetch_assets.py --verify   (only verify the installed files)

Sources (no Sony / PlayStation artwork is used):
  * Kenney "Input Prompts"  - CC0  https://kenney.nl/assets/input-prompts
  * Kenney "Game Icons"     - CC0  https://kenney.nl/assets/game-icons
  * Tabler Icons            - MIT  https://github.com/tabler/tabler-icons
See ASSETS_LICENSE.md.

Requirements: Python 3.9+, Pillow. For crisp vector rendering install ONE of:
  pip install pymupdf        (easiest on Windows)   |   pip install cairosvg
  or have `rsvg-convert` on PATH. Without any of them Kenney PNG "Double" (128 px)
  files are upscaled instead, and the Tabler USB/Wi-Fi badges cannot be rendered.
"""
from __future__ import annotations

import io
import json
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required:  pip install pillow")

ROOT = Path(__file__).resolve().parent.parent
CACHE = Path(__file__).resolve().parent / ".asset_cache"
DEST_DIRS = [
    ROOT / "mobile app/app/src/main/res/drawable-xxhdpi",
    ROOT / "web simulator/public/assets",
]
SIZE = 256
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36"

KENNEY_PACKS = {
    "input-prompts": "https://kenney.nl/assets/input-prompts",
    "game-icons": "https://kenney.nl/assets/game-icons",
}
TABLER_VER = "v3.34.0"
TABLER_URL = "https://raw.githubusercontent.com/tabler/tabler-icons/" + TABLER_VER + "/icons/outline/{}.svg"

PS = "input-prompts/PlayStation Series"
GEN = "input-prompts/Generic"

# name -> (kind, source, options)
#   kind "svg"   : vector in a Kenney pack (PNG "Double" used if no rasterizer)
#   kind "png"   : raster in a Kenney pack
#   kind "tabler": Tabler outline icon, rendered white
ASSETS: dict[str, tuple[str, str, dict]] = {
    "btn_cross":    ("svg", f"{PS}/Vector/playstation_button_color_cross.svg", {}),
    "btn_circle":   ("svg", f"{PS}/Vector/playstation_button_color_circle.svg", {}),
    "btn_square":   ("svg", f"{PS}/Vector/playstation_button_color_square.svg", {}),
    "btn_triangle": ("svg", f"{PS}/Vector/playstation_button_color_triangle.svg", {}),
    # One coherent solid arrow set from Kenney Game Icons
    "dpad_up":      ("png", "game-icons/PNG/White/2x/arrowUp.png", {"fit": 0.80}),
    "dpad_down":      ("png", "game-icons/PNG/White/2x/arrowDown.png", {"fit": 0.80}),
    "dpad_left":      ("png", "game-icons/PNG/White/2x/arrowLeft.png", {"fit": 0.80}),
    "dpad_right":      ("png", "game-icons/PNG/White/2x/arrowRight.png", {"fit": 0.80}),
    "btn_l1":       ("svg", f"{PS}/Vector/playstation_trigger_l1.svg", {}),
    "btn_r1":       ("svg", f"{PS}/Vector/playstation_trigger_r1.svg", {}),
    "btn_l2":       ("svg", f"{PS}/Vector/playstation_trigger_l2.svg", {}),
    "btn_r2":       ("svg", f"{PS}/Vector/playstation_trigger_r2.svg", {}),
    "btn_l3":       ("svg", f"{PS}/Vector/playstation_button_l3.svg", {}),
    "btn_r3":       ("svg", f"{PS}/Vector/playstation_button_r3.svg", {}),
    # Clean glyphs, no baked-in text (Kenney Game Icons, CC0)
    "btn_share":    ("png", "game-icons/PNG/White/2x/share2.png", {"fit": 0.84}),
    "btn_options":  ("png", "game-icons/PNG/White/2x/barsHorizontal.png", {"fit": 0.84}),
    # Kenney "Game Icons" house glyph (the PlayStation logo is a Sony trademark and is not used)
    "btn_ps":       ("png", "game-icons/PNG/White/2x/home.png", {}),
    # Rounded rectangle split by a centre line = DS4 touchpad (Tabler Icons, MIT)
    "btn_touchpad": ("tabler", "layout-columns", {"fit": 0.9}),
    # Matching pair: outlined ring (base) + cap with a ring and centre dot (Kenney Game Icons "target")
    "stick_base":   ("svg", f"{GEN}/Vector/generic_button_circle_outline.svg", {"fit": 0.98}),
    "stick_cap":    ("png", "game-icons/PNG/White/2x/target.png", {"fit": 0.98}),
    "ic_settings":  ("png", "game-icons/PNG/White/2x/gear.png", {}),
    "logo_app":     ("png", "game-icons/PNG/White/2x/gamepad.png", {"fit": 0.94}),
    "ic_badge_usb": ("tabler", "usb", {}),
    "ic_badge_wifi": ("tabler", "wifi", {}),
}


# ----------------------------------------------------------------------------- download
def kenney_download_url(pack: str) -> str:
    """Same signed-link flow used by the 'Download' button on kenney.nl."""
    hid = ("assets/" + pack).encode().hex()
    req = urllib.request.Request(
        "https://kenney.nl/download-link/" + hid,
        headers={"User-Agent": UA, "Referer": KENNEY_PACKS[pack]},
    )
    return json.load(urllib.request.urlopen(req, timeout=30))["url"]


def fetch(url: str, headers: dict | None = None) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    return urllib.request.urlopen(req, timeout=120).read()


def print_urls() -> None:
    print("Pages (click 'Download' / 'Continue without donating'):")
    for pack, page in KENNEY_PACKS.items():
        print(f"  Kenney {pack:14s} {page}   (CC0)")
    for name in sorted({v[1] for v in ASSETS.values() if v[0] == 'tabler'}):
        print(f"  Tabler {name:14s} {TABLER_URL.format(name)}   (MIT)")
    print("\nThis script resolves the signed Kenney zip link automatically:")
    for pack in KENNEY_PACKS:
        print(f"  GET https://kenney.nl/download-link/{('assets/' + pack).encode().hex()}")


def prepare_sources() -> Path:
    CACHE.mkdir(exist_ok=True)
    for pack in KENNEY_PACKS:
        target = CACHE / pack
        if target.exists():
            continue
        print(f"Downloading Kenney {pack} ...")
        data = fetch(kenney_download_url(pack))
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            zf.extractall(target)
    for name in {v[1] for v in ASSETS.values() if v[0] == "tabler"}:
        f = CACHE / f"tabler_{name}.svg"
        if not f.exists():
            print(f"Downloading Tabler {name} ...")
            f.write_bytes(fetch(TABLER_URL.format(name)))
    return CACHE


# ----------------------------------------------------------------------------- rendering
def render_svg(svg_path: Path, px: int) -> Image.Image | None:
    """Rasterize SVG with the first available backend, or return None."""
    if shutil.which("rsvg-convert"):
        out = subprocess.run(
            ["rsvg-convert", "-w", str(px), "-h", str(px), "--keep-aspect-ratio", str(svg_path)],
            capture_output=True, check=True,
        ).stdout
        return Image.open(io.BytesIO(out)).convert("RGBA")
    try:
        import cairosvg  # type: ignore
        return Image.open(io.BytesIO(cairosvg.svg2png(url=str(svg_path), output_width=px))).convert("RGBA")
    except Exception:
        pass
    try:
        import fitz  # type: ignore  (PyMuPDF)
        doc = fitz.open(str(svg_path))
        page = doc[0]
        zoom = px / max(page.rect.width, page.rect.height)
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=True)
        return Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGBA")
    except Exception:
        return None


def kenney_png_fallback(svg_rel: str) -> Path | None:
    p = Path(svg_rel)
    for variant in ("Double", "Default"):
        cand = CACHE / p.parent.parent / variant / (p.stem + ".png")
        if cand.exists():
            return cand
    return None


def normalize(im: Image.Image, fit: float = 0.86) -> Image.Image:
    """Crop to content, scale to fit inside `fit*SIZE`, centre on a transparent canvas."""
    im = im.convert("RGBA")
    bbox = im.getchannel("A").getbbox()
    if bbox is None:
        raise ValueError("source image is fully transparent")
    im = im.crop(bbox)
    box = int(SIZE * fit)
    scale = box / max(im.size)
    im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    canvas.alpha_composite(im, ((SIZE - im.width) // 2, (SIZE - im.height) // 2))
    return canvas


def build_one(name: str, kind: str, src: str, opts: dict) -> Image.Image:
    fit = opts.get("fit", 0.86)
    if kind == "svg":
        svg = CACHE / src
        im = render_svg(svg, 768)
        if im is None:
            fb = kenney_png_fallback(src)
            if fb is None:
                raise RuntimeError("no SVG rasterizer (pip install pymupdf) and no PNG fallback")
            im = Image.open(fb).convert("RGBA")
        return normalize(im, fit)
    if kind == "png":
        return normalize(Image.open(CACHE / src), fit)
    if kind == "tabler":
        f = CACHE / f"tabler_{src}.svg"
        text = f.read_text(encoding="utf-8").replace("currentColor", "#FFFFFF").replace('stroke-width="2"', 'stroke-width="2.4"')
        tmp = CACHE / f"tabler_{src}_white.svg"
        tmp.write_text(text, encoding="utf-8")
        im = render_svg(tmp, 768)
        if im is None:
            raise RuntimeError("Tabler icons need an SVG rasterizer: pip install pymupdf (or cairosvg)")
        return normalize(im, fit)
    raise ValueError(kind)


# ----------------------------------------------------------------------------- verify
def verify() -> bool:
    print(f"\n{'file':20s} {'dir':9s} {'bytes':>7s} {'size':>9s} {'alpha':>5s} {'opaque%':>8s}  result")
    ok_all = True
    for d in DEST_DIRS:
        tag = "android" if "mobile app" in str(d) else "web"
        for name in ASSETS:
            f = d / f"{name}.png"
            problems = []
            nbytes, size, has_alpha, pct = 0, "-", False, 0.0
            if not f.exists():
                problems.append("missing")
            else:
                raw = f.read_bytes()
                nbytes = len(raw)
                if raw[:8] != b"\x89PNG\r\n\x1a\n":
                    problems.append("not a PNG")
                if nbytes <= 1024:
                    problems.append("<=1KB")
                try:
                    im = Image.open(f)
                    im.load()
                    size = f"{im.width}x{im.height}"
                    has_alpha = im.mode in ("RGBA", "LA") or "transparency" in im.info
                    if not has_alpha:
                        problems.append("no alpha")
                    else:
                        a = im.convert("RGBA").getchannel("A")
                        pct = 100.0 * sum(1 for v in a.getdata() if v > 0) / (im.width * im.height)
                        if a.getbbox() is None:
                            problems.append("blank")
                    if (im.width, im.height) != (SIZE, SIZE):
                        problems.append("not 256x256")
                except Exception as e:  # noqa: BLE001
                    problems.append(f"unreadable: {e}")
            ok = not problems
            ok_all &= ok
            print(f"{name+'.png':20s} {tag:9s} {nbytes:7d} {size:>9s} {str(has_alpha):>5s} {pct:7.1f}%  "
                  + ("PASS" if ok else "FAIL (" + ", ".join(problems) + ")"))
    print("\nOVERALL:", "PASS" if ok_all else "FAIL")
    return ok_all


# ----------------------------------------------------------------------------- main
def main() -> int:
    args = set(sys.argv[1:])
    if "--urls" in args:
        print_urls()
        return 0
    if "--verify" in args:
        return 0 if verify() else 1
    try:
        prepare_sources()
    except Exception as e:  # noqa: BLE001
        print(f"\nDOWNLOAD FAILED: {e}\nNo files were changed. Download manually:\n")
        print_urls()
        return 2
    built: dict[str, Image.Image] = {}
    for name, (kind, src, opts) in ASSETS.items():
        try:
            built[name] = build_one(name, kind, src, opts)
        except Exception as e:  # noqa: BLE001
            print(f"FAILED to build {name}: {e}")
            return 3
    for d in DEST_DIRS:
        d.mkdir(parents=True, exist_ok=True)
        for name, im in built.items():
            im.save(d / f"{name}.png", optimize=True)
    return 0 if verify() else 1


if __name__ == "__main__":
    sys.exit(main())
