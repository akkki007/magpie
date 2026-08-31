import { pct, rupees, sum, type Paise } from "./money";
import { chance, int, pick, rng, shuffled, weighted, type Rng } from "./random";
import type {
  Batch,
  BankCredit,
  Chargeback,
  FailureClass,
  LedgerEntry,
  Payment,
  PaymentMethod,
  ReconRow,
  Refund,
  Settlement,
  TruthLink,
} from "./types";

/**
 * The synthetic batch and its answer key (`docs/recon-plan.md` R0.2, R0.3).
 *
 * The generator builds a **clean, internally consistent world first** — every settlement
 * explains its payments, every bank credit matches its settlement, every journal balances
 * — and then *damages* it on purpose, recording each act of damage in the truth file.
 *
 * That order matters. Generating messy data directly means you never know whether an
 * unmatched record is a hard case you planted or a bug in the generator. Build it right,
 * break it deliberately, and the answer key is a by-product rather than a guess.
 *
 * §1.6: if the matcher scores 100% here, the dataset is too easy — not the matcher good.
 */

export type GenerateOptions = {
  /** Number of payments. Everything else scales off this. */
  count: number;
  seed: number;
  /** Days of trading to spread the payments across. */
  days: number;
  /** ISO date the window opens. */
  start: string;
};

export const DEFAULTS: GenerateOptions = {
  count: 5000,
  seed: 42,
  days: 60,
  start: "2026-06-01",
};

/** Gateway pricing, in percent of gross. GST is 18% of the fee, as in India. */
const FEE_PERCENT: Record<PaymentMethod, number> = {
  card: 2.0,
  upi: 0.4,
  netbanking: 1.6,
  wallet: 1.9,
};
const GST_ON_FEE = 18;

/** Payments per settlement batch. Smaller batches → more match units to score. */
const BATCH_SIZE = 40;

/** How much of the batch each failure class should touch. */
const PLANT_SHARE: Record<FailureClass, number> = {
  MISSING_UTR: 0.04,
  TYPO_UTR: 0.03,
  SPLIT_SETTLEMENT: 0.03,
  COMBINED_CREDIT: 0.04, // consumes two settlements per instance
  TIMING_T_PLUS_N: 0.05,
  ROUNDING_PAISE: 0.03,
  TDS_WITHHELD: 0.03,
  REFUND_NETTED: 0.03,
  FEE_NOT_BOOKED: 0.03,
  MISSING_LEDGER_ENTRY: 0.02,
  // Both of these damage the recon report rather than the bank or the books, so they are
  // the only two classes that can touch the payments lane.
  MISSING_RECON_ROW: 0.03,
  MISATTRIBUTED_PAYMENT: 0.02,
  // R0.5. The first is resolvable by a rule; the other two are the ones the LLM tier
  // exists for, and every instance is worded differently on purpose.
  UTR_IN_NARRATION: 0.03,
  DISGUISED_COUNTERPARTY: 0.02,
  NARRATED_PAYOUT: 0.02,
  DUPLICATE_CREDIT: 0.015,
  FOREIGN_CREDIT: 0.02,
  CHARGEBACK_DEDUCTION: 0.5, // share of chargebacks, not of settlements
};

/* ── Dates ────────────────────────────────────────────────────────────────*/

const DAY = 86_400_000;
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);
const isWeekend = (time: number) => {
  const day = new Date(time).getUTCDay();
  return day === 0 || day === 6;
};

/** T+2, pushed past the weekend — the rule that makes `TIMING_T_PLUS_N` believable. */
function settlementTime(capturedAt: number) {
  let time = capturedAt + 2 * DAY;
  while (isWeekend(time)) time += DAY;
  return time;
}

/* ── Ids ──────────────────────────────────────────────────────────────────*/

const id = (r: Rng, prefix: string, length = 10) => {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(r() * alphabet.length)];
  return `${prefix}_${out}`;
};

const utrFor = (r: Rng) => `RZPX${String(int(r, 100000000, 999999999))}${int(r, 10, 99)}`;

/* ── Generation ───────────────────────────────────────────────────────────*/

