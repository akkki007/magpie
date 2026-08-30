# Magpie Design System

Derived from `designs/proto-screen-1..3` and `designs/modelling-1`. This file is the
**source of truth for taste**. Tokens are mirrored in `app/globals.css` as CSS variables
and consumed through Tailwind. Never hardcode a hex outside `globals.css`.

---

## 1. The taste, in one paragraph

Quiet, dense, white. A finance instrument, not a marketing site. The UI recedes so the
numbers are the only thing with contrast. Hairline borders instead of shadows, near-black
type instead of pure black, and a palette with exactly two jobs in it: **blue-400
(`#60a5fa`)** for the things you press, and **violet (`#6751d7`)** for the things the
product wrote — formulas, sparklines, the assistant. Charts are a teal-to-navy ramp so a
six-series chart still reads as one material. Organisational labels are pastel
"highlighter" chips. Everything is calm until a number changes.

Magpie: black, white, and one flash of blue. The mark is literal about it.

**Six rules that must survive every screen:**

1. **White surfaces on an off-white page.** Cards float on `#F8F8FA`; they are `#FFFFFF`
   with a 1px `#EDEDED` border and effectively no shadow.
2. **Two hues, split by authorship.** Blue = interactive (buttons, links, focus, the
   mark). Violet = machine-authored (formula pills, sparklines, the orb, AI proposals).
   Nothing else gets a hue unless it is a delta or a grouping chip. *This corrects an
   earlier draft that called blue the only accent: the prototypes were violet in every one
   of those places, and the screens are the ground truth.*
3. **Blue-400 is the signature; deeper steps exist only for legibility.** `#60a5fa` is the
   hue people should remember. Solid fills that carry white text step down to `blue-600`
   (`#2563eb`, 5.2:1 on white) because `blue-400` under white text is ~2.3:1 and fails
   AA. The identity is the 400; the contrast is the 600.
4. **Dense inside data, generous around it.** Table rows are 28–32px with 12px tabular
   text; page sections breathe at 96–128px.
5. **Hairlines, not shadows.** Elevation is a border-weight change, not a blur.
6. **Colour is information.** Green/red only for deltas. Pastel chips only for grouping.

---

## 2. Colour tokens

### Neutrals
| Token | Hex | Use |
|---|---|---|
| `--bg-app` | `#F8F8FA` | Page background, icon rail |
| `--bg-surface` | `#FFFFFF` | Cards, panels, table body |
| `--bg-subtle` | `#FAFAFC` | Chat panel, inset areas |
| `--bg-muted` | `#F4F4F6` | Secondary button, table header |
| `--bg-hover` | `#F0F0F2` | Row / control hover |
| `--border` | `#EDEDED` | Default hairline |
| `--border-strong` | `#DDDDDD` | Secondary button, focus ring base |
| `--text-primary` | `#1C1C1C` | Headings, numbers |
| `--text-secondary` | `#232325` | Body copy |
| `--text-muted` | `#737373` | Labels, captions |
| `--text-faint` | `#A0A0A4` | Placeholders, disabled |

### Brand — blue
| Token | Hex | Use |
|---|---|---|
| `--color-blue-50` | `#EFF6FF` | Faintest AI wash |
| `--color-blue-100` | `#DBEAFE` | Formula pill background |
| `--color-blue-200` | `#BFDBFE` | Formula pill border, focus ring |
| `--color-blue-300` | `#93C5FD` | Chart fills, subtle accents |
| `--color-blue-400` | `#60A5FA` | **The signature hue** — sparklines, the mark, accents |
| `--color-blue-500` | `#3B82F6` | Hover on light fills |
| `--color-blue-600` | `#2563EB` | **Primary button, accent text on white** |
| `--color-blue-700` | `#1D4ED8` | Pressed |
| `--color-orb-from` / `--color-orb-to` | `#2563EB` → `#60A5FA` | Logo orb, AI avatar |

### Machine-authored — violet
| Token | Hex | Use |
|---|---|---|
| `--color-violet-50` | `#F7F3FF` | Time-context chip |
| `--color-violet-100` | `#F0EAFC` | **Formula pill fill** |
| `--color-violet-200` | `#DDD2F8` | Borders on violet surfaces |
| `--color-violet-400` | `#7866D6` | **Sparkline stroke** |
| `--color-violet-500` | `#6751D7` | AI series in a chart |
| `--color-violet-700` | `#542CB1` | The one solid AI action ("Compare") |
| `--color-orb-hi` / `-to` / `-from` | `#EED2F8` → `#B06AB2` → `#9A56B9` | The assistant orb |

