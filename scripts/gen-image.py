#!/usr/bin/env python3
"""Generate a lesson illustration with Gemini (Nano Banana) and save it as a PNG.

  # a raw prompt
  python3 scripts/gen-image.py --prompt "..." --out public/learning/x.png

  # a Xiaohei illustration: the house style preamble is applied for you
  python3 scripts/gen-image.py --scene "Xiaohei carries one small box over a chalk
    line while a rope drags a pile of larger boxes behind him." \\
    --out public/learning/nextjs-app-router/client-boundary.png

  --dry-run    print the full prompt and exit without calling the API
  --model      default gemini-3.1-flash-image; --model gemini-3-pro-image for detail
  --aspect     default 16:9

Reads GOOGLE_API_KEY from the environment or ./.env. The key is sent only to
generativelanguage.googleapis.com and is never printed, logged, or written to disk.

Stdlib only — no dependencies.
"""

import argparse
import base64
import json
import os
import pathlib
import re
import sys
import urllib.error
import urllib.request

ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions"

# The house style for lesson illustrations. Keep in sync with
# .claude/skills/teach/references/xiaohei-prompts.md
STYLE = """Hand-drawn illustration on a pure white background, 16:9 horizontal.

Style: minimalist black line art, loose confident strokes, no shading, no gradients,
no fill textures. A small black stick figure character ("Xiaohei") is an active
participant in the scene — reacting, choosing, or being affected — never decorative
and never merely standing beside the diagram.

Annotations: a small number of short English labels in handwritten style. Use red for
the thing that goes wrong or the constraint, blue for the correct or intended path,
orange for the key insight. Everything else stays black. Fewer than 8 words of
annotation total.

Composition: generous white space, one clear focal point, readable at 800px wide.
No frames, no borders, no background colour, no drop shadows.

SCENE: """


def load_key() -> str:
    """Env first, then ./.env. Tolerates `KEY = "value"` and a trailing space in the name."""
    key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if key:
        return key.strip().strip("\"'")

    env = pathlib.Path(__file__).resolve().parents[1] / ".env"
    if env.exists():
        for raw in env.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, _, value = line.partition("=")
            if name.strip() in ("GOOGLE_API_KEY", "GEMINI_API_KEY"):
                return value.strip().strip("\"'")

    sys.exit(
        "No API key. Set GOOGLE_API_KEY in the environment or in .env at the repo root."
    )


def find_image(node, depth=0):
    """Walk the response for base64 image bytes.

    The response shape has changed across API versions, so this looks for the data
    rather than trusting one path — and reports what it found if it fails.
    """
    if depth > 12:
        return None
    if isinstance(node, dict):
        for field in ("data", "image_bytes", "bytesBase64Encoded", "b64_json"):
            v = node.get(field)
            if isinstance(v, str) and len(v) > 512:
                return v
        for v in node.values():
            got = find_image(v, depth + 1)
            if got:
                return got
    elif isinstance(node, list):
        for v in node:
            got = find_image(v, depth + 1)
            if got:
                return got
    return None


def outline(node, depth=0):
    """A shape-only sketch of the response, for when no image is found. No values."""
    pad = "  " * depth
    if depth > 4:
        return f"{pad}…\n"
    if isinstance(node, dict):
        out = ""
        for k, v in node.items():
            kind = type(v).__name__
            if isinstance(v, str):
                kind = f"str(len={len(v)})"
            out += f"{pad}{k}: {kind}\n" + outline(v, depth + 1)
        return out
    if isinstance(node, list):
        return f"{pad}[{len(node)} items]\n" + (outline(node[0], depth + 1) if node else "")
    return ""


def check():
    """Is image generation actually available on this key? Free tier says no."""
    key = load_key()
    req = urllib.request.Request(
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
        headers={"x-goog-api-key": key},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            models = json.loads(r.read()).get("models", [])
    except urllib.error.HTTPError as e:
        sys.exit(f"Key rejected: HTTP {e.code}\n{e.read().decode(errors='replace')[:400]}")

    names = [m["name"].split("/")[-1] for m in models if "image" in m["name"]]
    print(f"key valid — {len(models)} models visible")
    print("image models listed:", ", ".join(names) or "none")

    probe = json.dumps(
        {
            "model": "gemini-3.1-flash-image",
            "input": [{"type": "text", "text": "a single black dot"}],
            "response_format": {"type": "image", "mime_type": "image/jpeg",
                                "aspect_ratio": "1:1", "image_size": "1K"},
        }
    ).encode()
    try:
        urllib.request.urlopen(
            urllib.request.Request(
                ENDPOINT, data=probe,
                headers={"content-type": "application/json", "x-goog-api-key": key}),
            timeout=120,
        )
        print("\nimage generation: WORKING")
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        if e.code == 429 and "limit: 0" in detail:
            print(
                "\nimage generation: NOT AVAILABLE on this key.\n"
                "  Every image model reports free-tier quota `limit: 0`, which means\n"
                "  image generation is a paid feature — it needs billing enabled on the\n"
                "  Google Cloud project behind this key, not a bigger free quota.\n"
                "  Enable it at https://aistudio.google.com/apikey (Set up billing),\n"
                "  then re-run this check."
            )
        else:
            print(f"\nimage generation failed: HTTP {e.code}\n{detail[:500]}")


def main():
    if "--check" in sys.argv:
        return check()

    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--prompt", help="the complete prompt, used verbatim")
    g.add_argument("--scene", help="a Xiaohei scene; the house style is prepended")
    ap.add_argument("--out", required=True, help="output path, .png")
    ap.add_argument("--model", default="gemini-3.1-flash-image")
    ap.add_argument("--aspect", default="16:9")
    ap.add_argument("--size", default="2K")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    prompt = args.prompt if args.prompt else STYLE + re.sub(r"\s+", " ", args.scene).strip()

    if args.dry_run:
        print(prompt)
        return

    body = json.dumps(
        {
            "model": args.model,
            "input": [{"type": "text", "text": prompt}],
            "response_format": {
                "type": "image",
                # The API only returns JPEG. If --out asks for .png we convert
                # below; the JPEG artefacts are already baked in by then, so
                # prefer .jpg for photographic scenes and .png only when the
                # file has to sit on a transparent-ish background.
                "mime_type": "image/jpeg",
                "aspect_ratio": args.aspect,
                "image_size": args.size,
            },
        }
    ).encode()

    req = urllib.request.Request(
        ENDPOINT,
        data=body,
        headers={"content-type": "application/json", "x-goog-api-key": load_key()},
    )

    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            payload = json.loads(r.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:1200]
        # Never echo the key; the URL carries no credentials.
        sys.exit(f"API returned HTTP {e.code}\n\n{detail}")
    except urllib.error.URLError as e:
        sys.exit(f"Could not reach the API: {e.reason}")

    b64 = find_image(payload)
    if not b64:
        sys.exit(
            "No image in the response. Structure was:\n\n"
            + outline(payload)
            + "\nIf the API shape changed, update find_image() in this script."
        )

    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    raw = base64.b64decode(b64)

    if out.suffix.lower() == ".png":
        try:
            import io

            from PIL import Image

            Image.open(io.BytesIO(raw)).convert("RGB").save(out, "PNG", optimize=True)
        except ImportError:
            out = out.with_suffix(".jpg")
            out.write_bytes(raw)
            print("pillow not installed — saved as .jpg instead", file=sys.stderr)
    else:
        out.write_bytes(raw)

    print(f"wrote {out}  ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
