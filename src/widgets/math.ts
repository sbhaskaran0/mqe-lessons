// The one mathjs instance every widget expression is parsed with (building one costs ~15 ms), and the seeded
// generator behind every random draw (scatter-fit `generate`, sampler replications). Shared here so expr.ts and
// sampler.ts both read them without importing each other.
import { all, create } from "mathjs";

// `all` is typed optional in mathjs; it is always defined in the full bundle.
export const math = create(all!, { number: "number" });

/** Seeded uniform [0, 1) generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A normal draw from two uniforms (Box-Muller, cosine branch): the formula `generate` has always used. */
export function normalFrom(u: () => number, mu = 0, sigma = 1): number {
  return mu + sigma * Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
}