**Blue is interactive; violet is machine-authored.** Buttons, links, focus rings and the
mark are blue — things *you* press. Formula pills, sparklines, the assistant orb and
AI-proposed values are violet — things the *product* wrote. Sampled from
`designs/proto-screen-3.jpg` and `designs/modelling-1.jpg`, where every one of them is
violet rather than the blue an earlier draft of this file claimed.

Keeping the two apart is not decoration: it is what stops an AI-proposed number from
looking like something you can click, and a button from looking like something a model
generated. If a new element is ambiguous, ask who authored it.

### Data visualisation (categorical, in order)
`#1781BD` blue → `#3DB6AD` teal → `#CCE5CF` pale green → `#396799` navy →
`#76D8BF` mint → `#4AA1A8` deep teal.
Sampled from the chart legends in `designs/proto-screen-1.jpg`. A ramp, not a rainbow:
series separate by *value* as much as by hue, which is what makes a six-series chart
survive being printed in greyscale. Six is the cap; beyond that, group into "Other".
A slice or series with a meaning of its own names its colour explicitly rather than
taking whatever the ramp's third entry happens to be.

### Semantic
| Token | Hex | Use |
|---|---|---|
| `--pos-bg` / `--pos-fg` | `#D3F9E4` / `#3E9F69` | Positive delta badge |
| `--neg-bg` / `--neg-fg` | `#FFEBEE` / `#C91425` | Negative delta badge |

### Label chips (grouping / highlighter)
`#FFE591` amber · `#FFCFCB` rose · `#D8D8D8` graphite · `#D5EAFE` sky · `#BFDBFE` blue.
Text on chips is `--text-primary` at 11px/600. Radius 5px. These are *organisational*,
never semantic.

---

## 3. Typography

Two families, split by role:

- **Hinato** — the heading face for **marketing surfaces only**: the hero H1, section H2s,
  the CTA H2, and the trust-strip figures. Utility: `font-heading`. Self-hosted woff2 via
  `next/font/local`.
- **Inter** (UI + body) and **Inter Tight** (`font-display`) — the wordmark, every product
  surface, and all body copy. `font-feature-settings: "cv11","ss01"`; numerics
  `tabular-nums`.

**The dividing line is marketing vs. product.** Anything that represents the app — the
grid, the dashboard mock, KPI numbers, the wordmark — stays on Inter. Hinato is the voice
of the page around the product, not of the product. This is what keeps the embedded
screenshots reading as a real application rather than as illustration.

**Rules for Hinato — it is a display face, not a family:**

1. **Never set a weight above 400.** It ships one 400 weight; a browser-synthesised bold
   fills in the counters and the face turns to mush.
2. **Tracking is ~`+0.005em`, never negative.** The −0.03em that suits Inter Tight collides
   Hinato's rounded terminals. Its generous sidebearings are part of the design.
3. **Size down ~6–8% against Inter Tight** at the same slot — Hinato runs visually larger.
   Hero 64px (was 68), section H2 38px (was 40), CTA 43px (was 46).
4. **Never for aligned numbers.** No `tnum` feature, so columns will not line up. Marketing
   figures (`100+`, `<50ms`) are fine; data is not.
5. **Missing glyphs: en-dash (`–`) and em-dash (`—`)** — and those are the only gaps;
   brackets, angle brackets, and curly quotes are all present. An em-dash is easy to reach
   for in a headline, and a heading containing one falls back mid-string and looks broken.
   Verify with `.claude/skills/design-from-references/scripts/font-audit.py --text` before
   setting new copy in it.
6. **Licence unverified** — the file credits "Tokokoo Team" with no embedded licence or
   vendor URL. Confirm a webfont/commercial licence before public launch.

| Role | Size / LH | Weight | Tracking |
|---|---|---|---|
| Display XL (hero) | 72 / 1.02 | 700 | -0.035em |
| Display L (page H1) | 56 / 1.05 | 700 | -0.03em |
| H2 (section) | 36 / 1.15 | 600 | -0.025em |
| H3 (card title) | 20 / 1.3 | 600 | -0.015em |
| Body L | 17 / 1.6 | 400 | -0.005em |
| Body | 15 / 1.6 | 400 | 0 |
| UI label | 13 / 1.4 | 500 | 0 |
| Dense / table | 12 / 1.35 | 400–500 | 0 |
| Micro / badge | 11 / 1.2 | 600 | 0.01em |
| KPI number | 40 / 1.1 | 700 | -0.03em |

Headlines are **tight and dark**, never grey. Body copy is the only place greys appear at
length.

---