export function generateBatch(options: Partial<GenerateOptions> = {}): Batch {
  const config = { ...DEFAULTS, ...options };
  const r = rng(config.seed);
  const startTime = Date.parse(`${config.start}T00:00:00Z`);

  /* 1 ─ Payments. */
  const payments: Payment[] = [];
  const capturedAt = new Map<string, number>();

  for (let i = 0; i < config.count; i++) {
    let day = int(r, 0, config.days - 1);
    // Trading is thinner at the weekend, which also makes the settlement calendar bunch.
    if (isWeekend(startTime + day * DAY) && chance(r, 0.6)) day = Math.max(0, day - 1);
    const time = startTime + day * DAY;

    const method = weighted<PaymentMethod>(r, [
      ["upi", 5],
      ["card", 3],
      ["netbanking", 1.5],
      ["wallet", 0.5],
    ]);

    const gross = weighted<[number, number]>(r, [
      [[99, 999], 50],
      [[1000, 9999], 35],
      [[10000, 99999], 13],
      [[100000, 500000], 2],
    ]);
    const grossPaise = rupees(int(r, gross[0], gross[1])) + (chance(r, 0.4) ? int(r, 1, 99) : 0);
    const fee = pct(grossPaise, FEE_PERCENT[method]);
    const tax = pct(fee, GST_ON_FEE);

    const payment: Payment = {
      id: id(r, "pay"),
      orderId: id(r, "order"),
      capturedAt: iso(time),
      method,
      gross: grossPaise,
      fee,
      tax,
      net: grossPaise - fee - tax,
      status: "captured",
    };
    payments.push(payment);
    capturedAt.set(payment.id, time);
  }

  payments.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));

  /* 2 ─ Refunds and chargebacks against those payments. */
  const refunds: Refund[] = [];
  const chargebacks: Chargeback[] = [];
  /** Which chargebacks are debited separately rather than netted (CHARGEBACK_DEDUCTION). */
  const standaloneChargebacks = new Set<string>();

  for (const payment of payments) {
    if (chance(r, 0.04)) {
      const full = chance(r, 0.6);
      const time = capturedAt.get(payment.id)! + int(r, 1, 6) * DAY;
      refunds.push({
        id: id(r, "rfnd"),
        paymentId: payment.id,
        createdAt: iso(time),
        amount: full ? payment.gross : Math.round(payment.gross * (int(r, 20, 80) / 100)),
        speed: chance(r, 0.2) ? "instant" : "normal",
      });
      payment.status = "refunded";
      continue;
    }

    if (chance(r, 0.006)) {
      const time = capturedAt.get(payment.id)! + int(r, 5, 20) * DAY;
      const chargeback: Chargeback = {
        id: id(r, "disp"),
        paymentId: payment.id,
        raisedAt: iso(time),
        amount: payment.gross,
        status: pick(r, ["open", "lost", "won"] as const),
      };
      chargebacks.push(chargeback);
      payment.status = "disputed";
      // Decided here, before settlements are computed, so the settlement maths stays
      // internally consistent either way.
      if (chance(r, PLANT_SHARE.CHARGEBACK_DEDUCTION)) standaloneChargebacks.add(chargeback.id);
    }
  }

  /* 3 ─ Settlements: group by settlement date, chunk, then net off refunds and
        chargebacks that fall in the same window. */
  const byDate = new Map<string, Payment[]>();
  for (const payment of payments) {
    const date = iso(settlementTime(capturedAt.get(payment.id)!));
    const bucket = byDate.get(date);
    if (bucket) bucket.push(payment);
    else byDate.set(date, [payment]);
  }

  const settlements: Settlement[] = [];
  /** settlementId → the payment ids it covers. The link the matcher has to rediscover. */
  const settlementPayments = new Map<string, string[]>();
  /** Date → the settlements paid out that day, for attaching refunds and chargebacks. */
  const settlementsByDate = new Map<string, Settlement[]>();

  for (const date of [...byDate.keys()].sort()) {
    const bucket = byDate.get(date)!;
    for (let offset = 0; offset < bucket.length; offset += BATCH_SIZE) {
      const slice = bucket.slice(offset, offset + BATCH_SIZE);
      const gross = sum(slice.map((p) => p.gross));
      const fees = sum(slice.map((p) => p.fee));
      const tax = sum(slice.map((p) => p.tax));

      const settlement: Settlement = {
        id: id(r, "setl", 8),
        settledAt: date,
        utr: utrFor(r),
        gross,
        fees,
        tax,
        refunds: 0,
        chargebacks: 0,
        tds: 0,
        net: gross - fees - tax,
        paymentCount: slice.length,
      };

      settlements.push(settlement);
      settlementPayments.set(settlement.id, slice.map((p) => p.id));
      const sameDay = settlementsByDate.get(date);
      if (sameDay) sameDay.push(settlement);
      else settlementsByDate.set(date, [settlement]);
    }
  }

  const attach = (dateIso: string): Settlement | undefined => {
    // The first batch of the day absorbs deductions, which is close enough to how a
    // gateway does it and keeps the arithmetic checkable.
    const onDate = settlementsByDate.get(dateIso);
    if (onDate?.length) return onDate[0];
    const later = [...settlementsByDate.keys()].sort().find((d) => d >= dateIso);
    return later ? settlementsByDate.get(later)![0] : undefined;
  };

  /** settlementId → the refunds and disputes netted out of it, for the recon report. */
  const deductionsOf = new Map<string, { type: "refund" | "chargeback"; id: string; amount: Paise }[]>();
  const deduct = (settlementId: string, entry: { type: "refund" | "chargeback"; id: string; amount: Paise }) => {
    const bucket = deductionsOf.get(settlementId);
    if (bucket) bucket.push(entry);
    else deductionsOf.set(settlementId, [entry]);
  };

  for (const refund of refunds) {
    const target = attach(iso(settlementTime(Date.parse(`${refund.createdAt}T00:00:00Z`))));
    if (!target) continue;
    target.refunds += refund.amount;
    target.net -= refund.amount;
    deduct(target.id, { type: "refund", id: refund.id, amount: refund.amount });
  }

  for (const chargeback of chargebacks) {
    if (standaloneChargebacks.has(chargeback.id)) continue;
    const target = attach(iso(settlementTime(Date.parse(`${chargeback.raisedAt}T00:00:00Z`))));
    if (!target) continue;
    target.chargebacks += chargeback.amount;
    target.net -= chargeback.amount;
    deduct(target.id, { type: "chargeback", id: chargeback.id, amount: chargeback.amount });
  }

  /* 3b ─ The settlement recon report: one row per settled entity.
        Written from the mapping the generator already knows, which is precisely the
        mapping the matcher has to rediscover. */
  const paymentById = new Map(payments.map((payment) => [payment.id, payment]));
  const recon: ReconRow[] = [];

  for (const settlement of settlements) {
    for (const paymentId of settlementPayments.get(settlement.id)!) {
      const payment = paymentById.get(paymentId)!;
      recon.push({
        id: id(r, "rcn", 9),
        settlementId: settlement.id,
        utr: settlement.utr,
        settledAt: settlement.settledAt,
        type: "payment",
        entityId: payment.id,
        amount: payment.gross,
        fee: payment.fee,
        tax: payment.tax,
      });
    }
    for (const deduction of deductionsOf.get(settlement.id) ?? []) {
      recon.push({
        id: id(r, "rcn", 9),
        settlementId: settlement.id,
        utr: settlement.utr,
        settledAt: settlement.settledAt,
        type: deduction.type,
        entityId: deduction.id,
        amount: -deduction.amount,
        fee: 0,
        tax: 0,
      });
    }
  }

  /* 4 ─ The clean bank statement and the clean ledger. */
  const bank: BankCredit[] = [];
  const ledger: LedgerEntry[] = [];
  /** settlementId → creditIds, mutated by planting. */
  const creditsOf = new Map<string, string[]>();
  /** settlementId → journalId, mutated by planting. */
  const journalOf = new Map<string, string>();

  for (const settlement of settlements) {
    const credit: BankCredit = {
      id: id(r, "bnk"),
      valueDate: settlement.settledAt,
      description: `NEFT INWARD, RAZORPAY SOFTWARE PVT LTD, ${settlement.utr}`,
      reference: settlement.utr,
      amount: settlement.net,
    };
    bank.push(credit);
    creditsOf.set(settlement.id, [credit.id]);
    journalOf.set(settlement.id, postSettlement(r, settlement, ledger));
  }

  for (const chargeback of chargebacks) {
    if (!standaloneChargebacks.has(chargeback.id)) continue;
    bank.push({
      id: id(r, "bnk"),
      valueDate: chargeback.raisedAt,
      description: `CHARGEBACK DEBIT, RAZORPAY, ${chargeback.id.toUpperCase()}`,
      reference: "",
      amount: -chargeback.amount,
    });
  }

  /* 5 ─ Break it on purpose. */
  const links: TruthLink[] = [];
  const planted = plant({
    r,
    settlements,
    recon,
    settlementPayments,
    bank,
    ledger,
    creditsOf,
    journalOf,
    standaloneChargebacks,
    chargebacks,
  });

  /* 6 ─ The answer key, written from what actually happened above. */
  for (const settlement of settlements) {
    if (planted.reconTouched.has(settlement.id)) continue;
    links.push({
      lane: "PAYMENT_TO_SETTLEMENT",
      left: settlementPayments.get(settlement.id)!,
      right: [settlement.id],
      expect: "MATCH",
      class: null,
    });
  }
  for (const link of planted.links) links.push(link);
  for (const settlement of settlements) {
    if (planted.touched.has(settlement.id)) continue;
    links.push({
      lane: "SETTLEMENT_TO_BANK",
      left: [settlement.id],
      right: creditsOf.get(settlement.id) ?? [],
      expect: "MATCH",
      class: null,
    });
    const journal = journalOf.get(settlement.id);
    if (journal) {
      links.push({
        lane: "SETTLEMENT_TO_LEDGER",
        left: [settlement.id],
        right: [journal],
        expect: "MATCH",
        class: null,
      });
    }
  }

  /* Bank rows arrive in date order with same-day rows in arbitrary order — never in
     settlement order, which would let a lazy matcher cheat on row index. */
  const shuffledBank = shuffled(r, bank).sort((a, b) => a.valueDate.localeCompare(b.valueDate));

  return {
    payments,
    refunds,
    chargebacks,
    settlements,
    recon,
    bank: shuffledBank,
    ledger,
    truth: {
      seed: config.seed,
      generatedAt: new Date(0).toISOString(),
      counts: {
        payments: payments.length,
        refunds: refunds.length,
        chargebacks: chargebacks.length,
        settlements: settlements.length,
        reconRows: recon.length,
        bankRows: shuffledBank.length,
        ledgerLines: ledger.length,
        records:
          payments.length +
          refunds.length +
          chargebacks.length +
          settlements.length +
          recon.length +
          shuffledBank.length +
          ledger.length,
      },
      planted: planted.counts,
      malformed: [],
      links,
    },
  };
}

