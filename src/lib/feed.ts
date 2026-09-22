/** Starter feed helper: how much seed, flour and water make `targetGrams` at ratio seed:flour:water. */
export interface FeedPlan {
  seed: number;
  flour: number;
  water: number;
  total: number;
}

export function feedPlan(targetGrams: number, ratio: [number, number, number]): FeedPlan {
  const [a, b, c] = ratio;
  const parts = a + b + c;
  if (!(targetGrams > 0) || !(parts > 0)) return { seed: 0, flour: 0, water: 0, total: 0 };
  return {
    seed: (targetGrams * a) / parts,
    flour: (targetGrams * b) / parts,
    water: (targetGrams * c) / parts,
    total: targetGrams,
  };
}

/** When to feed so the starter peaks at `readyBy`. */
export function feedAt(readyBy: Date, hoursToPeak: number): Date {
  return new Date(readyBy.getTime() - hoursToPeak * 3_600_000);
}
