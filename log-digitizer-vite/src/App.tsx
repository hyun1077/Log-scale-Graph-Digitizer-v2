/* @ts-nocheck */
import { useEffect, useRef, useState } from "react";

/**

Log-scale Graph Digitizer — single file (stable)

Guides X/Y + cross toggles

Real-value cursor/labels on log axes

Image A/B edit (drag/resize/wheel zoom, keyboard nudge)

Undo/Redo history

Preset Save/Load/Share URL
*/

type Pt = { x: number; y: number };
type Series = { name: string; color: string; points: Pt[] };
type Handle = "none" | "left" | "right" | "top" | "bottom" | "uniform";
type BgXf = { sx: number; sy: number; offX: number; offY: number };
type AnchorMode = "center" | "custom";
type CustomAnchor = { ax: number; ay: number; fx: number; fy: number } | null;
type SelectedPoint = { seriesIndex: number; pointIndex: number } | null;

const Accordion = ({ title, open, onToggle, children }) => (

<div className="rounded-xl border border-gray-200 bg-white shadow-sm"> <button onClick={onToggle} className="flex w-full items-center justify-between p-4"> <h3 className="text-base font-semibold text-gray-800">{title}</h3> <span className={`text-gray-500 transition-transform ${open ? "rotate-180" : ""}`}>▾</span> </button> {open && <div className="border-t border-gray-100 p-4">{children}</div>} </div> );

