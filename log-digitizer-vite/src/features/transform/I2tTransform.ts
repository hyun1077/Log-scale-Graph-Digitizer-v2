/**
 * I²t transformation helpers for UI
 * 
 * Usage example:
 * ```ts
 * const tc = [{ t: 0.01, i: 3000 }, { t: 0.10, i: 1500 }];
 * const result = buildI2tAndEquivalent(tc, 500);
 * console.log(result.i2t, result.tEq);
 * ```
 */

import type { Sample, XY } from "../../lib/i2t";
import { toI2tCurve, timeAtEqualI2t } from "../../lib/i2t";

/**
 * Build I²t curve and compute equivalent time for a given current.
 * 
 * @param tc - TC (I-t) samples
 * @param eqCurrent - Optional target equivalent current in amperes
 * @returns Object with i2t curve and equivalent time tEq (null if eqCurrent not provided or invalid)
 */
export function buildI2tAndEquivalent(
  tc: Sample[],
  eqCurrent?: number
): { i2t: XY[]; tEq: number | null } {
  const i2t = toI2tCurve(tc);
  const tEq = eqCurrent !== undefined ? timeAtEqualI2t(tc, eqCurrent) : null;
  
  return { i2t, tEq };
}

