/**
 * Money, as integer paise.
 *
 * `docs/recon-plan.md` §6 names float money as the one bug a finance judge catches
 * instantly. `0.1 + 0.2 !== 0.3`, and a reconciliation is a pile of additions asking
 * whether two sides are equal — the single worst place to keep a float.
 *
 * So: **every amount in this module is an integer number of paise.** Rupees exist only at
 * the boundary, in the CSVs a bank or a gateway actually hands you, and in what a human
 * reads.
 */

/** An integer count of paise. 100 paise = ₹1. */
export type Paise = number;

/** ₹1,234.56 → 123456. Used when authoring fixtures, never on parsed input. */
export const rupees = (amount: number): Paise => Math.round(amount * 100);

/** Percentage of an amount, rounded to the paisa — the rounding a gateway does. */
export const pct = (amount: Paise, percent: number): Paise =>
  Math.round((amount * percent) / 100);

export const sum = (values: Paise[]): Paise => values.reduce((a, b) => a + b, 0);

/** `123456` → `"1234.56"`. The plain decimal a gateway export uses. */
export function toDecimal(paise: Paise): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * `123456` → `"1,234.56"`; `12345678` → `"1,23,456.78"`.
 *
 * Indian grouping puts the last three digits together and then groups by two — which is
 * exactly the format a bank statement CSV arrives in and exactly what a naive
 * `parseFloat` after stripping the first comma gets wrong.
 */
export function toIndianDecimal(paise: Paise): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const whole = String(Math.floor(abs / 100));
  const fraction = String(abs % 100).padStart(2, "0");

  if (whole.length <= 3) return `${sign}${whole}.${fraction}`;

  const head = whole.slice(0, -3);
  const tail = whole.slice(-3);
  const grouped = head.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${sign}${grouped},${tail}.${fraction}`;
}