export default function App() {
/* ===== Refs / State ===== */
const canvasRef = useRef<HTMLCanvasElement | null>(null);
const fileARef = useRef<HTMLInputElement | null>(null);
const fileBRef = useRef<HTMLInputElement | null>(null);
const presetFileRef = useRef<HTMLInputElement | null>(null);

const bgRefs = useRef<[HTMLImageElement | null, HTMLImageElement | null]>([null, null]);
const bgUrls = useRef<[string | null, string | null]>([null, null]);
const lastRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
const hoverRef = useRef<{ x: number | null; y: number | null }>({ x: null, y: null });

const [tick, setTick] = useState(0);
const [size] = useState({ w: 960, h: 560 });
const [pad] = useState({ left: 60, right: 20, top: 30, bottom: 46 });

// Layout
const [openAxes, setOpenAxes] = useState(true);
const [openImage, setOpenImage] = useState(true);
const [openSeries, setOpenSeries] = useState(true);

// Axes
const [xMin, setXMin] = useState(10), [xMax, setXMax] = useState(1_000_000);
const [yMin, setYMin] = useState(0.0001), [yMax, setYMax] = useState(1_000_000);
const [xLog, setXLog] = useState(true), [yLog, setYLog] = useState(true);

// Series & points
const [series, setSeries] = useState<Series[]>([
{ name: "A", color: "#2563EB", points: [] },
{ name: "B", color: "#10B981", points: [] },
]);
const [activeSeries, setActiveSeries] = useState(0);
const [selectedPoint, setSelectedPoint] = useState<SelectedPoint>(null);
const [connectLines, setConnectLines] = useState(true);
const [lineWidth, setLineWidth] = useState(1.6);
const [lineAlpha, setLineAlpha] = useState(0.9);
const [smoothLines, setSmoothLines] = useState(true);
const [smoothAlpha, setSmoothAlpha] = useState(0.35);
const [ptRadius, setPtRadius] = useState(5);
const [showPoints, setShowPoints] = useState(true);

// Magnifier
const [magnifyOn, setMagnifyOn] = useState(false);
const [magnifyFactor, setMagnifyFactor] = useState(3);

// Background
const [bgList, setBgList] = useState<Array<{ w: number; h: number } | null>>([null, null]);
const [bgXform, setBgXform] = useState<[BgXf, BgXf]>([
{ sx: 1, sy: 1, offX: 0, offY: 0 },
{ sx: 1, sy: 1, offX: 0, offY: 0 },
]);
const [keepAspect, setKeepAspect] = useState(false);
const [showAB, setShowAB] = useState<[boolean, boolean]>([true, true]);
const [opacityAB, setOpacityAB] = useState<[number, number]>([1, 0.6]);
const [activeBg, setActiveBg] = useState<0 | 1>(0);

// Anchor
const [anchorMode, setAnchorMode] = useState<AnchorMode>("custom");
const [customAnchors, setCustomAnchors] = useState<[CustomAnchor, CustomAnchor]>([null, null]);
const [pickAnchor, setPickAnchor] = useState(false);

// Edit state
const [bgEditMode, setBgEditMode] = useState(true);
const [hoverHandle, setHoverHandle] = useState<Handle>("none");
const dragRef = useRef({ active: false, startX: 0, startY: 0, baseX: 0, baseY: 0 });
const resizeRef = useRef({ active: false, mode: "none" as Handle, ax: 0, ay: 0, fx: 0.5, fy: 0.5, baseW: 1, baseH: 1 });

// Guides
const [guideXs, setGuideXs] = useState<number[]>([]);
const [guideYs, setGuideYs] = useState<number[]>([]);
const [guideInputX, setGuideInputX] = useState("");
const [guideInputY, setGuideInputY] = useState("");
const [showCrossFromX, setShowCrossFromX] = useState(true);
const [showCrossFromY, setShowCrossFromY] = useState(true);

// Toast
const [toast, setToast] = useState<{ msg: string; kind?: "ok" | "err" } | null>(null);
const notify = (msg: string, kind: "ok" | "err" = "ok") => {
setToast({ msg, kind });
window.clearTimeout((notify as any)._t);
(notify as any)._t = window.setTimeout(() => setToast(null), 1600);
};

// History (Undo/Redo)
const [undoStack, setUndoStack] = useState<any[]>([]);
const [redoStack, setRedoStack] = useState<any[]>([]);
const pushHistory = () => setUndoStack((s) => [...s, serialize()]);
const undo = () => {
if (!undoStack.length) return;
const prev = undoStack[undoStack.length - 1];
setUndoStack((s) => s.slice(0, -1));
setRedoStack((s) => [...s, serialize()]);
applyPreset(prev, false);
};
const redo = () => {
if (!redoStack.length) return;
const nxt = redoStack[redoStack.length - 1];
setRedoStack((s) => s.slice(0, -1));
setUndoStack((s) => [...s, serialize()]);
applyPreset(nxt, false);
};

/* ===== Math / Util ===== */
const innerRect = () => ({ x: pad.left, y: pad.top, w: size.w - pad.left - pad.right, h: size.h - pad.top - pad.bottom });
const clampS = (v: number) => Math.max(0.05, Math.min(50, v));
const EPS = 1e-12;
const tVal = (v: number, log: boolean) => (log ? Math.log10(Math.max(EPS, v)) : v);
const tMinMax = () => ({ xmin: tVal(xMin, xLog), xmax: tVal(xMax, xLog), ymin: tVal(yMin, yLog), ymax: tVal(yMax, yLog) });
const dataToPixel = (x: number, y: number) => {
const r = innerRect(), mm = tMinMax();
const tx = tVal(x, xLog), ty = tVal(y, yLog);
return { px: r.x + ((tx - mm.xmin) / (mm.xmax - mm.xmin)) * r.w, py: r.y + r.h - ((ty - mm.ymin) / (mm.ymax - mm.ymin)) * r.h };
};
const pixelToData = (px: number, py: number) => {
const r = innerRect(), mm = tMinMax();
const tx = mm.xmin + ((px - r.x) / r.w) * (mm.xmax - mm.xmin);
const ty = mm.ymin + ((r.y + r.h - py) / r.h) * (mm.ymax - mm.ymin);
const f = (tv: number, log: boolean) => (log ? Math.pow(10, tv) : tv);
return { x: f(tx, xLog), y: f(ty, yLog) };
};
const baseRect = (idx: 0 | 1) => {
const r = innerRect(), meta = bgList[idx];
if (!meta || !keepAspect) return { x: r.x, y: r.y, w: r.w, h: r.h };
const s = Math.min(r.w / meta.w, r.h / meta.h);
const w = meta.w * s, h = meta.h * s, x = r.x + (r.w - w) / 2, y = r.y + (r.h - h) / 2;
return { x, y, w, h };
};
const drawRectAndAnchor = (idx: 0 | 1) => {
const base = baseRect(idx), xf = bgXform[idx], CA = customAnchors[idx];
const dw = base.w * clampS(xf.sx), dh = base.h * clampS(xf.sy);
let ax: number, ay: number, fx: number, fy: number;
if (anchorMode === "custom") {
if (CA) { ax = CA.ax; ay = CA.ay; fx = CA.fx; fy = CA.fy; }
else { ax = base.x; ay = base.y + base.h; fx = 0; fy = 1; }
} else {
ax = base.x + base.w / 2 + xf.offX; ay = base.y + base.h / 2 + xf.offY; fx = 0.5; fy = 0.5;
}
const dx = ax - fx * dw, dy = ay - fy * dh;
return { dx, dy, dw, dh, ax, ay, fx, fy, baseW: base.w, baseH: base.h };
};
function yAtX(seriesPts: Pt[], xTarget: number): number | null {
if (!seriesPts || seriesPts.length < 2) return null;
const tx = (x: number) => tVal(x, xLog); const ty = (y: number) => tVal(y, yLog); const invY = (tv: number) => (yLog ? Math.pow(10, tv) : tv); const xT = tx(xTarget);
for (let i = 0; i < seriesPts.length - 1; i++) {
const p1 = seriesPts[i], p2 = seriesPts[i + 1]; const x1 = tx(p1.x), x2 = tx(p2.x);
if ((x1 <= xT && xT <= x2) || (x2 <= xT && xT <= x1)) {
const t = (xT - x1) / (x2 - x1 || EPS); const y1 = ty(p1.y), y2 = ty(p2.y); const yT = y1 + t * (y2 - y1); return invY(yT);
}
} return null;
}
function xAtY(seriesPts: Pt[], yTarget: number): number | null {
if (!seriesPts || seriesPts.length < 2) return null;
const tx = (x: number) => tVal(x, xLog); const ty = (y: number) => tVal(y, yLog); const invX = (tv: number) => (xLog ? Math.pow(10, tv) : tv); const yT = ty(yTarget);
for (let i = 0; i < seriesPts.length - 1; i++) {
const p1 = seriesPts[i], p2 = seriesPts[i + 1]; const y1 = ty(p1.y), y2 = ty(p2.y);
if ((y1 <= yT && yT <= y2) || (y2 <= yT && yT <= y1)) {
const t = (yT - y1) / (y2 - y1 || EPS); const x1 = tx(p1.x), x2 = tx(p2.x); const xT = x1 + t * (x2 - x1); return invX(xT);
}
} return null;
}
const fmtReal = (v: number | null) => {
if (v === null || !isFinite(v)) return "-";
const a = Math.abs(v);
const s = a >= 1e6 || a < 1e-4
? Number(v).toPrecision(6)
: Number(v).toLocaleString(undefined, { maximumFractionDigits: 6 });
return s.replace(/.?0+$/, "");
};

/* ===== Image load ===== */
const onFile = (file: File, idx: 0 | 1) => {
if (!file) return;
if (!/^image//.test(file.type)) { alert("이미지 파일만 지원합니다."); return; }
const img = new Image(); img.crossOrigin = "anonymous";
const finalize = (src: string) => {
img.onload = () => {
bgRefs.current[idx] = img; bgUrls.current[idx] = src;
setBgList((cur) => { const n = [...cur]; n[idx] = { w: img.width, h: img.height }; return n; });
setBgXform((cur) => { const n = [...cur] as [BgXf, BgXf]; n[idx] = { sx: 1, sy: 1, offX: 0, offY: 0 }; return n; });
pushHistory();
};
img.onerror = () => alert("이미지를 열 수 없습니다.");
img.src = src;
};
const fr = new FileReader();
fr.onload = () => finalize(String(fr.result || ""));
fr.onerror = () => { try { finalize(URL.createObjectURL(file)); } catch { alert("이미지를 열 수 없습니다."); } };
fr.readAsDataURL(file);
};

useEffect(() => {
const onPaste = (e: ClipboardEvent) => {
const items = (e.clipboardData?.items) || [];
for (let i = 0; i < items.length; i++) if (items[i].type?.startsWith("image/")) {
const f = items[i].getAsFile(); if (f) onFile(f, activeBg);
}
};
window.addEventListener("paste", onPaste as any);
return () => window.removeEventListener("paste", onPaste as any);
}, [activeBg]);

/* ===== Keyboard ===== */
useEffect(() => {
const onKey = (e: KeyboardEvent) => {
if (e.key === "Escape") setPickAnchor(false);

  if (["z","y"].includes(e.key) && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (e.key === "z") undo(); else redo();
    return;
  }

  const isArrowKey = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key);
  if (!isArrowKey) return;
  e.preventDefault();

  // Move selected point
  if (selectedPoint) {
    const { seriesIndex, pointIndex } = selectedPoint;
    const pt = series[seriesIndex].points[pointIndex];
    const { px, py } = dataToPixel(pt.x, pt.y);
    const step = e.shiftKey ? 10 : 1;
    let newPx = px, newPy = py;
    if (e.key === "ArrowLeft") newPx -= step;
    if (e.key === "ArrowRight") newPx += step;
    if (e.key === "ArrowUp") newPy -= step;
    if (e.key === "ArrowDown") newPy += step;
    const newData = pixelToData(newPx, newPy);
    setSeries(cur => cur.map((s, si) =>
      si !== seriesIndex ? s : { ...s, points: s.points.map((p, pi) => pi !== pointIndex ? p : newData) }
    ));
    pushHistory();
    return;
  }

  // Move image
  if (bgEditMode) {
    const step = e.shiftKey ? 10 : 1;
    setBgXform(cur => {
      const n = [...cur] as [BgXf, BgXf];
      const xf = n[activeBg];
      let { offX, offY } = xf;
      if (e.key === "ArrowLeft") offX -= step;
      if (e.key === "ArrowRight") offX += step;
      if (e.key === "ArrowUp") offY -= step;
      if (e.key === "ArrowDown") offY += step;
      n[activeBg] = { ...xf, offX, offY };
      return n;
    });
    pushHistory();
  }
};
window.addEventListener("keydown", onKey);
return () => window.removeEventListener("keydown", onKey);


}, [selectedPoint, bgEditMode, activeBg, series]);

useEffect(() => {
if (!bgEditMode) { dragRef.current.active = false; resizeRef.current.active = false; setHoverHandle("none"); setPickAnchor(false); }
}, [bgEditMode]);

/* ===== Drawing ===== */
useEffect(() => {
try {
const c = canvasRef.current; if (!c) return; const ctx = c.getContext("2d"); if (!ctx) return;
const r = innerRect();
ctx.clearRect(0, 0, size.w, size.h);
ctx.fillStyle = "#F3F4F6"; ctx.fillRect(0, 0, size.w, size.h);
ctx.fillStyle = "#fff"; ctx.fillRect(r.x, r.y, r.w, r.h);
lastRectRef.current = null;

  // Images
  for (let i = 0 as 0 | 1; i <= 1; i = ((i + 1) as 0 | 1)) {
    const img = bgRefs.current[i], meta = bgList[i];
    if (!img || !meta || !showAB[i] || opacityAB[i] <= 0) continue;
    const { dx, dy, dw, dh, ax, ay } = drawRectAndAnchor(i);
    ctx.globalAlpha = opacityAB[i]; ctx.drawImage(img as any, dx, dy, dw, dh); ctx.globalAlpha = 1;
    if (i === activeBg) lastRectRef.current = { x: dx, y: dy, w: dw, h: dh };

    if (i === activeBg && pickAnchor) {
      ctx.save(); ctx.strokeStyle = "#F59E0B"; ctx.fillStyle = "#F59E0B";
      ctx.beginPath(); ctx.arc(ax, ay, 6, 0, Math.PI * 2); ctx.globalAlpha = 0.15; ctx.fill(); ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.moveTo(ax - 8, ay); ctx.lineTo(ax + 8, ay);
      ctx.moveTo(ax, ay - 8); ctx.lineTo(ax, ay + 8); ctx.stroke(); ctx.restore();
    }
    if (i === activeBg && bgEditMode) {
      const lr = lastRectRef.current!, H = 12; ctx.save();
      const hs = [
        { x: lr.x + lr.w, y: lr.y + lr.h / 2, m: "right" as Handle },
        { x: lr.x, y: lr.y + lr.h / 2, m: "left" as Handle },
        { x: lr.x + lr.w / 2, y: lr.y, m: "top" as Handle },
        { x: lr.x + lr.w / 2, y: lr.y + lr.h, m: "bottom" as Handle },
        { x: lr.x + lr.w, y: lr.y + lr.h, m: "uniform" as Handle },
      ];
      for (const h of hs) {
        ctx.fillStyle = h.m === "uniform" ? "#111827" : "#1F2937";
        ctx.globalAlpha = hoverHandle === h.m ? 1 : 0.9;
        ctx.fillRect(h.x - H / 2, h.y - H / 2, H, H);
        ctx.fillStyle = "#fff"; ctx.globalAlpha = 1;
        ctx.fillRect(h.x - (H / 2 - 2), h.y - (H / 2 - 2), H - 4, H - 4);
      }
      ctx.restore();
    }
  }

  drawGrid(ctx);

  // Guides X
  if (guideXs.length) {
    const rr = innerRect(); ctx.save(); ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5;
    for (const gx of guideXs) {
      const gp = dataToPixel(gx, 1); ctx.strokeStyle = "#EF4444";
      ctx.beginPath(); ctx.moveTo(gp.px, rr.y); ctx.lineTo(gp.px, rr.y + rr.h); ctx.stroke();
      series.forEach((s) => {
        const y = yAtX(s.points, gx); if (y === null || !isFinite(y)) return; const P = dataToPixel(gx, y);
        if (showCrossFromX) { ctx.strokeStyle = "rgba(239,68,68,0.5)"; ctx.beginPath(); ctx.moveTo(rr.x, P.py); ctx.lineTo(rr.x + rr.w, P.py); ctx.stroke(); }
        ctx.fillStyle = "#EF4444"; ctx.beginPath(); ctx.arc(P.px, P.py, 4, 0, Math.PI * 2); ctx.fill();
        ctx.save(); ctx.font = "11px ui-sans-serif, system-ui"; ctx.fillStyle = "#0f172a"; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
        ctx.fillText(`${s.name}: y=${fmtReal(y)}`, P.px + 6, P.py - 2); ctx.restore();
      });
    } ctx.restore();
  }

  // Guides Y
  if (guideYs.length) {
    const rr = innerRect(); ctx.save(); ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5;
    for (const gy of guideYs) {
      const gp = dataToPixel(1, gy); ctx.strokeStyle = "#3B82F6";
      ctx.beginPath(); ctx.moveTo(rr.x, gp.py); ctx.lineTo(rr.x + rr.w, gp.py); ctx.stroke();
      series.forEach((s) => {
        const x = xAtY(s.points, gy); if (x === null || !isFinite(x)) return; const P = dataToPixel(x, gy);
        if (showCrossFromY) { ctx.strokeStyle = "rgba(59,130,246,0.5)"; ctx.beginPath(); ctx.moveTo(P.px, rr.y); ctx.lineTo(P.px, rr.y + rr.h); ctx.stroke(); }
        ctx.fillStyle = "#3B82F6"; ctx.beginPath(); ctx.arc(P.px, P.py, 4, 0, Math.PI * 2); ctx.fill();
        ctx.save(); ctx.font = "11px ui-sans-serif, system-ui"; ctx.fillStyle = "#0f172a"; ctx.textAlign = "left"; ctx.textBaseline = "top";
        ctx.fillText(`${s.name}: x=${fmtReal(x)}`, P.px + 6, P.py + 2); ctx.restore();
      });
    } ctx.restore();
  }

  // Lines
  if (connectLines) {
    const rr = innerRect(); ctx.save(); ctx.beginPath(); ctx.rect(rr.x, rr.y, rr.w, rr.h); ctx.clip();
    ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.globalAlpha = lineAlpha; ctx.lineWidth = lineWidth;
    for (const s of series) {
      if (s.points.length < 2) continue;
      const pxPts = s.points.map(p => dataToPixel(p.x, p.y));
      ctx.strokeStyle = s.color; ctx.beginPath();
      if (smoothLines && pxPts.length >= 2) catmullRomPath(ctx, pxPts, smoothAlpha);
      else { ctx.moveTo(pxPts[0].px, pxPts[0].py); for (let i = 1; i < pxPts.length; i++) ctx.lineTo(pxPts[i].px, pxPts[i].py); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.restore();
  }

  // Points
  if (showPoints) {
    series.forEach((s, si) => {
      ctx.fillStyle = s.color; ctx.strokeStyle = "#fff";
      s.points.forEach((p, pi) => {
        const P = dataToPixel(p.x, p.y);
        ctx.beginPath(); ctx.arc(P.px, P.py, ptRadius, 0, Math.PI * 2); ctx.fill();
        if (ptRadius >= 3) { ctx.lineWidth = 1; ctx.stroke(); }
        if (selectedPoint?.seriesIndex === si && selectedPoint?.pointIndex === pi) {
          ctx.strokeStyle = "#2563EB"; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(P.px, P.py, ptRadius + 3, 0, Math.PI * 2); ctx.stroke();
        }
      });
    });
  }

  // Cursor crosshair & labels
  if (hoverRef.current.x !== null && hoverRef.current.y !== null) {
    const P = dataToPixel(hoverRef.current.x, hoverRef.current.y), rr = innerRect();
    ctx.save(); ctx.strokeStyle = "#94a3b8"; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(P.px, rr.y); ctx.lineTo(P.px, rr.y + rr.h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rr.x, P.py); ctx.lineTo(rr.x + rr.w, P.py); ctx.stroke(); ctx.restore();
    drawCross(ctx, P.px, P.py, 7);
  }

  // Frame + axis labels
  ctx.strokeStyle = "#374151"; ctx.lineWidth = 1.2; ctx.strokeRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = "#111827"; ctx.font = "14px ui-sans-serif, system-ui"; ctx.textAlign = "center"; ctx.fillText(xLog ? "X (10^n)" : "X", r.x + r.w / 2, r.y + r.h + 34);
  ctx.save(); ctx.translate(r.x - 45, r.y + r.h / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(yLog ? "Y (10^n)" : "Y", 0, 0); ctx.restore();

  // Magnifier
  if (magnifyOn && hoverRef.current.x !== null && hoverRef.current.y !== null) {
    const hp = dataToPixel(hoverRef.current.x!, hoverRef.current.y!);
    const sz = 120, f = magnifyFactor; const sx = Math.max(0, Math.min(size.w - sz / f, hp.px - sz / (2 * f))), sy = Math.max(0, Math.min(size.h - sz / f, hp.py - sz / (2 * f)));
    ctx.save(); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(c, sx, sy, sz / f, sz / f, size.w - sz - 16, 16, sz, sz);
    ctx.strokeStyle = "#111827"; ctx.lineWidth = 2; ctx.strokeRect(size.w - sz - 16, 16, sz, sz);
    ctx.beginPath(); ctx.moveTo(size.w - sz - 16 + sz / 2, 16); ctx.lineTo(size.w - sz - 16 + sz / 2, 16 + sz);
    ctx.moveTo(size.w - sz - 16, 16 + sz / 2); ctx.lineTo(size.w - 16, 16 + sz / 2); ctx.stroke(); ctx.restore();
  }

  // Legend
  ctx.save();
  const rr2 = innerRect(); ctx.font = "600 16px ui-sans-serif, system-ui";
  let lx = rr2.x + 10, ly = rr2.y + 20; const box = 12, gap = 10;
  series.forEach((s, i) => {
    ctx.fillStyle = s.color; ctx.fillRect(lx, ly - box + 2, box, box);
    ctx.fillStyle = "#0f172a"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillText(`${s.name} (${s.points.length})${i === activeSeries ? "  ◀" : ""}`, lx + box + gap, ly + 2);
    ly += 22;
  });
  ctx.restore();
} catch (err) { console.error("draw error", err); }


}, [xMin, xMax, yMin, yMax, xLog, yLog, series, connectLines, lineWidth, lineAlpha, smoothLines, smoothAlpha, ptRadius, showPoints, bgList, showAB, opacityAB, activeBg, keepAspect, bgXform, anchorMode, customAnchors, hoverHandle, pickAnchor, magnifyOn, magnifyFactor, activeSeries, guideXs, guideYs, showCrossFromX, showCrossFromY, selectedPoint, tick]);

function drawCross(ctx: CanvasRenderingContext2D, x: number, y: number, r = 5) { ctx.save(); ctx.strokeStyle = "#2563EB"; ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke(); ctx.restore(); }
function catmullRomPath(ctx: CanvasRenderingContext2D, pts: { px: number; py: number }[], alpha = 0.5) {
if (pts.length < 2) { const p = pts[0]; ctx.moveTo(p.px, p.py); return; }
ctx.moveTo(pts[0].px, pts[0].py);
for (let i = 0; i < pts.length - 1; i++) {
const p0 = i === 0 ? pts[0] : pts[i - 1];
const p1 = pts[i];
const p2 = pts[i + 1];
const p3 = i + 2 < pts.length ? pts[i + 2] : pts[pts.length - 1];
const c1x = p1.px + (p2.px - p0.px) / 6 * (1 - alpha);
const c1y = p1.py + (p2.py - p0.py) / 6 * (1 - alpha);
const c2x = p2.px - (p3.px - p1.px) / 6 * (1 - alpha);
const c2y = p2.py - (p3.py - p1.py) / 6 * (1 - alpha);
ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.px, p2.py);
}
}
const SUPMAP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻", "+": "⁺", ".": "." };
function supify(exp: number | string) { return String(exp).split("").map(ch => SUPMAP[ch] ?? ch).join(""); }
function pow10LabelInt(n: number) { return 10${supify(n)}; }
function numFmt(v: number, step?: number) {
if (!isFinite(v)) return "";
const abs = Math.abs(v); if (abs === 0) return "0";
const d = step !== undefined ? Math.max(0, Math.min(6, -Math.floor(Math.log10(Math.max(1e-12, step))))) : Math.max(0, Math.min(6, 3 - Math.floor(Math.log10(Math.max(1e-12, abs)))));
if (abs >= 1e5 || abs < 1e-3) return v.toExponential(2);
return v.toFixed(d);
}
function drawGrid(ctx: CanvasRenderingContext2D) {
const r = innerRect(), mm = tMinMax();
if (!isFinite(mm.xmin) || !isFinite(mm.xmax) || !isFinite(mm.ymin) || !isFinite(mm.ymax) || mm.xmax <= mm.xmin || mm.ymax <= mm.ymin) {
ctx.save(); ctx.fillStyle = "#9CA3AF"; ctx.font = "12px ui-sans-serif, system-ui"; ctx.fillText("Invalid axis range", r.x + r.w / 2, r.y + r.h / 2); ctx.restore(); return;
}
ctx.save(); ctx.strokeStyle = "#E5E7EB"; ctx.fillStyle = "#6B7280"; ctx.lineWidth = 1; ctx.font = "12px ui-sans-serif, system-ui";
if (xLog) { const n0 = Math.floor(mm.xmin), n1 = Math.ceil(mm.xmax); for (let n = n0; n <= n1; n++) { const px = dataToPixel(Math.pow(10, n), 1).px; ctx.beginPath(); ctx.moveTo(px, r.y); ctx.lineTo(px, r.y + r.h); ctx.stroke(); ctx.textAlign = "center"; ctx.fillText(pow10LabelInt(n), px, r.y + r.h + 18); for (let m = 2; m < 10; m++) { const v = Math.pow(10, n) * m, lv = Math.log10(v); if (lv > mm.xmax) break; if (lv < mm.xmin) continue; const xm = dataToPixel(v, 1).px; ctx.save(); ctx.strokeStyle = "#F3F4F6"; ctx.beginPath(); ctx.moveTo(xm, r.y); ctx.lineTo(xm, r.y + r.h); ctx.stroke(); ctx.restore(); } } } else { const steps = 10; for (let i = 0; i <= steps; i++) { const t = i / steps, px = r.x + t * r.w; ctx.beginPath(); ctx.moveTo(px, r.y); ctx.lineTo(px, r.y + r.h); ctx.stroke(); ctx.textAlign = "center"; ctx.fillText(numFmt(xMin + t * (xMax - xMin), (xMax - xMin) / 10), px, r.y + r.h + 18); } }
if (yLog) { const n0 = Math.floor(mm.ymin), n1 = Math.ceil(mm.ymax); for (let n = n0; n <= n1; n++) { const py = dataToPixel(1, Math.pow(10, n)).py; ctx.beginPath(); ctx.moveTo(r.x, py); ctx.lineTo(r.x + r.w, py); ctx.stroke(); ctx.textAlign = "right"; ctx.fillText(pow10LabelInt(n), r.x - 6, py + 4); for (let m = 2; m < 10; m++) { const v = Math.pow(10, n) * m, lv = Math.log10(v); if (lv > mm.ymax) break; if (lv < mm.ymin) continue; const ym = dataToPixel(1, v).py; ctx.save(); ctx.strokeStyle = "#F3F4F6"; ctx.beginPath(); ctx.moveTo(r.x, ym); ctx.lineTo(r.x + r.w, ym); ctx.stroke(); ctx.restore(); } } } else { const steps = 10; for (let i = 0; i <= steps; i++) { const t = i / steps, py = r.y + (1 - t) * r.h, val = yMin + t * (yMax - yMin); ctx.beginPath(); ctx.moveTo(r.x, py); ctx.lineTo(r.x + r.w, py); ctx.stroke(); ctx.textAlign = "right"; ctx.fillText(numFmt(val, (yMax - yMin) / 10), r.x - 6, py + 4); } }
ctx.restore();
}

/* ===== Pointer & canvas events ===== */
const canvasPoint = (e: { clientX: number; clientY: number }) => { const c = canvasRef.current!, rc = c.getBoundingClientRect(); const sx = c.width / rc.width, sy = c.height / rc.height; return { px: (e.clientX - rc.left) * sx, py: (e.clientY - rc.top) * sy }; };
const inPlot = (px: number, py: number) => { const r = innerRect(), T = 14; return px >= r.x - T && px <= r.x + r.w + T && py >= r.y - T && py <= r.y + r.h + T; };
const overImage = (px: number, py: number, p = 14) => { const lr = lastRectRef.current; if (!lr) return false; return px >= lr.x - p && px <= lr.x + lr.w + p && py >= lr.y - p && py <= lr.y + lr.h + p; };
const pickHandle = (px: number, py: number): Handle => {
const lr = lastRectRef.current; if (!lr) return "none";
const H = 12, hit = (hx: number, hy: number) => Math.abs(px - hx) <= H && Math.abs(py - hy) <= H;
const right = hit(lr.x + lr.w, lr.y + lr.h / 2) ? "right" : "none";
const left = hit(lr.x, lr.y + lr.h / 2) ? "left" : "none";
const top = hit(lr.x + lr.w / 2, lr.y) ? "top" : "none";
const bottom = hit(lr.x + lr.w / 2, lr.y + lr.h) ? "bottom" : "none";
const corner = hit(lr.x + lr.w, lr.y + lr.h) ? "uniform" : "none";
return right !== "none" ? right : left !== "none" ? left : top !== "none" ? top : bottom !== "none" ? bottom : corner;
};

const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
const { px, py } = canvasPoint(e); const rr = innerRect();
hoverRef.current = px >= rr.x && px <= rr.x + rr.w && py >= rr.y && py <= rr.y + rr.h ? pixelToData(px, py) : { x: null, y: null };
if (pickAnchor) { setHoverHandle("none"); return; }
if (resizeRef.current.active && bgEditMode) {
const { fx, fy, ax, ay, baseW, baseH, mode } = resizeRef.current;
let { dw, dh } = drawRectAndAnchor(activeBg); const safe = (v: number) => Math.abs(v) < 1e-6 ? 1e-6 : v;
if (mode === "right") dw = (px - ax) / safe(1 - fx);
else if (mode === "left") dw = (ax - px) / safe(fx);
else if (mode === "bottom") dh = (py - ay) / safe(1 - fy);
else if (mode === "top") dh = (ay - py) / safe(fy);
else if (mode === "uniform") {
const dwX = px >= ax ? (px - ax) / safe(1 - fx) : (ax - px) / safe(fx);
const dhY = py >= ay ? (py - ay) / safe(1 - fy) : (ay - py) / safe(fy);
if (keepAspect) { const s = Math.max(dwX / baseW, dhY / baseH); dw = baseW * s; dh = baseH * s; }
else { dw = dwX; dh = dhY; }
}
const nsx = clampS(dw / baseW), nsy = clampS(dh / baseH);
setBgXform((cur) => { const n = [...cur] as [BgXf, BgXf]; const xf = n[activeBg]; n[activeBg] = { ...xf, sx: nsx, sy: keepAspect ? nsx : nsy }; return n; });
return;
}
if (dragRef.current.active && bgEditMode) {
setBgXform((cur) => { const n = [...cur] as [BgXf, BgXf]; const xf = n[activeBg]; n[activeBg] = { ...xf, offX: dragRef.current.baseX + (px - dragRef.current.startX), offY: dragRef.current.baseY + (py - dragRef.current.startY) }; return n; });
return;
}
setHoverHandle(bgEditMode ? pickHandle(px, py) : "none");
setTick(t => (t + 1) & 0xffff);
};

const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
const { px, py } = canvasPoint(e);
if (e.button === 2) { setPickAnchor(false); return; }
if (pickAnchor && overImage(px, py)) {
const lr = lastRectRef.current; if (!lr) return;
const fx = (px - lr.x) / lr.w, fy = (py - lr.y) / lr.h;
setCustomAnchors((cur) => { const n = [...cur] as [CustomAnchor, CustomAnchor]; n[activeBg] = { ax: px, ay: py, fx: Math.max(0, Math.min(1, fx)), fy: Math.max(0, Math.min(1, fy)) }; return n; });
setAnchorMode("custom"); setPickAnchor(false); pushHistory(); return;
}
if (bgEditMode) {
const h = pickHandle(px, py);
if (h !== "none") { const d = drawRectAndAnchor(activeBg); resizeRef.current = { active: true, mode: h, ax: d.ax, ay: d.ay, fx: d.fx, fy: d.fy, baseW: d.baseW, baseH: d.baseH }; return; }
if (overImage(px, py)) { dragRef.current = { active: true, startX: px, startY: py, baseX: bgXform[activeBg].offX, baseY: bgXform[activeBg].offY }; setSelectedPoint(null); return; }
}
if (inPlot(px, py)) {
// select near point
for (let si = 0; si < series.length; si++) {
for (let pi = 0; pi < series[si].points.length; pi++) {
const p = series[si].points[pi];
const { px: ppx, py: ppy } = dataToPixel(p.x, p.y);
if (Math.hypot(px - ppx, py - ppy) < ptRadius + 4) { setSelectedPoint({ seriesIndex: si, pointIndex: pi }); return; }
}
}
// add point
const d = pixelToData(px, py);
setSeries((arr) => arr.map((s, i) => i === activeSeries ? { ...s, points: [...s.points, { x: d.x, y: d.y }] } : s));
setSelectedPoint(null); pushHistory();
}
};

const onMouseUp = () => {
if (dragRef.current.active || resizeRef.current.active) { dragRef.current.active = false; resizeRef.current.active = false; pushHistory(); }
setTick(t => t + 1);
};
const onMouseLeave = () => { hoverRef.current = { x: null, y: null }; setHoverHandle("none"); dragRef.current.active = false; resizeRef.current.active = false; setTick(t => t + 1); };
const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
if (!bgEditMode) return;
e.preventDefault();
const k = e.deltaY < 0 ? 1.05 : 0.95;
setBgXform((cur) => { const n = [...cur] as [BgXf, BgXf]; const xf = n[activeBg]; const nsx = clampS(xf.sx * k); const nsy = clampS(xf.sy * (keepAspect ? k : k)); n[activeBg] = { ...xf, sx: nsx, sy: keepAspect ? nsx : nsy }; return n; });
setTick(t => (t + 1) & 0xffff);
};

