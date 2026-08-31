import { normaliseReference } from "./candidates";
import type { MatchResult, Outcome } from "./match";
import type { BankCredit, FailureClass, Lane, Truth, TruthLink } from "./types";

/**
 * Scoring a run against the answer key (`docs/recon-plan.md` R3.1).
 *
 * This file exists because of one line in the plan: *build the scoreboard before the
 * agent, because everything after is tuning and tuning without a scoreboard is guessing.*
 * Every number here is computed from `truth.json`, which the matcher has never seen.
 *
 * Three decisions shape it.
 *
 * **Precision and recall are measured in opposite directions, and conflating them is how
 * a match rate becomes a lie.** Recall walks the answer key and asks what the matcher did
 * with each link. Precision walks the matcher's auto-applied results and asks whether the
 * answer key backs them. A result the matcher never claimed cannot hurt its precision, and
 * a link the matcher never produced cannot help its recall.
 *
 * **Only `AUTO_MATCHED` results can produce a false match.** A proposal is the matcher
 * saying it does not know; scoring it as a wrong answer would punish exactly the
 * abstention §1.3 wants. So a proposal can cost recall and can never cost precision —
 * which is the incentive the whole design is built around.
 *
 * **The false-match rate is reported on its own and never netted against anything.** A
 * wrong match silently corrupts the books; an exception costs a controller a minute. Those
 * two are not commensurable, so this file never adds them together.
 */

/* ── Indistinguishable records ────────────────────────────────────────────*/

/**
 * A duplicated bank row is byte-identical to its original in every field the statement
 * carries, so *which one is the duplicate* is not a question the data can answer. The
 * matcher keeps the lower id and says so; the answer key happened to record the other.
 *
 * Scoring them as an ordered pair would report a false match that is not one — the worst
 * kind of measurement error, because it makes a correct matcher look dangerous and sends
 * you off tuning something that was never wrong. So every member of an indistinguishable
 * group is folded onto one representative before any comparison happens.
 *
 * This is a *scoring* rule, not a matching rule. The matcher never gets to decide two
 * records are interchangeable.
 */
export function canonicaliser(bank: BankCredit[]): (id: string) => string {
  const groups = new Map<string, BankCredit[]>();
  for (const credit of bank) {
    const key = [
      normaliseReference(credit.reference),
      credit.amount,
      credit.valueDate,
      credit.description.trim().toUpperCase(),
    ].join("|");
    const bucket = groups.get(key);
    if (bucket) bucket.push(credit);
    else groups.set(key, [credit]);
  }

  const representative = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const lowest = [...group].sort((a, b) => (a.id < b.id ? -1 : 1))[0].id;
    for (const credit of group) representative.set(credit.id, lowest);
  }

  return (id: string) => representative.get(id) ?? id;
}

const linkKey = (left: string[], right: string[], canonical: (id: string) => string) =>
  `${[...new Set(left.map(canonical))].sort().join("+")}=>${[...new Set(right.map(canonical))].sort().join("+")}`;

/* ── The verdicts ─────────────────────────────────────────────────────────*/

/** What the matcher did with one link in the answer key. */
export type Verdict =
  /** Auto-applied, and the answer key agrees. */
  | "AUTO_CORRECT"
  /** Proposed the right link, so a human would confirm it in one click. */
  | "PROPOSED_CORRECT"
  /** Raised the exception the answer key expects. */
  | "EXCEPTION_CORRECT"
  /** Auto-applied something the answer key contradicts. The number that matters. */
  | "FALSE_MATCH"
  /** Abstained on records the answer key links, without claiming anything wrong. */
  | "ESCALATED"
  /** Produced nothing at all about these records. */
  | "MISSED";

export type ScoredLink = {
  link: TruthLink;
  verdict: Verdict;
  /** The result that decided the verdict, when there was one. */
  result?: MatchResult;
  /** Set when the link and outcome are right and the failure class is not. */
  classSaid?: FailureClass | null;
};