/**
 * The double entry for one settlement:
 *
 * ```
 *   Dr Bank                net
 *   Dr Payment Gateway Fees fees
 *   Dr GST Input            tax
 *   Dr Refunds              refunds
 *   Dr Chargebacks          chargebacks
 *     Cr Razorpay Clearing            gross
 * ```
 *
 * It balances because `net + fees + tax + refunds + chargebacks = gross` — which is the
 * same identity the matcher checks. A journal that does not balance is a planted defect,
 * never a generator bug.
 */
function postSettlement(r: Rng, settlement: Settlement, ledger: LedgerEntry[]): string {
  const journalId = id(r, "jrnl", 8);
  const line = (account: LedgerEntry["account"], debit: Paise, credit: Paise) => {
    if (debit === 0 && credit === 0) return;
    ledger.push({
      id: `${journalId}_${ledger.length}`,
      journalId,
      postedAt: settlement.settledAt,
      account,
      debit,
      credit,
      memo: `Settlement ${settlement.id}`,
    });
  };

  line("Bank", settlement.net, 0);
  line("Payment Gateway Fees", settlement.fees, 0);
  line("GST Input", settlement.tax, 0);
  line("Refunds", settlement.refunds, 0);
  line("Chargebacks", settlement.chargebacks, 0);
  line("Razorpay Clearing", 0, settlement.gross);
  return journalId;
}

