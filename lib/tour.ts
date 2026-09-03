/**
 * The demo tour (`bun run dev` then any app page with `?tour=1`).
 *
 * A hackathon submission needs a walkthrough, and a walkthrough recorded by hand is
 * different every take — a missed click, a different order, a screen nobody explained.
 * This makes the run deterministic: the same steps, the same order, the same words on
 * screen, so recording it is one take and re-recording it after a change is free.
 *
 * **It is a script over the real product, not a mock.** Every step points at an element
 * that is really there, on a page really reading Postgres. A tour that drew its own
 * screenshots would be a slide deck, and it would rot the first time a screen changed —
 * whereas this one *fails visibly*, because a step whose element is missing is skipped and
 * counted, and `TOUR` is checked against the DOM at runtime.
 *
 * Steps are grouped by route. The runner plays every step for the current path, then
 * navigates to the next path with the step index in the URL, which is what lets one tour
 * cross four pages without holding state anywhere it could get lost on a reload.
 */

export type TourStep = {
  /** The route this step plays on. */
  path: string;
  /**
   * `[data-tour="..."]`, or null to centre the popover on the page.
   *
   * **Aim small.** driver.js dims the page and cuts a hole around the target, so pointing at
   * a full-height container cuts a hole the size of the viewport — nothing reads as
   * highlighted, and the popover has nowhere sensible to sit. The first pass targeted the
   * whole grid and looked, correctly, like the tour was doing nothing.
   */
  target: string | null;
  /** Where the popover sits. Defaults to bottom-start, which is wrong for tall targets. */
  side?: "top" | "right" | "bottom" | "left";
  title: string;
  body: string;
};

export const TOUR: TourStep[] = [
  {
    path: "/models",
    target: null,
    title: "Magpie",
    body: "An AI-native finance workspace. A model, the databases that feed it, and boards that report on both — one set of numbers, three surfaces. Everything you are about to see is reading Postgres.",
  },
  {
    path: "/models",
    target: '[data-tour="model-list"]',
    side: "bottom",
    title: "Models live in a list, not in the app",
    body: "There is one model today, which is exactly why the list exists: a product that assumes a single model grows a hundred references to it, and the second one becomes a refactor rather than a row.",
  },
  {
    path: "/models/revenue-model-2026",
    target: '[data-tour="grid-head"]',
    side: "bottom",
    title: "The model itself",
    body: "24 months of a SaaS revenue plan. Formulas are trees of references, never strings — so renaming a variable cannot break the sixty formulas that point at it.",
  },
  {
    path: "/models/revenue-model-2026",
    target: '[aria-label="Scenario"]',
    side: "bottom",
    title: "Scenarios are overlays, not copies",
    body: "A scenario stores only what it changes. Branch from a branch and the nearest override wins — so a downside case does not fork the model, and the base case keeps improving underneath it.",
  },
  {
    path: "/models/revenue-model-2026",
    target: '[aria-label="Add from database"]',
    side: "bottom",
    title: "Pull a series in from a database",
    body: "Pick a table, an aggregation and a date column, and a column of records becomes a variable in the plan — through the same command the grid uses, so it lands in the audit log like any edit.",
  },
  {
    path: "/models/revenue-model-2026",
    target: '[aria-label="Ask the agent"]',
    side: "left",
    title: "The agent proposes; it never writes",
    body: "Ask it to change the model and you get a changeset staged for review, not an edit. Accept and it applies through the same command bus — with an inverse, so you can undo the AI exactly like you undo yourself.",
  },
  {
    path: "/models/revenue-model-2026",
    target: '[aria-label="Version history"]',
    side: "left",
    title: "Every change is one log",
    body: "Human edits, agent proposals and database syncs are all commands with inverses. Undo, redo, version snapshots and rollback are one mechanism rather than four.",
  },
  {
    path: "/databases/customers",
    target: '[data-tour="table-head"]',
    side: "bottom",
    title: "Databases",
    body: "Typed tables — text, currency, date, select. 173 customer records here. This is the data the model variable you saw a moment ago was rolled up from.",
  },
  {
    path: "/boards/financial-performance-overview",
    target: '[data-tour="ask"]',
    side: "bottom",
    title: "Boards: ask in plain language",
    body: "Type a question and the answer lands on the board as a tile. It picks the form too — a question with a one-number answer gets a KPI card, not a bar chart with one bar.",
  },
  {
    path: "/boards/financial-performance-overview",
    target: null,
    title: "One set of numbers",
    body: "A board stores no figures. Every tile is a reference plus a form, resolved on render from the model and the tables — so the board on the wall cannot drift from the plan it reports on.",
  },
];

/**
 * Most targets are `aria-label` selectors rather than `data-tour` attributes.
 *
 * Deliberate: those labels already exist because the controls need them for screen readers,
 * so the tour rides on something the product is obliged to keep rather than on a second set
 * of hooks that only the tour uses — and that only the tour would notice going stale. Where
 * no label existed (a list, a grid container) a `data-tour` attribute was added instead.
 */

/** Steps that play on a given path, with their absolute indices. */
export function stepsFor(path: string): { step: TourStep; index: number }[] {
  return TOUR.map((step, index) => ({ step, index })).filter(({ step }) => step.path === path);
}
