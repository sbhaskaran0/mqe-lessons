// The seam between `npm run validate` and the derivation checker (src/derive, E1). validate.ts calls only this, so
// the checker can change on its own schedule without validate.ts importing it directly.
import { selfTest, type DeriveBlockIR } from "../derive";
import type { Derive } from "../ir";

export type SelfTestOptions = {
  /** Random draws for the equivalence checks; validate derives it from `slug#stepId`, so reruns agree. */
  seed: number;
};

// src/derive declares the derive block structurally so it doesn't depend on the zod schema. This line stops compiling
// if the exported IR no longer satisfies the checker's shape.
const _shapeMatches: (b: Derive) => DeriveBlockIR = (b) => b;
void _shapeMatches;

/** Problems the checker finds in one exported derivation (E0 P3): a step, accept or reject that does not parse, an
 *  accept that does not reach the target, a reject that is not an error, a step that does not follow, a reject
 *  equivalent to the target. Each message is about one line, e.g. `step 2 "s = q": I don't know the symbol "q"`.
 *  The checker reads the block's own `inherited` Notation rows. */
export function selfTestDerive(block: Derive, options: SelfTestOptions): string[] {
  return selfTest(block, { seed: options.seed });
}
