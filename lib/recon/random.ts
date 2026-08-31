/**
 * A seeded pseudo-random generator.
 *
 * `docs/recon-plan.md` R0.2: regenerating with the same seed must produce byte-identical
 * output. An evaluation you cannot reproduce is not an evaluation — you cannot tell a
 * matcher that improved from a batch that got easier. `Math.random()` is therefore banned
 * from this module.
 *
 * mulberry32: 32-bit state, good enough distribution for fixtures, four lines.
 */
export type Rng = () => number;

export function rng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Inclusive on both ends. */
export const int = (r: Rng, min: number, max: number) =>
  min + Math.floor(r() * (max - min + 1));

export const pick = <T>(r: Rng, values: readonly T[]): T =>
  values[Math.floor(r() * values.length)];

export const chance = (r: Rng, probability: number) => r() < probability;

/** Fisher–Yates, on a copy. Used to deal disjoint sets of victims to each failure class. */
export function shuffled<T>(r: Rng, values: readonly T[]): T[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A weighted pick: `[["card", 5], ["upi", 3]]`. */
export function weighted<T>(r: Rng, options: readonly (readonly [T, number])[]): T {
  const total = options.reduce((acc, [, weight]) => acc + weight, 0);
  let roll = r() * total;
  for (const [value, weight] of options) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return options[options.length - 1][0];
}
