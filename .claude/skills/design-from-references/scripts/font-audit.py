#!/usr/bin/env python3
"""Audit a font file before committing to it, and check it against real copy.

  python3 font-audit.py Hinato.otf
  python3 font-audit.py Hinato.otf --text "Stop fixing spreadsheets." "<50ms" "100%"
  python3 font-audit.py Hinato.otf --woff2 out/Hinato.woff2

Reports weights, glyph count, coverage gaps, tabular figures, and licence metadata —
the four things that decide whether a display face is usable on a real page.

Requires: pip install fonttools brotli
"""

import argparse
import string
import sys

try:
    from fontTools.ttLib import TTFont
except ImportError:
    sys.exit("fonttools is required:  pip install fonttools brotli")

# Characters that display faces routinely omit and that real copy routinely uses.
RISKY = "–—‘’“”[]{}<>&%$#@/*+=_|~^"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("font")
    ap.add_argument("--text", nargs="*", default=[],
                    help="strings you actually intend to set in this face")
    ap.add_argument("--woff2", metavar="PATH", help="also write a woff2 to PATH")
    args = ap.parse_args()

    f = TTFont(args.font)
    name = f["name"]

    def n(i):
        return name.getDebugName(i) or "—"

    print("── identity ──────────────────────────────────────────")
    for i, label in [(1, "family"), (2, "subfamily"), (4, "full"), (6, "psname")]:
        print(f"  {label:10} {n(i)}")

    print("\n── metrics ───────────────────────────────────────────")
    print(f"  unitsPerEm    {f['head'].unitsPerEm}")
    print(f"  weightClass   {f['OS/2'].usWeightClass}")
    print(f"  numGlyphs     {f['maxp'].numGlyphs}")
    if f["maxp"].numGlyphs < 250:
        print("  ^ small glyph set: this is a display face, not a text family.")
    print("  NOTE: one weight in the file means NEVER set a bold — the browser")
    print("        will synthesise one and display faces blob when it does.")

    feats = set()
    if "GSUB" in f:
        feats = {r.FeatureTag for r in f["GSUB"].table.FeatureList.FeatureRecord}
    print(f"  tabular figures (tnum): {'yes' if 'tnum' in feats else 'NO'}")
    if "tnum" not in feats:
        print("  ^ never use for aligned numeric columns — they will not line up.")
    print(f"  kerning: {'GPOS' if 'GPOS' in f else 'kern' if 'kern' in f else 'NONE'}")

    cmap = f.getBestCmap()
    print("\n── coverage ──────────────────────────────────────────")
    for label, chars in [
        ("UPPER ", string.ascii_uppercase),
        ("lower ", string.ascii_lowercase),
        ("digits", string.digits),
        ("risky ", RISKY),
    ]:
        miss = [c for c in chars if ord(c) not in cmap]
        print(f"  {label} {'complete' if not miss else 'MISSING ' + ' '.join(miss)}")

    if args.text:
        print("\n── your strings ──────────────────────────────────────")
        bad = False
        for t in args.text:
            miss = sorted({c for c in t if c != " " and ord(c) not in cmap})
            print(f"  {'OK  ' if not miss else 'FAIL'}  {t!r}"
                  + (f"   missing: {miss}" if miss else ""))
            bad = bad or bool(miss)
        if bad:
            print("  ^ a heading hitting a missing glyph falls back mid-string.")

    print("\n── licence ───────────────────────────────────────────")
    for i, label in [(7, "trademark"), (8, "manufacturer"), (9, "designer"),
                     (11, "vendorURL"), (13, "licence"), (14, "licenceURL")]:
        print(f"  {label:12} {n(i)}")
    if name.getDebugName(13) is None and name.getDebugName(14) is None:
        print("  ^ no embedded licence. Shipping a webfont is distribution —")
        print("    confirm a commercial/webfont licence before launch.")

    if args.woff2:
        f.flavor = "woff2"
        f.save(args.woff2)
        print(f"\nwrote {args.woff2}")


if __name__ == "__main__":
    main()
