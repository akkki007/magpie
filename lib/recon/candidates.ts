import type { Paise } from "./money";
import {
  addDays,
  daysBetween,
  expectedSettlementDate,
  TOLERANCES,
  type Tolerances,
} from "./tolerance";
import type { BankCredit, LedgerEntry, Payment, Settlement } from "./types";

/**
 * Candidate generation (`docs/recon-plan.md` R2.1).
 *
 * The point of this file is a complexity claim: **matching must not be O(n²)**. 147
 * settlements against 166 bank lines is 24,000 comparisons and nobody would notice. The
 * same code on a real month — 400,000 payments against 30,000 bank lines — is 10^10
 * comparisons and the demo never finishes. Throughput is one of the numbers the track
 * asks for, so the shape of the lookup is part of the deliverable, not an optimisation
 * to do later.
 *
 * So every pass in `match.ts` starts from an index here. A pass may only look at the
 * candidates an index hands it, which also has a second benefit: the candidate set *is*
 * the `inputs[]` of §1.2, so the evidence trail comes out of the lookup for free.
 */

/* ── Reference normalisation ──────────────────────────────────────────────*/

/**
 * A bank reference, reduced to what is comparable.
 *
 * Banks write the same UTR as `RZPX12345678912`, `rzpx 1234 5678 912` and
 * `REF: RZPX12345678912/NEFT`. Case and punctuation carry no information here, and
 * comparing them as-is turns a clean exact match into a fuzzy one for no reason.
 */
export const normaliseReference = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Damerau–Levenshtein distance, abandoned as soon as it exceeds `max`.
 *
 * Plain Levenshtein charges 2 for a transposition, because it can only see a delete and
 * an insert. Damerau charges 1, and a transposition is the typo that actually happens when
 * a human copies a reference off a statement — so this is the difference between catching
 * a transposed UTR at distance 1 and needing a tolerance of 2, which would also let in
 * genuinely different references.
 *
 * `max` is not just an early exit for speed. It is the reason this is safe to run: a
 * bounded distance can never quietly accept a reference that is merely similar.
 */
export function editDistance(a: string, b: string, max: number): number | null {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return null;

  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i++) rows.push(new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) rows[i][0] = i;
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, rows[i - 2][j - 2] + 1);
      }
      rows[i][j] = value;
      best = Math.min(best, value);
    }
    // Every remaining edit can only add cost, so once a whole row is over budget the
    // answer is already known.
    if (best > max) return null;
  }

  const distance = rows[a.length][b.length];
  return distance > max ? null : distance;
}

/* ── The indexes ──────────────────────────────────────────────────────────*/

const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
};

/**
 * An index over records that carry a date, an amount and a reference — which describes
 * both sides of every lane, so one implementation serves all of them.
 *
 * There is no amount *bucket* here, and that is deliberate. Buckets exist to answer "what
 * is near this amount", and near is fuzzy. Every tolerance in this matcher is a
 * **computable** delta instead — plus or minus five paise, or exactly one percent of gross
 * — so the query is a handful of exact probes rather than a range scan over a bucket.
 * Exact probes are faster and, more importantly, they cannot silently widen.
 */
export type Index<T> = {
  all: T[];
  byId: Map<string, T>;
  byReference: Map<string, T[]>;
  byAmount: Map<Paise, T[]>;
  /** Sorted by date, so a window is a binary search rather than a filter. */
  sorted: { date: string; record: T }[];
  /** Records whose date lies in `[from, to]` inclusive. */
  inWindow: (from: string, to: string) => T[];
  /** Records whose amount is exactly `amount`, optionally inside a date window. */
  withAmount: (amount: Paise, window?: { from: string; to: string }) => T[];
  /** Records whose amount is within `slack` paise of `amount`. */
  nearAmount: (amount: Paise, slack: Paise, window?: { from: string; to: string }) => T[];
};