/* ── Planting ─────────────────────────────────────────────────────────────*/

type PlantContext = {
  r: Rng;
  settlements: Settlement[];
  recon: ReconRow[];
  /** settlementId → its payment ids. The mapping the matcher has to rediscover. */
  settlementPayments: Map<string, string[]>;
  bank: BankCredit[];
  ledger: LedgerEntry[];
  creditsOf: Map<string, string[]>;
  journalOf: Map<string, string>;
  standaloneChargebacks: Set<string>;
  chargebacks: Chargeback[];
};

/**
 * Damage the clean world, one disjoint victim set per class.
 *
 * Disjoint matters: a settlement carrying two planted defects has an ambiguous answer, and
 * an ambiguous answer key silently mis-scores every run afterwards.
 */
function plant(context: PlantContext) {
  const { r, settlements, recon, bank, ledger, creditsOf, journalOf } = context;
  const links: TruthLink[] = [];
  const counts = Object.fromEntries(
    Object.keys(PLANT_SHARE).map((key) => [key, 0]),
  ) as Record<FailureClass, number>;
  const touched = new Set<string>();
  const reconTouched = new Set<string>();

  const creditById = new Map(bank.map((credit) => [credit.id, credit]));
  const pool = shuffled(r, settlements);
  let cursor = 0;
  const take = (share: number, needed = 1) => {
    const wanted = Math.max(needed, Math.round(settlements.length * share));
    const out: Settlement[] = [];
    while (out.length < wanted && cursor < pool.length) {
      const candidate = pool[cursor++];
      // Skip anything already damaged. Classes that pick their own victims (a settlement
      // must actually have refunds to lose one) do not advance the cursor, so without
      // this a settlement could collect two defects and its answer key would say two
      // contradictory things about the same lane.
      if (!touched.has(candidate.id)) out.push(candidate);
    }
    return out;
  };

  const creditFor = (settlement: Settlement) =>
    creditById.get(creditsOf.get(settlement.id)![0])!;

  const record = (
    settlement: Settlement,
    lane: TruthLink["lane"],
    right: string[],
    expect: TruthLink["expect"],
    failure: FailureClass,
    note: string,
  ) => {
    counts[failure]++;
    touched.add(settlement.id);
    links.push({ lane, left: [settlement.id], right, expect, class: failure, note });
    // Anything not tampered with keeps its default links, added by the caller.
    if (lane === "SETTLEMENT_TO_BANK") {
      const journal = journalOf.get(settlement.id);
      if (journal) {
        links.push({
          lane: "SETTLEMENT_TO_LEDGER",
          left: [settlement.id],
          right: [journal],
          expect: "MATCH",
          class: null,
        });
      }
    } else {
      links.push({
        lane: "SETTLEMENT_TO_BANK",
        left: [settlement.id],
        right: creditsOf.get(settlement.id) ?? [],
        expect: "MATCH",
        class: null,
      });
    }
  };

  /* Resolvable, but only past tier 0. */

  for (const settlement of take(PLANT_SHARE.MISSING_UTR)) {
    const credit = creditFor(settlement);
    credit.reference = "";
    credit.description = "NEFT INWARD, RAZORPAY SOFTWARE PVT LTD";
    record(settlement, "SETTLEMENT_TO_BANK", [credit.id], "MATCH", "MISSING_UTR",
      "Amount and date tie; the bank dropped the reference.");
  }

  for (const settlement of take(PLANT_SHARE.TYPO_UTR)) {
    const credit = creditFor(settlement);
    const chars = credit.reference.split("");
    const at = int(r, 5, chars.length - 2);
    [chars[at], chars[at + 1]] = [chars[at + 1], chars[at]];
    credit.reference = chars.join("");
    record(settlement, "SETTLEMENT_TO_BANK", [credit.id], "MATCH", "TYPO_UTR",
      "Two characters transposed in the reference.");
  }

  for (const settlement of take(PLANT_SHARE.SPLIT_SETTLEMENT)) {
    const credit = creditFor(settlement);
    const first = Math.round(credit.amount * 0.6);
    const second = credit.amount - first;
    const twin: BankCredit = {
      ...credit,
      id: `${credit.id}b`,
      amount: second,
      valueDate: iso(Date.parse(`${credit.valueDate}T00:00:00Z`) + DAY),
    };
    credit.amount = first;
    bank.push(twin);
    creditById.set(twin.id, twin);
    creditsOf.set(settlement.id, [credit.id, twin.id]);
    record(settlement, "SETTLEMENT_TO_BANK", [credit.id, twin.id], "MATCH", "SPLIT_SETTLEMENT",
      "One settlement paid out as two credits on consecutive days.");
  }

  /* Two settlements, one credit — consumes victims in pairs. */
  const combinable = take(PLANT_SHARE.COMBINED_CREDIT, 2);
  for (let i = 0; i + 1 < combinable.length; i += 2) {
    const [a, b] = [combinable[i], combinable[i + 1]];
    const creditA = creditFor(a);
    const creditB = creditFor(b);
    creditA.amount += creditB.amount;
    creditA.description = "NEFT INWARD, RAZORPAY SOFTWARE PVT LTD, CONSOLIDATED";
    const removeAt = bank.indexOf(creditB);
    if (removeAt >= 0) bank.splice(removeAt, 1);
    creditsOf.set(a.id, [creditA.id]);
    creditsOf.set(b.id, [creditA.id]);

    counts.COMBINED_CREDIT++;
    touched.add(a.id);
    touched.add(b.id);
    links.push({
      lane: "SETTLEMENT_TO_BANK",
      left: [a.id, b.id],
      right: [creditA.id],
      expect: "MATCH",
      class: "COMBINED_CREDIT",
      note: "One bank line covers two settlements; only one UTR survives.",
    });
    for (const settlement of [a, b]) {
      const journal = journalOf.get(settlement.id);
      if (journal) {
        links.push({
          lane: "SETTLEMENT_TO_LEDGER",
          left: [settlement.id],
          right: [journal],
          expect: "MATCH",
          class: null,
        });
      }
    }
  }

  for (const settlement of take(PLANT_SHARE.TIMING_T_PLUS_N)) {
    const credit = creditFor(settlement);
    let time = Date.parse(`${credit.valueDate}T00:00:00Z`) + int(r, 2, 4) * DAY;
    while (isWeekend(time)) time += DAY;
    credit.valueDate = iso(time);
    record(settlement, "SETTLEMENT_TO_BANK", [credit.id], "MATCH", "TIMING_T_PLUS_N",
      "Credit landed several days after the settlement date.");
  }

  for (const settlement of take(PLANT_SHARE.ROUNDING_PAISE)) {
    const credit = creditFor(settlement);
    credit.amount += int(r, -3, 3) || 1;
    record(settlement, "SETTLEMENT_TO_BANK", [credit.id], "MATCH", "ROUNDING_PAISE",
      "Credit differs from the settlement by a few paise.");
  }

  for (const settlement of take(PLANT_SHARE.TDS_WITHHELD)) {
    const credit = creditFor(settlement);
    const tds = pct(settlement.gross, 1); // s.194-O
    credit.amount -= tds;
    record(settlement, "SETTLEMENT_TO_BANK", [credit.id], "MATCH", "TDS_WITHHELD",
      "Credit short by 1% of gross; the report shows no TDS.");
  }

  /* The report contradicts itself: the refund came out of the money, but the
     `refunds` column does not mention it. */
  for (const settlement of settlements) {
    if (touched.has(settlement.id) || settlement.refunds === 0) continue;
    if (counts.REFUND_NETTED >= Math.max(1, Math.round(settlements.length * PLANT_SHARE.REFUND_NETTED)))
      break;
    if (!chance(r, 0.4)) continue;
    settlement.refunds = 0;
    record(settlement, "SETTLEMENT_TO_BANK", creditsOf.get(settlement.id)!, "MATCH",
      "REFUND_NETTED", "Report understates refunds, so gross less fees does not tie to the credit.");
  }

  /* Genuine exceptions: a correct matcher raises these and matches nothing. */

  for (const settlement of take(PLANT_SHARE.FEE_NOT_BOOKED)) {
    const journalId = journalOf.get(settlement.id);
    if (!journalId) continue;
    for (let i = ledger.length - 1; i >= 0; i--) {
      const line = ledger[i];
      if (line.journalId !== journalId) continue;
      if (line.account === "Payment Gateway Fees" || line.account === "GST Input") {
        ledger.splice(i, 1);
      } else if (line.account === "Bank") {
        line.debit = settlement.net + settlement.fees + settlement.tax;
      }
    }
    counts.FEE_NOT_BOOKED++;
    touched.add(settlement.id);
    links.push({
      lane: "SETTLEMENT_TO_LEDGER",
      left: [settlement.id],
      right: [journalId],
      expect: "EXCEPTION",
      class: "FEE_NOT_BOOKED",
      note: "Journal posts gross to bank; fee and GST were never expensed.",
    });
    links.push({
      lane: "SETTLEMENT_TO_BANK",
      left: [settlement.id],
      right: creditsOf.get(settlement.id) ?? [],
      expect: "MATCH",
      class: null,
    });
  }

  for (const settlement of take(PLANT_SHARE.MISSING_LEDGER_ENTRY)) {
    const journalId = journalOf.get(settlement.id);
    if (!journalId) continue;
    for (let i = ledger.length - 1; i >= 0; i--) {
      if (ledger[i].journalId === journalId) ledger.splice(i, 1);
    }
    journalOf.delete(settlement.id);
    counts.MISSING_LEDGER_ENTRY++;
    touched.add(settlement.id);
    links.push({
      lane: "SETTLEMENT_TO_LEDGER",
      left: [settlement.id],
      right: [],
      expect: "EXCEPTION",
      class: "MISSING_LEDGER_ENTRY",
      note: "Settled and banked, never posted to the books.",
    });
    links.push({
      lane: "SETTLEMENT_TO_BANK",
      left: [settlement.id],
      right: creditsOf.get(settlement.id) ?? [],
      expect: "MATCH",
      class: null,
    });
  }

  /* ── R0.5: cases a rule cannot safely settle ──────────────────────────*/

  /**
   * The batch reached 100% on every lane, which §1.6 says is a statement about the dataset.
   * These three classes are the answer, and they are deliberately not all the same kind of
   * hard.
   *
   * The distinction that matters: a case a rule *could* catch is a missing rule, not an
   * ambiguity. `UTR_IN_NARRATION` is one of those, so it is planted expecting a MATCH and a
   * rule was written for it. The other two are resolvable **only by widening a tolerance far
   * enough to make silent false matches** — an amount three paise out with no reference to
   * corroborate it, matched on nothing but proximity. That is the trade the tiering exists
   * to avoid, so the deterministic passes rank the candidates and decline, and the model
   * decides case by case with the evidence in front of it.
   *
   * Every instance is phrased differently. One template would be a regex waiting to be
   * written; the point is that bank narrations vary without limit.
   */

  /** A UTR the way a bank actually buries one: spaced, hyphenated, prefixed, lowercased. */
  const buryUtr = (utr: string, variant: number) => {
    const forms = [
      `NEFT INWARD RAZORPAY SOFTWARE PVT LTD UTR ${utr}`,
      `NEFT CR RAZORPAY SOFTWARE, REF: ${utr.slice(0, 4)} ${utr.slice(4, 8)} ${utr.slice(8)}`,
      `RTGS INWARD RAZORPAY SOFTWARE PVT LTD/${utr.toLowerCase()}/SETTLEMENT`,
      `IMPS RAZORPAY SOFTWARE PVT LTD - ${utr.slice(0, 8)}-${utr.slice(8)} - PAYOUT`,
      `NEFT INWARD, RAZORPAY SOFTWARE PVT LTD, TXN ${utr} DT SETTLEMENT`,
    ];
    return forms[variant % forms.length];
  };

  for (const [index, settlement] of take(PLANT_SHARE.UTR_IN_NARRATION).entries()) {
    const credit = creditFor(settlement);
    credit.description = buryUtr(settlement.utr, index);
    credit.reference = "";
    // A few paise out as well, so the amount alone cannot carry the match and the buried
    // reference has to do real work.
    credit.amount += int(r, -4, 4) || 2;
    record(settlement, "SETTLEMENT_TO_BANK", [credit.id], "MATCH", "UTR_IN_NARRATION",
      "Ref No is empty and the UTR is inside the narration; the amount is a few paise out.");
  }

  /** The same company, written by five banks that have never agreed on anything. */
  const disguise = (variant: number) => {
    const forms = [
      "NEFT INWARD RZPSPL SETTLEMENT INR",
      "NEFT CR R P SOFTWARE PVT LTD PAYOUT",
      "IMPS INWARD RAZOR PAY SW PVT LTD",
      "NEFT FRM RAZORPY SOFTWRE PVT LTD",
      "RTGS INWARD RZP-SETTLE-INR-PAYOUT",
    ];
    return forms[variant % forms.length];
  };

  for (const [index, settlement] of take(PLANT_SHARE.DISGUISED_COUNTERPARTY).entries()) {
    const credit = creditFor(settlement);
    credit.description = disguise(index);
    credit.reference = "";
    credit.amount += int(r, -4, 4) || 3;
    record(settlement, "SETTLEMENT_TO_BANK", [credit.id], "MATCH", "DISGUISED_COUNTERPARTY",
      "A real payout whose narration never spells the gateway's name recognisably, with no reference and the amount a few paise out.");
  }

  /**
   * The payout described rather than identified — including its transaction count, which is
   * sometimes a numeral and sometimes a word. A matcher can only weigh this; it cannot
   * verify it.
   */
  const narrate = (settlement: Settlement, variant: number) => {
    const count = settlement.paymentCount;
    const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
    const spelled =
      count < 10
        ? words[count]
        : count % 10 === 0 && count < 100
          ? ["ten", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"][count / 10 - 1]
          : String(count);
    const [year, month, day] = settlement.settledAt.split("-");
    const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const short = `${day}${months[Number(month) - 1]}${year.slice(2)}`;
    const forms = [
      `NEFT INWARD RAZORPAY PAYOUT FOR ${count} TXNS DATED ${short}`,
      `NEFT CR RAZORPAY SETTLEMENT OF ${spelled.toUpperCase()} TRANSACTIONS ${day} ${months[Number(month) - 1]}`,
      `IMPS RAZORPAY PAYOUT AGAINST ${count} CAPTURES ON ${day}-${month}-${year}`,
      `NEFT INWARD RAZORPAY BATCH OF ${spelled.toUpperCase()} TXN CLEARED ${short}`,
    ];
    return forms[variant % forms.length];
  };

  for (const [index, settlement] of take(PLANT_SHARE.NARRATED_PAYOUT).entries()) {
    const credit = creditFor(settlement);
    credit.description = narrate(settlement, index);
    credit.reference = "";
    credit.amount += int(r, -4, 4) || 4;
    record(settlement, "SETTLEMENT_TO_BANK", [credit.id], "MATCH", "NARRATED_PAYOUT",
      "No reference at all; the narration names the transaction count and the date in prose, and the amount is a few paise out.");
  }

  /* ── The recon report ─────────────────────────────────────────────────*/

  /**
   * Both of these damage the *itemisation* rather than the money. The payout still arrives,
   * the books still balance, and the settlement report still adds up — only the question
   * "which payments was this?" stops having an answer, which is exactly the failure a
   * controller cannot see until an auditor asks.
   */

  const settlementsByDate = new Map<string, Settlement[]>();
  for (const settlement of settlements) {
    const bucket = settlementsByDate.get(settlement.settledAt);
    if (bucket) bucket.push(settlement);
    else settlementsByDate.set(settlement.settledAt, [settlement]);
  }
  /** Dates carrying more than one payout, deterministically ordered. */
  const busyDates = [...settlementsByDate.entries()]
    .filter(([, onDate]) => onDate.length > 1)
    .map(([date]) => date)
    .sort();

  const dropRows = (settlementId: string) => {
    for (let i = recon.length - 1; i >= 0; i--) {
      if (recon[i].settlementId === settlementId) recon.splice(i, 1);
    }
  };

  /**
   * `MISSING_RECON_ROW` — the report omits a payout entirely.
   *
   * Planted in two shapes on purpose, because the same damage has two different honest
   * answers:
   *
   * - **One omission on a date.** Every other payout that day is itemised, so the omitted
   *   payout's payments are the exact remainder — count and value both tie. That is
   *   recoverable *by elimination*, so the key expects a MATCH.
   * - **Two omissions on one date.** Now eighty payments have to be split between two
   *   payouts of forty and nothing says which way. Unrecoverable, so the key expects an
   *   EXCEPTION.
   *
   * A dataset where every instance of a class has the same answer teaches a matcher to
   * pattern-match the class instead of doing the work.
   */
  const missingTarget = Math.max(3, Math.round(settlements.length * PLANT_SHARE.MISSING_RECON_ROW));
  const pairDates = busyDates.filter((date) =>
    settlementsByDate.get(date)!.every((s) => !reconTouched.has(s.id)),
  );

  /* The unrecoverable shape first: whole dates, two payouts each. */
  const dateCursor = int(r, 0, Math.max(0, pairDates.length - 1));
  const pairsWanted = Math.max(1, Math.floor(missingTarget / 3));
  for (let planted = 0; planted < pairsWanted && pairDates.length > 0; planted++) {
    const date = pairDates[(dateCursor + planted * 7) % pairDates.length];
    const onDate = settlementsByDate.get(date)!.filter((s) => !reconTouched.has(s.id));
    if (onDate.length < 2) continue;
    for (const settlement of onDate.slice(0, 2)) {
      dropRows(settlement.id);
      reconTouched.add(settlement.id);
      counts.MISSING_RECON_ROW++;
      links.push({
        lane: "PAYMENT_TO_SETTLEMENT",
        left: [],
        right: [settlement.id],
        expect: "EXCEPTION",
        class: "MISSING_RECON_ROW",
        note: `Absent from the recon report, and so is another payout on ${date} — the two cannot be told apart.`,
      });
    }
  }

  /* The recoverable shape: one omission on a date whose other payouts are all itemised. */
  for (const date of busyDates) {
    if (counts.MISSING_RECON_ROW >= missingTarget) break;
    const onDate = settlementsByDate.get(date)!;
    if (onDate.some((s) => reconTouched.has(s.id))) continue;
    const settlement = onDate[int(r, 0, onDate.length - 1)];
    dropRows(settlement.id);
    reconTouched.add(settlement.id);
    counts.MISSING_RECON_ROW++;
    links.push({
      lane: "PAYMENT_TO_SETTLEMENT",
      left: context.settlementPayments.get(settlement.id)!,
      right: [settlement.id],
      expect: "MATCH",
      class: "MISSING_RECON_ROW",
      note: "Absent from the recon report, but every other payout that day is itemised, so its payments are the remainder.",
    });
  }

  /**
   * `MISATTRIBUTED_PAYMENT` — one payment swapped between two payouts of the same day.
   *
   * The nastiest of the set, because nothing is missing: both payouts still list forty
   * payments, the date still ties out in total, and only the per-payout **value** is wrong.
   * A matcher that checks counts and not sums accepts it silently, which is why the recon
   * pass checks both.
   */
  const swapTarget = Math.max(2, Math.round(settlements.length * PLANT_SHARE.MISATTRIBUTED_PAYMENT));
  for (const date of busyDates) {
    if (counts.MISATTRIBUTED_PAYMENT >= swapTarget) break;
    const onDate = settlementsByDate.get(date)!.filter((s) => !reconTouched.has(s.id));
    if (onDate.length < 2) continue;

    const [a, b] = onDate;
    const rowsA = recon.filter((row) => row.settlementId === a.id && row.type === "payment");
    const rowsB = recon.filter((row) => row.settlementId === b.id && row.type === "payment");
    if (rowsA.length === 0 || rowsB.length === 0) continue;

    const rowA = rowsA[int(r, 0, rowsA.length - 1)];
    const rowB = rowsB[int(r, 0, rowsB.length - 1)];
    if (rowA.amount === rowB.amount) continue; // A swap of equal values damages nothing.

    rowA.settlementId = b.id;
    rowA.utr = b.utr;
    rowB.settlementId = a.id;
    rowB.utr = a.utr;

    for (const settlement of [a, b]) {
      reconTouched.add(settlement.id);
      counts.MISATTRIBUTED_PAYMENT++;
      links.push({
        lane: "PAYMENT_TO_SETTLEMENT",
        left: [],
        right: [settlement.id],
        expect: "EXCEPTION",
        class: "MISATTRIBUTED_PAYMENT",
        note: `One payment traded with the other payout of ${date}: the count still ties, the value does not.`,
      });
    }
  }

  /* Bank-side noise, which belongs to no settlement at all. */

  const duplicates = Math.max(1, Math.round(bank.length * PLANT_SHARE.DUPLICATE_CREDIT));
  for (let i = 0; i < duplicates; i++) {
    const source = pick(r, bank.filter((credit) => credit.amount > 0));
    const copy: BankCredit = { ...source, id: id(r, "bnk") };
    bank.push(copy);
    counts.DUPLICATE_CREDIT++;
    links.push({
      lane: "SETTLEMENT_TO_BANK",
      left: [],
      right: [copy.id],
      expect: "EXCEPTION",
      class: "DUPLICATE_CREDIT",
      note: `Identical to ${source.id}; the statement was ingested twice.`,
    });
  }

  const foreign = Math.max(1, Math.round(bank.length * PLANT_SHARE.FOREIGN_CREDIT));
  const counterparties = [
    "ACME LOGISTICS PVT LTD",
    "INTEREST CREDIT",
    "GST REFUND, CPC BENGALURU",
    "STRIPE PAYMENTS INDIA",
    "FD MATURITY, HDFC BANK",
  ];
  for (let i = 0; i < foreign; i++) {
    const sample = pick(r, bank);
    const credit: BankCredit = {
      id: id(r, "bnk"),
      valueDate: sample.valueDate,
      description: `NEFT INWARD, ${pick(r, counterparties)}`,
      reference: `NEFT${int(r, 100000, 999999)}`,
      amount: rupees(int(r, 5000, 400000)),
    };
    bank.push(credit);
    counts.FOREIGN_CREDIT++;
    links.push({
      lane: "SETTLEMENT_TO_BANK",
      left: [],
      right: [credit.id],
      expect: "EXCEPTION",
      class: "FOREIGN_CREDIT",
      note: "Credit from a counterparty that is not the gateway.",
    });
  }

  for (const chargeback of context.chargebacks) {
    if (!context.standaloneChargebacks.has(chargeback.id)) continue;
    const debit = bank.find((credit) => credit.description.includes(chargeback.id.toUpperCase()));
    if (!debit) continue;
    counts.CHARGEBACK_DEDUCTION++;
    links.push({
      lane: "SETTLEMENT_TO_BANK",
      left: [],
      right: [debit.id],
      expect: "EXCEPTION",
      class: "CHARGEBACK_DEDUCTION",
      note: `Dispute ${chargeback.id} debited on its own, outside any settlement.`,
    });
  }

  return { links, counts, touched, reconTouched };
}
