#!/usr/bin/env python3
"""Sample colours out of a design reference image.

Three modes, meant to be used in this order:

  dominant   what the page is mostly made of — surfaces, backgrounds, borders
  region     one element's colours, with near-white filtered out
  saturated  chart series: only saturated pixels inside a plot rectangle

Boxes are "x0,y0,x1,y1" in image pixels.

  python3 probe.py dominant  designs/screen.jpg
  python3 probe.py region    designs/screen.jpg 285,262,340,288 --label "delta badge"
  python3 probe.py saturated designs/screen.jpg 1430,530,1990,900

Requires: pip install pillow
"""

import argparse
import sys
from collections import Counter

try:
    from PIL import Image
except ImportError:
    sys.exit("pillow is required:  pip install pillow")


def hexof(rgb):
    return "#%02x%02x%02x" % rgb


def load(path, box=None):
    im = Image.open(path).convert("RGB")
    return im.crop(box) if box else im


def parse_box(raw):
    try:
        x0, y0, x1, y1 = (int(v) for v in raw.split(","))
    except ValueError:
        sys.exit(f"box must be x0,y0,x1,y1 — got {raw!r}")
    return x0, y0, x1, y1


def dominant(args):
    im = load(args.image)
    w, h = im.size
    total = w * h
    print(f"{args.image}  {w}x{h}")
    for rgb, n in Counter(im.getdata()).most_common(args.top):
        print(f"  {hexof(rgb)}  {n * 100 / total:6.2f}%")
    print(
        "\nnote: a healthy product UI is mostly white here. That is the finding —\n"
        "      real accents are rare, so hunt them with `region`."
    )


def region(args):
    box = parse_box(args.box)
    im = load(args.image, box)
    out = []
    for rgb, n in Counter(im.getdata()).most_common(args.scan):
        if sum(rgb) > args.max_sum:  # skip near-white
            continue
        out.append(f"{hexof(rgb)}({n})")
        if len(out) >= args.top:
            break
    label = args.label or args.box
    print(f"{label}: {' '.join(out) if out else '(nothing below --max-sum)'}")


def saturated(args):
    box = parse_box(args.box)
    im = load(args.image, box)
    hits = Counter()
    for rgb in im.getdata():
        if max(rgb) - min(rgb) > args.min_sat:
            hits[rgb] += 1
    if not hits:
        print("(no saturated pixels — lower --min-sat, or the chart is greyscale)")
        return
    for rgb, n in hits.most_common(args.top):
        print(f"  {hexof(rgb)}  {n}")
    print(
        "\nnote: neighbouring near-identical values are JPEG spread, not distinct\n"
        "      colours. Collapse them to the round value the designer meant."
    )


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="mode", required=True)

    d = sub.add_parser("dominant", help="most common colours in the whole image")
    d.add_argument("image")
    d.add_argument("--top", type=int, default=18)
    d.set_defaults(fn=dominant)

    r = sub.add_parser("region", help="colours in one element, near-white filtered")
    r.add_argument("image")
    r.add_argument("box", help="x0,y0,x1,y1")
    r.add_argument("--label", default=None)
    r.add_argument("--top", type=int, default=8)
    r.add_argument("--scan", type=int, default=80, help="candidates to consider")
    r.add_argument("--max-sum", type=int, default=700,
                   help="skip colours whose R+G+B exceeds this (default 700 ~ near-white)")
    r.set_defaults(fn=region)

    s = sub.add_parser("saturated", help="saturated pixels only — chart series")
    s.add_argument("image")
    s.add_argument("box", help="x0,y0,x1,y1")
    s.add_argument("--top", type=int, default=12)
    s.add_argument("--min-sat", type=int, default=60,
                   help="minimum max(rgb)-min(rgb) to count as saturated")
    s.set_defaults(fn=saturated)

    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