export function buildIndex<T>(
  records: T[],
  read: { id: (r: T) => string; date: (r: T) => string; amount: (r: T) => Paise; reference: (r: T) => string },
): Index<T> {
  const byId = new Map<string, T>();
  const byReference = new Map<string, T[]>();
  const byAmount = new Map<Paise, T[]>();

  for (const record of records) {
    byId.set(read.id(record), record);
    const reference = normaliseReference(read.reference(record));
    if (reference !== "") push(byReference, reference, record);
    push(byAmount, read.amount(record), record);
  }

  const sorted = records
    .map((record) => ({ date: read.date(record), record }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  /** First position whose date is >= `date`. */
  const lowerBound = (date: string) => {
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (sorted[mid].date < date) low = mid + 1;
      else high = mid;
    }
    return low;
  };

  const inWindow = (from: string, to: string) => {
    const out: T[] = [];
    for (let i = lowerBound(from); i < sorted.length && sorted[i].date <= to; i++) {
      out.push(sorted[i].record);
    }
    return out;
  };

  const inDate = (record: T, window?: { from: string; to: string }) =>
    !window || (read.date(record) >= window.from && read.date(record) <= window.to);

  const withAmount = (amount: Paise, window?: { from: string; to: string }) =>
    (byAmount.get(amount) ?? []).filter((record) => inDate(record, window));

  const nearAmount = (amount: Paise, slack: Paise, window?: { from: string; to: string }) => {
    const out: T[] = [];
    for (let delta = -slack; delta <= slack; delta++) {
      for (const record of byAmount.get(amount + delta) ?? []) {
        if (inDate(record, window)) out.push(record);
      }
    }
    return out;
  };

  return { all: records, byId, byReference, byAmount, sorted, inWindow, withAmount, nearAmount };
}

export const indexBank = (bank: BankCredit[]) =>
  buildIndex(bank, {
    id: (c) => c.id,
    date: (c) => c.valueDate,
    amount: (c) => c.amount,
    reference: (c) => c.reference,
  });

export const indexSettlements = (settlements: Settlement[]) =>
  buildIndex(settlements, {
    id: (s) => s.id,
    date: (s) => s.settledAt,
    amount: (s) => s.net,
    reference: (s) => s.utr,
  });

/**
 * Payments, grouped by the date they should have been paid out on.
 *
 * This is the whole candidate set for the payments lane. It is also the only lane where
 * the index does not narrow much: on a busy day, eighty payments all map to one settlement
 * date and every one of them is a candidate for every settlement paid that day.
 */
export function groupPaymentsByPayoutDate(
  payments: Payment[],
  config: Tolerances = TOLERANCES,
): Map<string, Payment[]> {
  const out = new Map<string, Payment[]>();
  for (const payment of payments) {
    push(out, expectedSettlementDate(payment.capturedAt, config), payment);
  }
  return out;
}

/** Ledger lines, grouped into the journals they belong to. */
export function groupJournals(ledger: LedgerEntry[]): Map<string, LedgerEntry[]> {
  const out = new Map<string, LedgerEntry[]>();
  for (const line of ledger) push(out, line.journalId, line);
  return out;
}

/* ── The bounded structural search ────────────────────────────────────────*/

export type SubsetSearch<T> = {
  /** Every distinct subset found, up to `limit`. */
  subsets: T[][];
  nodes: number;
  /**
   * True when the search stopped early — node budget spent, or the space declined as too
   * large before starting.
   *
   * R2.3 asks for this explicitly and §A5 is the reason. "No combination of credits
   * explains this settlement" and "I stopped looking after 200,000 combinations" are
   * different sentences, and only one of them is honest when the second is what happened.
   */
  capHit: boolean;
};

/**
 * Find subsets of `items` whose amounts sum to exactly `target`.
 *
 * Subset-sum is NP-hard, which is why every call site has to bound it: candidates come
 * from an index and a date window, sizes are capped, and the node budget is spent rather
 * than exceeded. §A4 is the payoff — the search *proposes*, but the sum is integer paise
 * and it either ties or it does not, so a structural match is never a judgement call.
 *
 * Stopping at `limit + 1` solutions matters as much as finding the first. One subset that
 * ties is a match; two subsets that both tie is an ambiguity, and the difference between
 * reporting the first and reporting both is the difference between a false match and a
 * proposal a human can settle in ten seconds.
 */
export function findSubsets<T>(
  items: T[],
  amountOf: (item: T) => Paise,
  target: Paise,
  options: {
    maxSize: number;
    /** When set, only subsets of exactly this size count. */
    exactSize?: number;
    maxNodes: number;
    /** Stop after this many solutions; the caller only needs to know "one" or "more". */
    limit?: number;
    /** Items that must appear in every subset — an anchor, usually a reference match. */
    required?: T[];
  },
): SubsetSearch<T> {
  const limit = options.limit ?? 2;
  const required = options.required ?? [];
  const requiredSum = required.reduce((total, item) => total + amountOf(item), 0);

  const pool = items.filter((item) => !required.includes(item) && amountOf(item) > 0);
  // Descending, so the prune below fires on the expensive branches first.
  pool.sort((a, b) => amountOf(b) - amountOf(a));

  const suffix: Paise[] = new Array(pool.length + 1).fill(0);
  for (let i = pool.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + amountOf(pool[i]);

  const remaining = target - requiredSum;
  const subsets: T[][] = [];
  let nodes = 0;
  let capHit = false;

  const minSize = Math.max(0, (options.exactSize ?? 0) - required.length);
  const maxSize = Math.min(options.maxSize - required.length, pool.length);

  if (remaining < 0 || maxSize < minSize) return { subsets, nodes, capHit };
  if (remaining === 0 && minSize === 0) return { subsets: [[...required]], nodes, capHit };

  const chosen: T[] = [];

  const walk = (from: number, left: Paise) => {
    if (capHit || subsets.length > limit) return;
    if (++nodes > options.maxNodes) {
      capHit = true;
      return;
    }
    if (left === 0) {
      if (options.exactSize === undefined || chosen.length === minSize) {
        subsets.push([...required, ...chosen]);
      }
      return;
    }
    if (chosen.length >= maxSize) return;
    // Nothing left in the pool can reach the target, so this branch is dead.
    if (suffix[from] < left) return;

    for (let i = from; i < pool.length; i++) {
      const amount = amountOf(pool[i]);
      if (amount > left) continue;
      if (options.exactSize !== undefined && pool.length - i < minSize - chosen.length) break;
      chosen.push(pool[i]);
      walk(i + 1, left - amount);
      chosen.pop();
      if (capHit || subsets.length > limit) return;
    }
  };

  walk(0, remaining);
  return { subsets, nodes, capHit };
}

/**
 * Whether a partition of `size` out of `total` is small enough to be worth attempting.
 *
 * Choosing 3 of 83 is 92,000 combinations and finishes instantly. Choosing 40 of 83 is
 * about 10^23, and so is its complement, so no node budget makes it tractable — the
 * search would burn its whole cap and return nothing useful. Declining up front and
 * saying so is both faster and more honest than timing out.
 */
export const partitionIsTractable = (total: number, size: number, config: Tolerances = TOLERANCES) =>
  size <= config.search.maxCombinatorialSize ||
  total - size <= config.search.maxCombinatorialSize ||
  total <= config.search.maxCombinatorialSize * 4;

export const windowAround = (date: string, before: number, after: number) => ({
  from: addDays(date, -before),
  to: addDays(date, after),
});

export { daysBetween };
