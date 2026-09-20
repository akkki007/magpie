---
name: blog-writing
description: Write a new post for this portfolio's blog in the house voice. Use whenever asked to draft, write, or add a blog post — especially the "System design for complete beginners" series. Covers voice, structure, frontmatter, the source-vs-original rule, images, and cross-linking.
---

# Writing a blog post for this site

The blog lives in `content/blog/*.md`. Each file is one post: gray-matter frontmatter + Markdown body, rendered by `src/app/blog/[slug]/page.tsx` (marked + a custom heading-id renderer). Study `content/blog/what-is-scaling.md` and `content/blog/what-is-system-design.md` before writing — they define the voice. Match them.

## The one rule that overrides everything

**If the user hands you source material (a course draft, notes, an article, a PRD), it is context — not text to reproduce.** Write an original storyline in this site's voice. Never mirror the source's structure, examples-in-order, or phrasing. The user has corrected this before: *"don't mirror the content, you have to re-write it as a storyline yourself."* Prefer the user's own worked examples (their handwritten notes) as the spine — that's what makes the post theirs — and treat polished third-party drafts only as fact-checking scaffolding.

## Voice

First person, opinionated, and grounded in concrete arithmetic. The reader should feel like a sharp engineer is thinking out loud, not reciting a textbook. Specifically:

- **Numbers over adjectives.** "20 requests per second, and traffic wants 29" beats "high load." Every abstract claim gets a worked figure.
- **Take positions.** Say which option you'd pick and why. Admit where you're less experienced (the scaling post literally says "this is the section I'm least experienced in"). Honesty is part of the brand.
- **Reality checks.** When an estimate is rough, say by how much it's wrong and why that's fine.
- **Short, punchy turns.** One-line paragraphs for emphasis. Em-dashes. Direct address ("Read that again.").
- **Teach the *why*, in sequence.** Each concept exists because the previous one ran out. Never a flat checklist of components.

## Structure (the reliable skeleton)

1. **Cold open** — a sharp observation or a "most explainers do X; here's the honest version." Link back to sibling posts as a series (`[the scaling post](/blog/what-is-scaling)`).
2. **A blockquote definition** for each key term, exactly when it's first needed:
   > **Term** — one-sentence plain-English definition.
3. **Body sections** (`##`) that build on each other. Weave in a single running worked example rather than scattered ones.
4. **Tables** for side-by-side comparisons and cost/number breakdowns.
5. **Fenced code blocks** for the arithmetic itself (plain text is fine — show the calculation steps).
6. **`## If you keep one thing`** — a single bolded takeaway sentence that compresses the whole post.
7. **`## Sources`** — bulleted, honest attributions (including "my own notes," and where you did the math yourself and disagreed with a source).

## Frontmatter (required, exact shape)

```yaml
---
title: "A conversational fragment, not a label"
description: "One-to-three sentences. What the post is and the concrete hook — used for SEO + the card."
date: "YYYY-MM-DD"            # today's date for a new post
tags: ["kebab-case", "system-design", "backend"]
categories: ["Engineering", "System Design"]
cover: "/<slug>/<slug>-cover.png"
---
```

- **Titles are conversational, not descriptive.** Pattern from the series: "One server, and then people showed up", "Twenty per second, and then thirty", "A billion users, on a napkin". Never "What is X" as the title — that idea belongs on the cover, not the `title`.
- **Slug = filename** (`content/blog/<slug>.md`). Keep it `what-is-<topic>` for the series.

## Images

- Post images live in `public/<slug>/`. Reference them from Markdown as `/<slug>/<name>.png` (absolute from `public/`).
- Cover convention: `public/<slug>/<slug>-cover.png`, wired via the `cover:` frontmatter field.
- **Always write descriptive, information-dense alt text** — for a figure like a latency table or a diagram, transcribe the actual content in the alt (it's real SEO + a11y value, and the other posts do this).
- Don't burn time hand-optimising cover images unless asked — copy them in as-is.

## Cross-linking

The posts form a "System design for complete beginners" series. Link between them generously, including deep links to a specific section using the heading slug. Slug rule (from the renderer): lowercase, non-alphanumeric runs → `-`, trimmed. So `## Add more boxes` → `/blog/what-is-scaling#add-more-boxes`.

## Before you finish

- Run `bun run build` and confirm the post prerenders (`.next/server/app/blog/<slug>.html`). The dev server tends to get killed in this sandbox — verify against the build output, not a live server.
- Check the post appears in the blog index and sitemap (both are content-driven — no manual registration needed).
- Comments (utterances) and reading-progress pill are automatic; no per-post wiring.