export type FalseMatchDetail = {
  result: MatchResult;
  /** Why the answer key rejects it. */
  reason: "NOT_IN_TRUTH" | "SHOULD_BE_EXCEPTION";
};

export type LaneScore = {
  lane: Lane;
  /** Links in the answer key, split by what a correct matcher should do with them. */
  truthMatches: number;
  truthExceptions: number;
  /** Results the matcher produced, by outcome. */
  produced: Record<Outcome, number>;

  autoCorrect: number;
  proposedCorrect: number;
  exceptionCorrect: number;
  escalated: number;
  missed: number;
  falseMatches: FalseMatchDetail[];

  /** Auto-applied and right, over everything auto-applied. */
  precision: number;
  /** Auto-applied and right, over every link that should have matched. */
  matchRate: number;
  /** Auto-applied or correctly proposed, over every link that should have matched. */
  coverage: number;
  /** Exceptions correctly raised, over every exception the key expects. */
  exceptionRecall: number;
  /** False matches over everything auto-applied. Never netted against anything. */
  falseMatchRate: number;

  classCorrect: number;
  classWrong: { expected: FailureClass; said: FailureClass | null; rule: string }[];
};

export type ClassScore = {
  failure: FailureClass;
  planted: number;
  /** Links carrying this class that the matcher resolved the way the key expects. */
  resolved: number;
  /** ...and also labelled with the right class. */
  labelled: number;
};

/** Rows are what the answer key expected; columns are what the matcher did. */
export type Confusion = {
  rows: {
    expected: "MATCH" | "EXCEPTION" | "NOT IN KEY";
    auto: number;
    proposed: number;
    exception: number;
    silent: number;
  }[];
};

export type Score = {
  lanes: LaneScore[];
  overall: Omit<LaneScore, "lane">;
  classes: ClassScore[];
  confusion: Confusion;
  scored: ScoredLink[];
};

const ratio = (numerator: number, denominator: number) =>
  denominator === 0 ? 1 : numerator / denominator;

const emptyLane = (lane: Lane): LaneScore => ({
  lane,
  truthMatches: 0,
  truthExceptions: 0,
  produced: { AUTO_MATCHED: 0, PROPOSED: 0, EXCEPTION: 0 },
  autoCorrect: 0,
  proposedCorrect: 0,
  exceptionCorrect: 0,
  escalated: 0,
  missed: 0,
  falseMatches: [],
  precision: 0,
  matchRate: 0,
  coverage: 0,
  exceptionRecall: 0,
  falseMatchRate: 0,
  classCorrect: 0,
  classWrong: [],
});

