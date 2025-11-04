/**
 * Coordinate mapping utilities for real↔screen transforms with log10 support
 * Includes digitizer calibration helpers.
 * 
 * Usage example:
 * ```ts
 * const scaler = makeScaler("log10");
 * const mapped = makeCoordMap("log10", "linear", 0.01, 10, 0, 1000, {x:0, y:0, width:800, height:600});
 * const px = mapped.X(1.0); // pixel x from real x
 * const real = mapped.invX(px); // real x from pixel
 * ```
 */

export type AxisMode = "linear" | "log10";
export type Rect = { x: number; y: number; width: number; height: number };

const EPS = 1e-12; // Epsilon for log clamping

/**
 * Continuous scaler: linear or log10 (clamps <=0 to epsilon in log mode).
 * 
 * @param mode - "linear" or "log10"
 * @returns Function that maps real value to transformed value
 */
export function makeScaler(mode: AxisMode): (v: number) => number {
  if (mode === "log10") {
    return (v: number) => Math.log10(Math.max(EPS, v));
  }
  return (v: number) => v;
}

/**
 * Build mapping functions between real axis [xmin,xmax]/[ymin,ymax] and screen rect.
 * Returns { X(real), Y(real), invX(px), invY(py) } with mode-aware scaling.
 * 
 * @param modeX - Scaling mode for X axis
 * @param modeY - Scaling mode for Y axis
 * @param xmin - Minimum real X value
 * @param xmax - Maximum real X value
 * @param ymin - Minimum real Y value
 * @param ymax - Maximum real Y value
 * @param rect - Screen rectangle {x, y, width, height}
 * @returns Mapping functions: X, Y, invX, invY
 */
export function makeCoordMap(
  modeX: AxisMode,
  modeY: AxisMode,
  xmin: number,
  xmax: number,
  ymin: number,
  ymax: number,
  rect: Rect
): {
  X: (x: number) => number;
  Y: (y: number) => number;
  invX: (px: number) => number;
  invY: (py: number) => number;
} {
  const scaleX = makeScaler(modeX);
  const scaleY = makeScaler(modeY);
  
  const xMinScaled = scaleX(xmin);
  const xMaxScaled = scaleX(xmax);
  const yMinScaled = scaleY(ymin);
  const yMaxScaled = scaleY(ymax);
  
  const xRange = xMaxScaled - xMinScaled;
  const yRange = yMaxScaled - yMinScaled;
  
  // Real to pixel (screen coordinates: y increases downward)
  const X = (x: number): number => {
    const xScaled = scaleX(x);
    const t = (xScaled - xMinScaled) / xRange;
    return rect.x + t * rect.width;
  };
  
  const Y = (y: number): number => {
    const yScaled = scaleY(y);
    const t = (yScaled - yMinScaled) / yRange;
    return rect.y + (1 - t) * rect.height; // Invert Y axis
  };
  
  // Pixel to real
  const invX = (px: number): number => {
    const t = (px - rect.x) / rect.width;
    const xScaled = xMinScaled + t * xRange;
    
    if (modeX === "log10") {
      return Math.pow(10, xScaled);
    }
    return xScaled;
  };
  
  const invY = (py: number): number => {
    const t = 1 - (py - rect.y) / rect.height; // Invert Y axis
    const yScaled = yMinScaled + t * yRange;
    
    if (modeY === "log10") {
      return Math.pow(10, yScaled);
    }
    return yScaled;
  };
  
  return { X, Y, invX, invY };
}

/**
 * Simple digitizer calibration:
 * real = origin + scale * (pixel - pixelOrigin)
 * Provide separate X/Y scales and origins; log mapping can be applied outside.
 */
export type Calibration = {
  pixelOrigin: { x: number; y: number };
  realOrigin: { x: number; y: number };
  scale: { x: number; y: number }; // real units per pixel
};

/**
 * Pixel→real with calibration (no log here; log is handled by chart scaling).
 * 
 * @param p - Pixel coordinates {x, y}
 * @param c - Calibration parameters
 * @returns Real coordinates {x, y}
 */
export function pixelToReal(
  p: { x: number; y: number },
  c: Calibration
): { x: number; y: number } {
  return {
    x: c.realOrigin.x + c.scale.x * (p.x - c.pixelOrigin.x),
    y: c.realOrigin.y + c.scale.y * (p.y - c.pixelOrigin.y),
  };
}

/**
 * Real→pixel with calibration.
 * 
 * @param p - Real coordinates {x, y}
 * @param c - Calibration parameters
 * @returns Pixel coordinates {x, y}
 */
export function realToPixel(
  p: { x: number; y: number },
  c: Calibration
): { x: number; y: number } {
  return {
    x: c.pixelOrigin.x + (p.x - c.realOrigin.x) / c.scale.x,
    y: c.pixelOrigin.y + (p.y - c.realOrigin.y) / c.scale.y,
  };
}