/* ===== Preset ===== */
const serialize = () => ({
v: 1, axes: { xMin, xMax, yMin, yMax, xLog, yLog }, series, ui: { activeSeries },
connect: { connectLines, lineWidth, lineAlpha, smoothLines, smoothAlpha },
bg: { keepAspect, anchorMode, customAnchors, activeBg, showAB, opacityAB, xform: bgXform },
images: bgUrls.current,
guidesX: guideXs, guidesY: guideYs,
cross: { fromX: showCrossFromX, fromY: showCrossFromY },
});

const applyPreset = (p: any, push = true) => {
try {
if (!p) return;
if (p.axes) { setXMin(p.axes.xMin); setXMax(p.axes.xMax); setYMin(p.axes.yMin); setYMax(p.axes.yMax); setXLog(!!p.axes.xLog); setYLog(!!p.axes.yLog); }
if (Array.isArray(p.series)) setSeries(p.series);
if (p.ui) setActiveSeries(p.ui.activeSeries ?? 0);
if (p.connect) { setConnectLines(!!p.connect.connectLines); setLineWidth(p.connect.lineWidth ?? 1.6); setLineAlpha(p.connect.lineAlpha ?? 0.9); setSmoothLines(!!p.connect.smoothLines); setSmoothAlpha(p.connect.smoothAlpha ?? 0.35); }
if (p.bg) {
setKeepAspect(!!p.bg.keepAspect);
if (p.bg.anchorMode) setAnchorMode(p.bg.anchorMode);
if (Array.isArray(p.bg.customAnchors)) setCustomAnchors(p.bg.customAnchors);
if (typeof p.bg.activeBg !== "undefined") setActiveBg(p.bg.activeBg);
if (Array.isArray(p.bg.showAB)) setShowAB(p.bg.showAB);
if (Array.isArray(p.bg.opacityAB)) setOpacityAB(p.bg.opacityAB);
if (Array.isArray(p.bg.xform)) setBgXform(p.bg.xform);
}
if (Array.isArray(p.images)) {
p.images.forEach((src: string | null, idx: number) => {
if (!src) return;
const i = new Image(); i.crossOrigin = "anonymous";
i.onload = () => {
bgRefs.current[idx] = i; bgUrls.current[idx] = src;
setBgList(cur => { const n = [...cur]; n[idx] = { w: i.width, h: i.height }; return n; });
};
i.src = src;
});
}
if (Array.isArray(p.guidesX)) setGuideXs(p.guidesX);
if (Array.isArray(p.guidesY)) setGuideYs(p.guidesY);
if (p.cross) { setShowCrossFromX(!!p.cross.fromX); setShowCrossFromY(!!p.cross.fromY); }
if (push) pushHistory();
} catch (e) { console.warn("applyPreset fail", e); }
};

