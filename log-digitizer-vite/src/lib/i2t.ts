/**
 * I²t (I-squared-t) integration and transformation functions
 * 
 * Usage example:
 * ```ts
 * const samples = [{ t: 0.01, i: 3000 }, { t: 0.10, i: 1500 }];
 * const total = integrateI2t(samples);
 * const curve = toI2tCurve(samples);
 * const tEq = timeAtEqualI2t(samples, 500);
 * ```
 */

export type Sample = { t: number; i: number }; // seconds, amperes
export type XY = { x: number; y: number };

/**
 * Trapezoidal integration of I^2 over time.
 * Computes ∫ I² dt using trapezoidal rule: Σ (I₀² + I₁²)/2 * Δt
 * 
 * @param samples - Array of {t, i} samples, must be sorted by t
 * @returns Total integrated I²t value
 */
export function integrateI2t(samples: Sample[]): number {
  if (samples.length < 2) return 0;
  
  let total = 0;
  for (let i = 0; i < samples.length - 1; i++) {
    const curr = samples[i];
    const next = samples[i + 1];
    const dt = next.t - curr.t;
    const i2Avg = (curr.i * curr.i + next.i * next.i) / 2;
    total += i2Avg * dt;
  }
  return total;
}

/**
 * Convert TC (I–t) samples into cumulative I²t–t curve (y=∫I² dt, x=t).
 * Returns array of {x: t, y: cumulative I²t} points.
 * 
 * @param tc - Array of {t, i} samples (TC curve data)
 * @returns Array of {x, y} points where x=t and y=cumulative I²t
 */
export function toI2tCurve(tc: Sample[]): XY[] {
  if (tc.length === 0) return [];
  if (tc.length === 1) return [{ x: tc[0].t, y: 0 }];
  
  const result: XY[] = [{ x: tc[0].t, y: 0 }];
  let cumulative = 0;
  
  for (let i = 0; i < tc.length - 1; i++) {
    const curr = tc[i];
    const next = tc[i + 1];
    const dt = next.t - curr.t;
    const i2Avg = (curr.i * curr.i + next.i * next.i) / 2;
    cumulative += i2Avg * dt;
    result.push({ x: next.t, y: cumulative });
  }
  
  return result;
}

/**
 * Given TC samples and a target current I[A], return equivalent time t*[s] 
 * where I²t = I²·t*.
 * 
 * Computes total I²t from samples, then solves: total = I² · t*
 * Returns t* = total / I² (if I > 0), otherwise null.
 * 
 * @param tc - Array of {t, i} samples (TC curve data)
 * @param I - Target equivalent current in amperes
 * @returns Equivalent time t* in seconds, or null if I <= 0
 */
export function timeAtEqualI2t(tc: Sample[], I: number): number | null {
  if (I <= 0 || tc.length === 0) return null;
  
  const total = integrateI2t(tc);
  const tEq = total / (I * I);
  return tEq;
}

