/**
 * `bun run tour:check` — every tour step points at something that exists.
 *
 * A walkthrough fails in the worst possible place: halfway through a take, on a screen you
 * are narrating, because a div was renamed three commits ago. There is no type connecting a
 * CSS selector to the markup it matches, so this is the thing that has to notice.
 *
 * Static rather than a browser run: it checks that each selector's literal target appears in
 * the source, and that each step's route has a page. That is weaker than querying a live DOM
 * — a conditionally-rendered element would still pass — but it runs in a second with no
 * server, and it catches the failure that actually happens, which is a rename.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { TOUR } from "../lib/tour";

const ROOTS = ["app", "components"];

/** `aria-label` → `ariaLabel`, the prop spelling of the same attribute. */
const camel = (attribute: string) =>
  attribute.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (path.endsWith(".tsx") || path.endsWith(".ts")) out.push(path);
  }
  return out;
}

const corpus = ROOTS.flatMap(sources)
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

const problems: string[] = [];
let checked = 0;

for (const [index, step] of TOUR.entries()) {
  const label = `step ${index + 1} (${step.path})`;

  /* The route has to exist, or the tour navigates into a 404 mid-take. */
  const segments = step.path.split("/").filter(Boolean);
  const routeKey = segments[0];
  checked++;
  if (routeKey && !corpus.includes(`/${routeKey}`)) {
    problems.push(`${label}: nothing in the source references /${routeKey}`);
  }

  if (!step.target) continue;

  /* `[attr="value"]` or `[attr$="value"]` → look for the value in the markup. */
  const match = /^\[([a-z-]+)\$?="(.+)"\]$/.exec(step.target);
  checked++;
  if (!match) {
    problems.push(`${label}: "${step.target}" is not a shape this check understands`);
    continue;
  }

  const [, attribute, value] = match;

  /**
   * The value has to appear *in that attribute*, not merely somewhere in the file.
   *
   * The first version searched for the bare string and was vacuous: renaming
   * `aria-label="Ask the agent"` still passed, because a `title="Ask the agent"` on the very
   * next line kept the text in the corpus. Found by mutation-testing this script, which is
   * the only way a check like this gets tested at all.
   *
   * The window is generous because the value may be inside a template literal —
   * `aria-label={`${model.name} variables`}` is the suffix-selector case.
   *
   * Both spellings are accepted, because half these labels reach the DOM through a prop:
   * `<Menu ariaLabel="Add from database">` renders `aria-label` from inside `menu.tsx`, so
   * the hyphenated form never appears at the call site. Requiring it produced a false
   * failure on a step that works perfectly — the second thing mutation-testing this script
   * turned up.
   */
  const attributePattern = new RegExp(
    `(${attribute}|${camel(attribute)})=[^\\n]{0,80}${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
  );
  if (!attributePattern.test(corpus)) {
    problems.push(
      `${label}: no ${attribute} carrying "${value}" in app/ or components/ — renamed?`,
    );
  }
}

/* The tour is a narration: a step with no words is a step nobody can record. */
for (const [index, step] of TOUR.entries()) {
  checked++;
  if (step.title.trim().length === 0 || step.body.trim().length < 40) {
    problems.push(`step ${index + 1}: the copy is too thin to narrate`);
  }
}

console.log(`\n  ${TOUR.length} steps · ${checked} checks`);

if (problems.length > 0) {
  console.log(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.log(`  ✗ ${problem}`);
  console.log();
  process.exit(1);
}

console.log("\n  Every tour step points at something that exists.\n");
console.log("  Record it with:  http://localhost:3000/models?tour=0\n");