const savePresetFile = async () => {
const data = JSON.stringify(serialize(), null, 2);
try {
if (typeof (window as any).showSaveFilePicker === "function") {
const handle = await (window as any).showSaveFilePicker({
suggestedName: digitizer_preset_${Date.now()}.json,
types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
});
const w = await handle.createWritable();
await w.write(new Blob([data], { type: "application/json" }));
await w.close(); notify("Preset saved.");
return;
}
} catch (err) { console.warn("picker fail; fallback", err); }
try {
const blob = new Blob([data], { type: "application/json" });
const url = URL.createObjectURL(blob);
const a = document.createElement("a"); a.href = url; a.download = digitizer_preset_${Date.now()}.json;
document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
notify("Download started.");
} catch { notify("Download blocked", "err"); }
};

const loadPresetFromFile = (file: File | null) => {
if (!file) return;
const fr = new FileReader();
fr.onload = () => {
try { applyPreset(JSON.parse(String(fr.result || "{}"))); notify("Preset loaded."); }
catch { notify("Invalid preset", "err"); }
};
fr.readAsText(file);
};

const copyShareURL = () => {
try {
const enc = btoa(unescape(encodeURIComponent(JSON.stringify(serialize()))));
const url = ${location.origin}${location.pathname}#s=${enc};
navigator.clipboard?.writeText(url);
notify("Share URL copied!");
} catch { notify("Copy failed", "err"); }
};