export function score(
  results: MatchResult[],
  truth: Truth,
  bank: BankCredit[],
): Score {
  const canonical = canonicaliser(bank);

  /* Results indexed two ways: by the exact link they claim, and by every record they
     touch. The first answers "did it produce this link"; the second answers "did it say
     anything at all about these records", which is the difference between an honest
     abstention and a blind spot. */
  const byLink = new Map<string, MatchResult[]>();
  const touching = new Map<string, MatchResult[]>();

  for (const result of results) {
    const key = `${result.lane}|${linkKey(result.left, result.right, canonical)}`;
    const bucket = byLink.get(key);
    if (bucket) bucket.push(result);
    else byLink.set(key, [result]);

    for (const id of [...result.left, ...result.right]) {
      const reference = `${result.lane}|${canonical(id)}`;
      const list = touching.get(reference);
      if (list) list.push(result);
      else touching.set(reference, [result]);
    }
  }

  const lanes = new Map<Lane, LaneScore>();
  const laneOf = (lane: Lane) => {
    const existing = lanes.get(lane);
    if (existing) return existing;
    const fresh = emptyLane(lane);
    lanes.set(lane, fresh);
    return fresh;
  };

  for (const result of results) laneOf(result.lane).produced[result.outcome]++;

  const scored: ScoredLink[] = [];
  /** Results the answer key has accounted for, so precision can find the rest. */
  const claimed = new Set<MatchResult>();

  /* ── Direction one: walk the answer key ───────────────────────────────*/

  for (const link of truth.links) {
    const lane = laneOf(link.lane);
    if (link.expect === "MATCH") lane.truthMatches++;
    else lane.truthExceptions++;

    const exact = byLink.get(`${link.lane}|${linkKey(link.left, link.right, canonical)}`) ?? [];
    const best =
      exact.find((r) => r.outcome === "AUTO_MATCHED") ??
      exact.find((r) => r.outcome === "PROPOSED") ??
      exact.find((r) => r.outcome === "EXCEPTION");

    for (const result of exact) claimed.add(result);

    if (best) {
      const wantsMatch = link.expect === "MATCH";
      const claimsMatch = best.outcome !== "EXCEPTION";

      let verdict: Verdict;
      if (wantsMatch && claimsMatch) {
        verdict = best.outcome === "AUTO_MATCHED" ? "AUTO_CORRECT" : "PROPOSED_CORRECT";
        if (best.outcome === "AUTO_MATCHED") lane.autoCorrect++;
        else lane.proposedCorrect++;
      } else if (!wantsMatch && !claimsMatch) {
        verdict = "EXCEPTION_CORRECT";
        lane.exceptionCorrect++;
      } else if (!wantsMatch && claimsMatch) {
        // The key says raise this; the matcher resolved it. The dangerous direction.
        if (best.outcome === "AUTO_MATCHED") {
          verdict = "FALSE_MATCH";
          lane.falseMatches.push({ result: best, reason: "SHOULD_BE_EXCEPTION" });
        } else {
          verdict = "ESCALATED";
          lane.escalated++;
        }
      } else {
        // The key says match this; the matcher raised it. Costs recall, not precision.
        verdict = "MISSED";
        lane.missed++;
      }

      /**
       * One entry per truth link, always.
       *
       * A class disagreement used to push a *second* entry for the same link, which the
       * confusion matrix and the per-class table both happened to de-duplicate — so the
       * double-count sat there harmlessly until something counted `scored` directly and
       * reported six escalated links as twelve, and a match rate over 100%. A derived array
       * that is only correct when every reader remembers to de-duplicate it is a trap.
       */
      const disagrees = link.class !== null && best.class !== link.class;
      if (disagrees && link.class) {
        lane.classWrong.push({ expected: link.class, said: best.class, rule: best.rule });
      } else if (link.class) {
        lane.classCorrect++;
      }
      scored.push({ link, verdict, result: best, ...(disagrees ? { classSaid: best.class } : {}) });
      continue;
    }

    /* No result claims this exact link. Did the matcher say anything about the records? */
    const nearby = [...new Set([...link.left, ...link.right].flatMap((id) => touching.get(`${link.lane}|${canonical(id)}`) ?? []))];
    const wrongAuto = nearby.find((result) => result.outcome === "AUTO_MATCHED");

    if (wrongAuto) {
      laneOf(link.lane).falseMatches.push({ result: wrongAuto, reason: "NOT_IN_TRUTH" });
      claimed.add(wrongAuto);
      scored.push({ link, verdict: "FALSE_MATCH", result: wrongAuto });
    } else if (nearby.length > 0) {
      for (const result of nearby) claimed.add(result);
      lane.escalated++;
      scored.push({ link, verdict: "ESCALATED", result: nearby[0] });
    } else {
      lane.missed++;
      scored.push({ link, verdict: "MISSED" });
    }
  }

  /* ── Direction two: walk what the matcher auto-applied ────────────────*/

  for (const result of results) {
    if (result.outcome !== "AUTO_MATCHED" || claimed.has(result)) continue;
    laneOf(result.lane).falseMatches.push({ result, reason: "NOT_IN_TRUTH" });
  }

  /* ── Rates ────────────────────────────────────────────────────────────*/

  const finish = (lane: LaneScore) => {
    const auto = lane.produced.AUTO_MATCHED;
    const wrong = new Set(lane.falseMatches.map((entry) => entry.result)).size;
    lane.falseMatches = [...new Map(lane.falseMatches.map((entry) => [entry.result, entry])).values()];
    lane.precision = ratio(auto - wrong, auto);
    lane.matchRate = ratio(lane.autoCorrect, lane.truthMatches);
    lane.coverage = ratio(lane.autoCorrect + lane.proposedCorrect, lane.truthMatches);
    lane.exceptionRecall = ratio(lane.exceptionCorrect, lane.truthExceptions);
    lane.falseMatchRate = auto === 0 ? 0 : wrong / auto;
    return lane;
  };

  const laneScores = [...lanes.values()].map(finish).sort((a, b) => a.lane.localeCompare(b.lane));

  const overall = finish(
    laneScores.reduce((total, lane) => {
      total.truthMatches += lane.truthMatches;
      total.truthExceptions += lane.truthExceptions;
      total.produced.AUTO_MATCHED += lane.produced.AUTO_MATCHED;
      total.produced.PROPOSED += lane.produced.PROPOSED;
      total.produced.EXCEPTION += lane.produced.EXCEPTION;
      total.autoCorrect += lane.autoCorrect;
      total.proposedCorrect += lane.proposedCorrect;
      total.exceptionCorrect += lane.exceptionCorrect;
      total.escalated += lane.escalated;
      total.missed += lane.missed;
      total.falseMatches.push(...lane.falseMatches);
      total.classCorrect += lane.classCorrect;
      total.classWrong.push(...lane.classWrong);
      return total;
    }, emptyLane("SETTLEMENT_TO_BANK")),
  );

  /* ── Per planted class ────────────────────────────────────────────────*/

  const classes: ClassScore[] = (Object.keys(truth.planted) as FailureClass[])
    .filter((failure) => truth.planted[failure] > 0)
    .map((failure) => {
      const links = truth.links.filter((link) => link.class === failure);
      const rows = scored.filter((row) => row.link.class === failure);
      const resolved = rows.filter(
        (row) =>
          row.verdict === "AUTO_CORRECT" ||
          row.verdict === "PROPOSED_CORRECT" ||
          row.verdict === "EXCEPTION_CORRECT",
      );
      return {
        failure,
        planted: links.length,
        resolved: new Set(resolved.map((row) => row.link)).size,
        labelled: new Set(
          resolved.filter((row) => row.result?.class === failure).map((row) => row.link),
        ).size,
      };
    })
    .sort((a, b) => b.planted - a.planted || a.failure.localeCompare(b.failure));

  /* ── Confusion matrix ─────────────────────────────────────────────────*/

  const row = (expected: "MATCH" | "EXCEPTION" | "NOT IN KEY") => ({
    expected,
    auto: 0,
    proposed: 0,
    exception: 0,
    silent: 0,
  });
  const confusion: Confusion = { rows: [row("MATCH"), row("EXCEPTION"), row("NOT IN KEY")] };
  const seen = new Set<TruthLink>();

  for (const entry of scored) {
    if (seen.has(entry.link)) continue;
    seen.add(entry.link);
    const target = entry.link.expect === "MATCH" ? confusion.rows[0] : confusion.rows[1];
    if (!entry.result) target.silent++;
    else if (entry.result.outcome === "AUTO_MATCHED") target.auto++;
    else if (entry.result.outcome === "PROPOSED") target.proposed++;
    else target.exception++;
  }

  for (const result of results) {
    if (claimed.has(result)) continue;
    const target = confusion.rows[2];
    if (result.outcome === "AUTO_MATCHED") target.auto++;
    else if (result.outcome === "PROPOSED") target.proposed++;
    else target.exception++;
  }

  return { lanes: laneScores, overall, classes, confusion, scored };
}