## 4. Shape, space, elevation

- **Radius:** panel 16 · card 12 · control/input 8 · button 6 · chip 5 · badge 9999.
- **Spacing scale:** 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 · 128.
- **Elevation:**
  - `--elev-0`: none (default; use a border)
  - `--elev-1`: `0 1px 2px rgba(16,16,20,.04)`
  - `--elev-2`: `0 1px 3px rgba(16,16,20,.06), 0 8px 24px rgba(16,16,20,.04)` — floating
    canvas / popovers only.
- **Borders:** always 1px. Emphasis comes from `--border` → `--border-strong`.
- **Focus:** 2px ring `--blue-200` + 1px `--blue-600` border. Never a browser outline.

---

## 5. Components (as seen in the prototypes)

**App shell** — 56px icon rail (`--bg-app`, icons `--text-muted`, active gets a white
rounded-8 tile) · main canvas as a `--elev-2` white card with 12px radius and a 16px gutter
· optional right AI panel ~34% width on `--bg-subtle` with a 1px left border.

**Breadcrumb bar** — 52px, 13px labels, `/` separators in `--text-faint`, object icon
before each crumb, right side holds Share + star + settings as ghost icon buttons.

**KPI card** — 3-up grid inside one bordered card, split by 1px vertical rules (not gaps).
Label 15/500 + info icon + delta badge, then a 40px tabular number.

**Delta badge** — pill, 11/600, `--pos-*` / `--neg-*`.

**Data grid (modelling)** — 32px header, 30px rows, 12px tabular text, 1px row rules, first
column sticky with a disclosure caret + a type glyph (`#` count, `$` currency, `%`), a
`Trend` sparkline column drawn in `--color-blue-400` at 1.25px, a `Formula` column of blue
pills, then a month column per period. Group headers are a full-width row carrying a
pastel label chip. Hover reveals a right-aligned icon cluster on the row.

**Formula pill** — `--color-blue-100` bg, `--color-blue-200` border, radius 5, 12px text.
Inline references inside the formula render as nested chips.

**Buttons** — primary: `--color-blue-600`, white, 13/500, radius 6, 32px tall. Secondary:
`--bg-muted` + `--border-strong`. Ghost: transparent, `--bg-hover` on hover.

**Password input** — the only input with something inside it: a 32px ghost icon button on
the right edge (`--text-faint`, `--text-muted` on hover) that swaps the field between
`password` and `text`. Swap the *attribute*, never mask characters by hand, or password
managers stop recognising the field. The button is hidden until the `.js` class is on
`<html>` — a control that cannot work should not be on screen.

**Toast** — white card, 1px `--border`, radius 12, `--elev-2`, 13px `--text-primary`,
bottom-right, 4s. The one component allowed a real shadow, because it floats above the page
and a hairline alone leaves it looking pasted on. **Toasts confirm; they never instruct.**
"Signed out", "Invite sent", "Copied" — things that already happened and that the user
cannot see. A message that asks the user to *do* something goes next to the thing they must
do: field errors inline under the field, form errors above the button. A validation toast
floats away from its input, vanishes on a timer, and is gone by the time they tab back.
Status colour appears on the icon only, never the surface.

**Chat / agent panel** — user turn as a `--bg-subtle` bubble with 12px radius; assistant
turn as plain prose; a collapsible "Thought for Ns" row with the orb icon; embedded result
cards (charts, task lists) with a drag handle and a pin action; composer with `@` object
chips, an "Auto" model selector, mic, and a circular send button.

---

## 6. Motion

150ms `cubic-bezier(.2,0,0,1)` for hover/press. 220ms for panel and disclosure. AI-produced
content fades in over 300ms with a 4px rise. Sparklines and charts draw once on mount.
No parallax, no scroll-jacking, nothing bouncy — this is a tool people use for eight hours.

---

## 7. Landing-page translation

The marketing surface is the same system, sized up:

- Off-white `--bg-app` page; every proof point is a **real product surface** in a white
  `--elev-2` card, cropped and slightly oversized so density is legible.
- One blue CTA per viewport. Secondary actions are ghost.
- Hero: Display XL, max 2 lines, `--text-primary`; subhead Body L in `--text-muted`,
  max 60ch.
- Section rhythm 128px desktop / 72px mobile; 1200px max content width.
- Chart/data garnish uses the viz ramp — same hue family, separated by value.
- Eyebrow labels use the pastel chip style at 11/600 uppercase.
- Motion on scroll is opacity + 8px rise, once, 300ms. Nothing else moves.
- Dark mode is **not** part of this system yet. The product is a white instrument.