// Auto save, Auto load
useEffect(() => { try { localStorage.setItem("digitizer:auto", JSON.stringify(serialize())); } catch { } },
[xMin, xMax, yMin, yMax, xLog, yLog, series, activeSeries, connectLines, lineWidth, lineAlpha, smoothLines, smoothAlpha, keepAspect, anchorMode, customAnchors, activeBg, showAB, opacityAB, bgXform, guideXs, guideYs, showCrossFromX, showCrossFromY]);
useEffect(() => {
const h = location.hash || "";
if (h.startsWith("#s=")) { try { applyPreset(JSON.parse(decodeURIComponent(escape(atob(h.slice(3)))))); return; } catch { } }
try { const raw = localStorage.getItem("digitizer:auto"); if (raw) applyPreset(JSON.parse(raw), false); } catch { }
}, []);

/* ===== UI ===== */
const cursorStyle = () => {
if (pickAnchor) return "crosshair";
if (!bgEditMode) return "crosshair";
switch (hoverHandle) {
case "left":
case "right": return "ew-resize";
case "top":
case "bottom": return "ns-resize";
case "uniform": return "nwse-resize";
default: return overImage( Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY) ? "move" : "move";
}
};

return (
<div className="min-h-screen bg-gray-100 text-gray-800">
{/* Top bar */}
<header className="sticky top-0 z-20 flex items-center justify-between border-b border-gray-200 bg-white/80 p-4 backdrop-blur-sm">
<h1 className="text-lg font-semibold">Log-scale Graph Digitizer</h1>
<div className="flex items-center gap-2">
<button onClick={undo} className="rounded-lg bg-gray-200 px-3 py-1.5 hover:bg-gray-300">Undo</button>
<button onClick={redo} className="rounded-lg bg-gray-200 px-3 py-1.5 hover:bg-gray-300">Redo</button>
<div className="mx-2 h-5 w-px bg-gray-300" />
<button onClick={savePresetFile} className="rounded-lg bg-gray-200 px-3 py-1.5 hover:bg-gray-300">Save Preset</button>
<button onClick={() => presetFileRef.current?.click()} className="rounded-lg bg-gray-200 px-3 py-1.5 hover:bg-gray-300">Load Preset</button>
<input ref={presetFileRef} type="file" accept="application/json" style={{ display: "none" }}
onChange={(e) => { const f = e.target.files?.[0]; if (f) loadPresetFromFile(f); (e.target as any).value = ""; }} />
<button onClick={copyShareURL} className="rounded-lg bg-gray-200 px-3 py-1.5 hover:bg-gray-300">Copy URL</button>
<div className="mx-2 h-5 w-px bg-gray-300" />
<button onClick={() => {
let out = "series,x,y\n";
series.forEach(s => s.points.forEach(p => out += ${s.name},${p.x},${p.y}\n));
const url = URL.createObjectURL(new Blob([out], { type: "text/csv" }));
const a = document.createElement("a"); a.href = url; a.download = points_${Date.now()}.csv; a.click();
setTimeout(() => URL.revokeObjectURL(url), 0);
}} className="rounded-lg bg-gray-200 px-3 py-1.5 hover:bg-gray-300">Export CSV</button>
<button onClick={() => { const c = canvasRef.current; if (!c) return; const url = c.toDataURL("image/png"); const a = document.createElement("a"); a.href = url; a.download = digitizer_${Date.now()}.png; a.click(); }} className="rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white hover:bg-blue-700">Export PNG</button>
</div>
</header>

  {/* Layout */}
  <main className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[420px,1fr]">
    {/* Left controls */}
    <aside className="flex flex-col gap-4">
      <Accordion title="Axes & Guides" open={openAxes} onToggle={() => setOpenAxes(v => !v)}>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 flex items-center gap-2"><input type="checkbox" checked={xLog} onChange={(e) => { pushHistory(); setXLog(e.target.checked); }} /> X Log Scale</label>
          <label className="flex items-center gap-2">X Min <input type="number" className="w-full rounded border px-2 py-1" value={xMin} onChange={(e) => { pushHistory(); setXMin(Number(e.target.value)); }} /></label>
          <label className="flex items-center gap-2">X Max <input type="number" className="w-full rounded border px-2 py-1" value={xMax} onChange={(e) => { pushHistory(); setXMax(Number(e.target.value)); }} /></label>
          <label className="col-span-2 mt-1 flex items-center gap-2"><input type="checkbox" checked={yLog} onChange={(e) => { pushHistory(); setYLog(e.target.checked); }} /> Y Log Scale</label>
          <label className="flex items-center gap-2">Y Min <input type="number" className="w-full rounded border px-2 py-1" value={yMin} onChange={(e) => { pushHistory(); setYMin(Number(e.target.value)); }} /></label>
          <label className="flex items-center gap-2">Y Max <input type="number" className="w-full rounded border px-2 py-1" value={yMax} onChange={(e) => { pushHistory(); setYMax(Number(e.target.value)); }} /></label>
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-gray-700">Guides</h4>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={magnifyOn} onChange={(e) => setMagnifyOn(e.target.checked)} /> Magnifier</label>
          </div>

          <div className="flex items-center gap-2">
            <span className="w-5 text-right font-semibold">X</span>
            <input className="flex-grow rounded border px-2 py-1" placeholder="e.g., 1000" value={guideInputX} onChange={(e)=>setGuideInputX(e.target.value)} onKeyDown={(e)=>{ if(e.key==="Enter"){ const v=Number(guideInputX); if(isFinite(v)&&v>0){ pushHistory(); setGuideXs(g=>Array.from(new Set([...g,v])));} } }} />
            <button className="rounded border px-2 py-1" onClick={()=>{ const v=Number(guideInputX); if(isFinite(v)&&v>0){ pushHistory(); setGuideXs(g=>Array.from(new Set([...g,v])));} }}>Add</button>
            <button className="rounded border px-2 py-1" onClick={()=>{ pushHistory(); setGuideXs([]); }}>Clear</button>
            <label className="ml-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={showCrossFromX} onChange={(e)=>setShowCrossFromX(e.target.checked)} /> Cross</label>
          </div>

          <div className="flex items-center gap-2">
            <span className="w-5 text-right font-semibold">Y</span>
            <input className="flex-grow rounded border px-2 py-1" placeholder="e.g., 10" value={guideInputY} onChange={(e)=>setGuideInputY(e.target.value)} onKeyDown={(e)=>{ if(e.key==="Enter"){ const v=Number(guideInputY); if(isFinite(v)&&v>0){ pushHistory(); setGuideYs(g=>Array.from(new Set([...g,v])));} } }} />
            <button className="rounded border px-2 py-1" onClick={()=>{ const v=Number(guideInputY); if(isFinite(v)&&v>0){ pushHistory(); setGuideYs(g=>Array.from(new Set([...g,v])));} }}>Add</button>
            <button className="rounded border px-2 py-1" onClick={()=>{ pushHistory(); setGuideYs([]); }}>Clear</button>
            <label className="ml-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={showCrossFromY} onChange={(e)=>setShowCrossFromY(e.target.checked)} /> Cross</label>
          </div>
        </div>
      </Accordion>

      <Accordion title="Image Edit" open={openImage} onToggle={() => setOpenImage(v => !v)}>
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm text-gray-600">Edit mode</span>
          <button onClick={()=>setBgEditMode(v=>!v)} className={`rounded-full px-3 py-1 text-sm font-semibold ${bgEditMode?"bg-orange-100 text-orange-800":"bg-gray-200 text-gray-700"}`}>{bgEditMode?"ON":"OFF"}</button>
        </div>

        <div className="mb-2 flex border-b">
          <button onClick={() => setActiveBg(0)} className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-semibold ${activeBg===0?"border-blue-500 text-blue-600":"border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"}`}>Image A</button>
          <button onClick={() => setActiveBg(1)} className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-semibold ${activeBg===1?"border-blue-500 text-blue-600":"border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"}`}>Image B</button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => (activeBg===0?fileARef:fileBRef).current?.click()} className="col-span-2 rounded bg-gray-800 py-2 text-white">Load Image {activeBg===0?"A":"B"}</button>
          <input ref={fileARef} type="file" accept="image/*" style={{display:"none"}} onChange={(e)=>{ const f=e.target.files?.[0]; if(f) onFile(f,0); (e.target as any).value=""; }} />
          <input ref={fileBRef} type="file" accept="image/*" style={{display:"none"}} onChange={(e)=>{ const f=e.target.files?.[0]; if(f) onFile(f,1); (e.target as any).value=""; }} />

          <label className="flex items-center justify-between col-span-2"><span>Show Image</span><input type="checkbox" checked={showAB[activeBg]} onChange={(e)=>setShowAB(cur=>{ const n=[...cur] as [boolean,boolean]; n[activeBg]=e.target.checked; return n; })} /></label>
          <label className="col-span-2 flex items-center gap-2"><span>Opacity</span><input type="range" min={0} max={1} step={0.05} value={opacityAB[activeBg]} onChange={(e)=>setOpacityAB(cur=>{ const n=[...cur] as [number,number]; n[activeBg]=Number(e.target.value); return n; })} /></label>

          <div className="col-span-2 mt-1 flex items-center gap-2 border-t pt-3">
            <label className="flex items-center gap-2"><input type="checkbox" checked={keepAspect} onChange={(e)=>setKeepAspect(e.target.checked)} /> Keep ratio</label>
            <button onClick={()=>setPickAnchor(v=>!v)} className={`ml-auto rounded px-3 py-1.5 text-sm font-semibold ${pickAnchor?"bg-orange-100 text-orange-800":"bg-gray-200 text-gray-800"}`}>{pickAnchor?"Picking…":"Pick Anchor"}</button>
            <button onClick={()=>{ setCustomAnchors(cur=>{ const n=[...cur] as [CustomAnchor,CustomAnchor]; n[activeBg]=null; return n; }); }} className="rounded bg-gray-200 px-3 py-1.5 text-sm">Clear Anchor</button>
          </div>
        </div>
      </Accordion>

      <Accordion title="Series & Points" open={openSeries} onToggle={() => setOpenSeries(v => !v)}>
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <span className="text-sm">Active:</span>
            <label className="flex items-center gap-2"><input type="radio" name="s" checked={activeSeries===0} onChange={()=>{ setActiveSeries(0); setSelectedPoint(null); }} /> Series A</label>
            <label className="flex items-center gap-2"><input type="radio" name="s" checked={activeSeries===1} onChange={()=>{ setActiveSeries(1); setSelectedPoint(null); }} /> Series B</label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">Name A<input className="mt-1 w-full rounded border px-2 py-1" value={series[0].name} onChange={(e)=>setSeries(arr=>arr.map((s,i)=>i===0?{...s,name:e.target.value}:s))} /></label>
            <label className="text-sm">Name B<input className="mt-1 w-full rounded border px-2 py-1" value={series[1].name} onChange={(e)=>setSeries(arr=>arr.map((s,i)=>i===1?{...s,name:e.target.value}:s))} /></label>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t pt-3">
            <label className="col-span-2 flex items-center gap-2"><input type="checkbox" checked={connectLines} onChange={(e)=>setConnectLines(e.target.checked)} /> Connect points with a line</label>
            <label className="flex items-center gap-2">Width<input className="w-full rounded border px-2 py-1" value={lineWidth} onChange={(e)=>setLineWidth(Number(e.target.value)||1)} /></label>
            <label className="flex items-center gap-2">Alpha<input type="range" min={0} max={1} step={0.05} value={lineAlpha} onChange={(e)=>setLineAlpha(Number(e.target.value))} className="w-full" /></label>
            <label className="col-span-2 flex items-center gap-2"><input type="checkbox" checked={smoothLines} onChange={(e)=>setSmoothLines(e.target.checked)} /> Smooth curve (Catmull-Rom)</label>
            {smoothLines && <label className="col-span-2 flex items-center gap-2">Strength<input type="range" min={0} max={0.9} step={0.05} value={smoothAlpha} onChange={(e)=>setSmoothAlpha(Number(e.target.value))} className="w-full" /></label>}
            <label className="col-span-2 flex items-center gap-2 border-t pt-3"><input type="checkbox" checked={showPoints} onChange={(e)=>setShowPoints(e.target.checked)} /> Show points</label>
            <label className="col-span-2 flex items-center gap-2">Point size<input type="range" min={1} max={8} step={1} value={ptRadius} onChange={(e)=>setPtRadius(Number(e.target.value))} className="w-full" /></label>
          </div>

          <div className="flex items-center gap-3 border-t pt-3">
            <button onClick={()=>setSeries(arr=>arr.map((s,i)=> i===activeSeries?{...s,points:s.points.slice(0,-1)}:s))} className="rounded bg-gray-200 px-3 py-1.5">Undo last point</button>
            <button onClick={()=>setSeries(arr=>arr.map((s,i)=> i===activeSeries?{...s,points:[]}:s))} className="rounded bg-gray-200 px-3 py-1.5 text-red-700">Clear active series</button>
          </div>
        </div>
      </Accordion>
    </aside>

    {/* Canvas */}
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-3 h-6 text-sm text-gray-600">
        {hoverRef.current.x !== null && hoverRef.current.y !== null
          ? <span className="font-mono">Cursor: X={fmtReal(hoverRef.current.x)} , Y={fmtReal(hoverRef.current.y)}</span>
          : <span>Hover over the graph area to see coordinates.</span>}
      </div>
      <div className="overflow-hidden rounded-lg border border-gray-300">
        <canvas
          ref={canvasRef}
          width={size.w}
          height={size.h}
          className="block touch-none select-none"
          style={{ cursor: cursorStyle() }}
          onMouseMove={onMouseMove}
          onMouseDown={onMouseDown}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
          onWheel={onWheel}
          onDragOver={(e)=>e.preventDefault()}
          onDrop={(e)=>{ e.preventDefault(); const f=e.dataTransfer?.files?.[0]; if(f && /^image\//.test(f.type)) onFile(f as File, activeBg); }}
          onContextMenu={(e)=>{ e.preventDefault(); if(pickAnchor) setPickAnchor(false); }}
        />
      </div>
    </section>
  </main>

  {toast && (
    <div className={`fixed bottom-6 right-6 rounded-xl px-4 py-2 text-sm text-white shadow-lg ${toast.kind==="err"?"bg-red-600":"bg-gray-900"}`}>
      {toast.msg}
    </div>
  )}
</div>


);
}
