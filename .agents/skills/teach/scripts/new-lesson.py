#!/usr/bin/env python3
"""Scaffold a lesson file with the standard block shape already in place.

  python3 new-lesson.py <topic-slug> <lesson-slug> "Lesson Title"

Writes learning/<topic>/NN-<lesson>.ts with the next number, and tells you the two
lines to add to the topic's meta.ts. Refuses to overwrite an existing lesson.
"""

import pathlib
import re
import sys

TEMPLATE = '''import type {{ Lesson }} from "../types";

const lesson: Lesson = {{
  slug: "{slug}",
  n: "{n}",
  title: "{title}",
  summary: "ONE LINE — what the reader will be able to do after this.",
  minutes: 9,
  blocks: [
    {{
      kind: "prose",
      text: "Frame the problem in terms of what the reader already knows. Two or three sentences.",
    }},
    {{ kind: "heading", text: "How it actually works", id: "mechanism" }},
    {{
      kind: "prose",
      text: "The mechanism. Say what happens, not how it feels.",
    }},
    {{
      kind: "source",
      path: "REPLACE/with/a/real/path.tsx",
      lines: "1-10",
      note: "REQUIRED — the pointer into this repo that makes the lesson ours.",
    }},
    {{
      kind: "code",
      lang: "tsx",
      file: "REPLACE/with/a/real/path.tsx",
      code: `// real code from the repo, trimmed to what matters`,
    }},
    {{
      kind: "diagram",
      caption: "Say what to LOOK AT, not what the diagram is called.",
      mermaid: `flowchart TD
  A["Start"] --> B{{"Decision"}}
  B -->|"yes"| C["Outcome"]
  B -->|"no"| D["Other outcome"]`,
    }},
    {{
      kind: "callout",
      tone: "key",
      text: "The single load-bearing idea. One per lesson, maximum.",
    }},
    {{
      kind: "callout",
      tone: "warn",
      text: "The trap. Usually the most valuable block in the lesson.",
    }},
    {{
      kind: "docs",
      links: [
        {{ label: "Official docs — the thing", href: "https://", note: "why this link" }},
      ],
    }},
    {{
      kind: "task",
      taskId: "REPLACE — must match an id in learning/path.ts",
      goal: "One line: what exists in this repo after this task that did not before.",
      files: ["REPLACE/with/real/paths.ts"],
      parts: [
        {{
          title: "Part A — ",
          steps: ["", "", ""],
        }},
        {{
          title: "Part B — ",
          steps: ["", "", ""],
        }},
        {{
          title: "Part C — ",
          steps: ["", "", ""],
        }},
      ],
      criteria: [
        "Must be VERIFIABLE — this is literally what the review runs against.",
        "'Handles errors' is unreviewable. 'Returns 404 for a non-member, verified' is.",
      ],
    }},
    {{ kind: "heading", text: "Retrieval Practice", id: "retrieval" }},
    {{
      kind: "quiz",
      question: "Test the mechanism, not the name of the thing.",
      options: ["Plausible wrong belief", "The answer", "Another plausible wrong belief"],
      answer: 1,
      explain: "Explain the MECHANISM. Shown on right and wrong answers alike.",
    }},
  ],
}};

export default lesson;
'''


def main():
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    topic, slug, title = sys.argv[1], sys.argv[2], sys.argv[3]

    root = pathlib.Path(__file__).resolve().parents[4]
    tdir = root / "learning" / topic
    if not tdir.exists():
        sys.exit(f"topic dir not found: {tdir}\nCreate learning/{topic}/meta.ts first.")

    existing = sorted(p for p in tdir.glob("[0-9][0-9]-*.ts"))
    n = f"{len(existing) + 1:02d}"
    out = tdir / f"{n}-{slug}.ts"
    if out.exists():
        sys.exit(f"refusing to overwrite {out}")

    out.write_text(TEMPLATE.format(slug=slug, n=n, title=title, topic=topic))

    var = re.sub(r"-(\w)", lambda m: m.group(1).upper(), slug)
    print(f"wrote {out.relative_to(root)}\n")
    print("Add to learning/%s/meta.ts:" % topic)
    print(f'  import {var} from "./{n}-{slug}";')
    print(f"  ...and append `{var}` to the lessons array.")


if __name__ == "__main__":
    main()
