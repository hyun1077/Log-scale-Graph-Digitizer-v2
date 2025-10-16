/* @ts-nocheck */
import { useEffect, useRef, useState } from "react";

/**
 * Log-scale Graph Digitizer — single file
 * v4.2
 * - fix: Undo/Redo 로직 수정으로 상태 업데이트 오류 해결 (드래그, 프리셋 로드 정상화)
 * - UI: Magnifier, Guides, Header 버튼 재배치
 * - UI: 우측(하단) 좌표 패널 추가
 */

type Pt = { x: number; y: number };
type Series = { name: string; color: string; points: Pt[] };
type Handle = "none" | "left" | "right" | "top" | "bottom" | "uniform";
type BgXf = { sx: number; sy: number; offX: number; offY: number };
type CustomAnchor = { ax: number; ay: number; fx: number; fy: number } | null;
type SelectedPoint = { seriesIndex: number; pointIndex: number } | null;

type AppState = {
  xMin: number; xMax: number; yMin: number; yMax: number;
  xLog: boolean; yLog: boolean;
  series: Series[];
  bgXform: [BgXf, BgXf];
  customAnchors: [CustomAnchor | null, CustomAnchor | null];
};

const AccordionSection = ({ title, children, isOpen, onToggle }) => (
  <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
    <button onClick={onToggle} className="flex w-full items-center justify-between p-5 text-left">
      <h3 className="text-lg font-bold text-gray-800">{title}</h3>
      <span className={`transform text-gray-500 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}>▼</span>
    </button>
    {isOpen && <div className="space-y-4 p-5 pt-0 text-base">{children}</div>}
  </div>
);

export default function App() {
  /* ==== Refs & UI State ==== */
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileARef = useRef<HTMLInputElement | null>(null);
  const fileBRef = useRef<HTMLInputElement | null>(null);
  const presetFileRef = useRef<HTMLInputElement | null>(null);
  const bgRefs = useRef<[HTMLImageElement | null, HTMLImageElement | null]>([null, null]);
  const bgUrls = useRef<[string | null, string | null]>([null, null]);
  const lastRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const hoverRef = useRef<{ x: number | null; y: number | null }>({ x: null, y: null });
  
  const [size] = useState({ w: 960, h: 560 });
  const [pad] = useState({ left: 60, right: 20, top: 30, bottom: 46 });
  const [axesOpen, setAxesOpen] = useState(true);
  const [activeSeries, setActiveSeries] = useState(0);
  const [selectedPoint, setSelectedPoint] = useState<SelectedPoint>(null);
  const [connectLines, setConnectLines] = useState(true);
  const [lineWidth, setLineWidth] = useState(1.6);
  const [lineAlpha, setLineAlpha] = useState(0.9);
  const [smoothLines, setSmoothLines] = useState(true);
  const [smoothAlpha, setSmoothAlpha] = useState(0.35);
  const [ptRadius, setPtRadius] = useState(5);
  const [showPoints, setShowPoints] = useState(true);
  const [magnifyOn, setMagnifyOn] = useState(false);
  const [magnifyFactor, setMagnifyFactor] = useState(3);
  const [bgList, setBgList] = useState<Array<{ w: number; h: number } | null>>([null, null]);
  const [keepAspect, setKeepAspect] = useState(false);
  const [showAB, setShowAB] = useState<[boolean, boolean]>([true, true]);
  const [opacityAB, setOpacityAB] = useState<[number, number]>([1, 0.6]);
  const [activeBg, setActiveBg] = useState<0 | 1>(0);
  const [anchorMode] = useState<"custom" | "center">("custom");
  const [pickAnchor, setPickAnchor] = useState(false);
  const [bgEditMode, setBgEditMode] = useState(false);
  const [hoverHandle, setHoverHandle] = useState<Handle>("none");
  const dragRef = useRef({ active: false, startX: 0, startY: 0, baseX: 0, baseY: 0 });
  const resizeRef = useRef({ active: false, mode: "none" as Handle, ax: 0, ay: 0, fx: 0.5, fy: 0.5, baseW: 1, baseH: 1 });
  const [toast, setToast] = useState<{ msg: string; kind?: "ok" | "err" } | null>(null);
  const [tick, setTick] = useState(0);
  const [guideXs, setGuideXs] = useState<number[]>([]);
  const [guideInput, setGuideInput] = useState("");
  const [guideYs, setGuideYs] = useState<number[]>([]);
  const [guideYInput, setGuideYInput] = useState("");
  const [showCrossFromX, setShowCrossFromX] = useState(true);
  const [showCrossFromY, setShowCrossFromY] = useState(true);

  /* ==== Undo / Redo State Management ==== */
  const [history, setHistory] = useState<{ stack: AppState[], index: number }>({ stack: [], index: -1 });
  const currentState = history.stack[history.index];

  const updateState = (updater: (prev: AppState) => AppState, overwrite = false) => {
    setHistory(prev => {
      const baseStack = overwrite ? [] : prev.stack.slice(0, prev.index + 1);
      const nextState = updater(baseStack[baseStack.length - 1] || prev.stack[0]);
      return {
        stack: [...baseStack, nextState],
        index: baseStack.length,
      };
    });
  };
  const handleUndo = () => history.index > 0 && setHistory(prev => ({ ...prev, index: prev.index - 1 }));
  const handleRedo = () => history.index < history.stack.length - 1 && setHistory(prev => ({ ...prev, index: prev.index + 1 }));

  /* ==== Initial State & Presets ==== */
  useEffect(() => {
    const init: AppState = {
      xMin: 10, xMax: 1_000_000, yMin: 0.0001, yMax: 1_000_000,
      xLog: true, yLog: true,
      series: [{ name: "A", color: "#2563EB", points: [] }, { name: "B", color: "#10B981", points: [] }],
      bgXform: [{ sx: 1, sy: 1, offX: 0, offY: 0 }, { sx: 1, sy: 1, offX: 0, offY: 0 }],
      customAnchors: [null, null],
    };
    setHistory({ stack: [init], index: 0 });
  }, []);
  
  const applyPreset = (p: any) => {
    try {
      if (!p) return;
      const next: AppState = {
        xMin: p.axes?.xMin ?? 10, xMax: p.axes?.xMax ?? 1_000_000,
        yMin: p.axes?.yMin ?? 0.0001, yMax: p.axes?.yMax ?? 1_000_000,
        xLog: p.axes?.xLog ?? true, yLog: p.axes?.yLog ?? true,
        series: (p.series ?? currentState.series).map((s: any, i: number) => ({
          name: s.name ?? (i === 0 ? "A" : "B"),
          color: s.color ?? (i === 0 ? "#2563EB" : "#10B981"),
          points: (s.points ?? []).map((pt: any) => ({ x: Number(pt.x), y: Number(pt.y) })),
        })),
        bgXform: p.bg?.xform ?? currentState.bgXform,
        customAnchors: p.bg?.customAnchors ?? currentState.customAnchors,
      };
      setGuideXs(Array.isArray(p.guidesX) ? p.guidesX : []);
      setGuideYs(Array.isArray(p.guidesY) ? p.guidesY : []);
      setShowCrossFromX(p.cross?.fromX ?? true);
      setShowCrossFromY(p.cross?.fromY ?? true);
      setKeepAspect(!!p.bg?.keepAspect);
      setShowAB(p.bg?.showAB ?? [true, true]);
      setOpacityAB(p.bg?.opacityAB ?? [1, 0.6]);
      setActiveBg(p.bg?.activeBg ?? 0);
      updateState(() => next, true);
      notify("Preset loaded");
      setTick(t => t + 1);
    } catch { notify("Invalid preset", "err"); }
  };

  /* ==== Utils ==== */
  const notify = (msg: string, kind: "ok" | "err" = "ok") => {
    setToast({ msg, kind });
    window.clearTimeout((notify as any)._t);
    (notify as any)._t = window.setTimeout(() => setToast(null), 1500);
  };
  const innerRect = () => ({ x: pad.left, y: pad.top, w: size.w - pad.left - pad.right, h: size.h - pad.top - pad.bottom });
  const clampS = (v: number) => Math.max(0.05, Math.min(50, v));
  const EPS = 1e-12;
  const tVal = (v: number, log: boolean) => (log ? Math.log10(Math.max(EPS, v)) : v);

  const tMinMax = () => {
    if (!currentState) return { xmin: 0, xmax: 1, ymin: 0, ymax: 1 };
    return {
      xmin: tVal(currentState.xMin, currentState.xLog), xmax: tVal(currentState.xMax, currentState.xLog),
      ymin: tVal(currentState.yMin, currentState.yLog), ymax: tVal(currentState.yMax, currentState.yLog),
    }
  };

  const dataToPixel = (x: number, y: number) => {
    if (!currentState) return { px: 0, py: 0 };
    const r = innerRect(), mm = tMinMax();
    const tx = tVal(x, currentState.xLog), ty = tVal(y, currentState.yLog);
    return { px: r.x + ((tx - mm.xmin) / (mm.xmax - mm.xmin)) * r.w, py: r.y + r.h - ((ty - mm.ymin) / (mm.ymax - mm.ymin)) * r.h };
  };

  const pixelToData = (px: number, py: number) => {
    if (!currentState) return { x: 0, y: 0 };
    const r = innerRect(), mm = tMinMax();
    const tx = mm.xmin + ((px - r.x) / r.w) * (mm.xmax - mm.xmin);
    const ty = mm.ymin + ((r.y + r.h - py) / r.h) * (mm.ymax - mm.ymin);
    const inv = (tv: number, log: boolean) => (log ? Math.pow(10, tv) : tv);
    return { x: inv(tx, currentState.xLog), y: inv(ty, currentState.yLog) };
  };

  const fmtReal = (v: number | null) => {
    if (v == null || !isFinite(v)) return "-";
    const a = Math.abs(v);
    const s = a >= 1e6 || a < 1e-4 ? Number(v).toPrecision(6) : Number(v).toLocaleString(undefined, { maximumFractionDigits: 6 });
    return s.replace(/\.?0+$/, "");
  };

  /* ==== Image Base & Anchor Logic ==== */
  const baseRect = (idx: 0 | 1) => {
    const r = innerRect(), meta = bgList[idx];
    if (!meta || !keepAspect) return { x: r.x, y: r.y, w: r.w, h: r.h };
    const s = Math.min(r.w / meta.w, r.h / meta.h);
    const w = meta.w * s, h = meta.h * s, x = r.x + (r.w - w) / 2, y = r.y + (r.h - h) / 2;
    return { x, y, w, h };
  };
  
  const drawRectAndAnchor = (idx: 0 | 1) => {
    if (!currentState) return { dx:0, dy:0, dw:0, dh:0, ax:0, ay:0, fx:0, fy:0, baseW:0, baseH:0 };
    const base = baseRect(idx), xf = currentState.bgXform[idx], CA = currentState.customAnchors[idx];
    const dw = base.w * clampS(xf.sx), dh = base.h * clampS(xf.sy);
    let ax: number, ay: number, fx: number, fy: number;
    
    if (anchorMode === "custom") {
      const defaultAx = CA ? CA.ax : base.x;
      const defaultAy = CA ? CA.ay : base.y + base.h;
      ax = defaultAx + xf.offX;
      ay = defaultAy + xf.offY;
      fx = CA ? CA.fx : 0;
      fy = CA ? CA.fy : 1;
    } else {
      ax = base.x + base.w / 2 + xf.offX;
      ay = base.y + base.h / 2 + xf.offY;
      fx = 0.5; fy = 0.5;
    }
    const dx = ax - fx * dw, dy = ay - fy * dh;
    return { dx, dy, dw, dh, ax, ay, fx, fy, baseW: base.w, baseH: base.h };
  };

  /* ==== Event Handlers & Core Logic ==== */
  const onFile = (file: File, idx: 0 | 1) => {
    if (!file || !/^image\//.test(file.type)) { notify("이미지 파일만 선택하세요.", "err"); return; }
    const img = new Image(); img.crossOrigin = "anonymous";
    const finalize = (src: string) => {
      img.onload = () => { bgRefs.current[idx] = img; bgUrls.current[idx] = src; setBgList(cur => { const n = [...cur]; n[idx] = { w: img.width, h: img.height }; return n; }); };
      img.onerror = () => notify("이미지 로드 실패", "err");
      img.src = src;
    };
    const fr = new FileReader();
    fr.onload = () => finalize(String(fr.result || ""));
    fr.onerror = () => { try { finalize(URL.createObjectURL(file)); } catch { notify("이미지 로드 실패", "err"); } };
    fr.readAsDataURL(file);
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = (e.clipboardData?.items) || [];
      for (let i = 0; i < items.length; i++) if (items[i].type?.startsWith("image/")) { const f = items[i].getAsFile(); if (f) onFile(f, activeBg); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [activeBg]);
  
  // Keyboard Controls
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (["input", "textarea"].includes(document.activeElement.tagName.toLowerCase())) return;
      if (e.key === "Escape") { setPickAnchor(false); setSelectedPoint(null); }
      const arrows = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
      if (!arrows.includes(e.key)) return;
      e.preventDefault();

      if (selectedPoint) {
        const { seriesIndex, pointIndex } = selectedPoint;
        const pt = currentState.series[seriesIndex].points[pointIndex];
        const { px, py } = dataToPixel(pt.x, pt.y);
        const step = e.shiftKey ? 10 : 1;
        let nx = px, ny = py;
        if (e.key === "ArrowLeft") nx -= step; if (e.key === "ArrowRight") nx += step;
        if (e.key === "ArrowUp") ny -= step; if (e.key === "ArrowDown") ny += step;
        const nd = pixelToData(nx, ny);
        updateState(prev => ({ ...prev, series: prev.series.map((s, si) => si !== seriesIndex ? s : { ...s, points: s.points.map((p, pi) => (pi === pointIndex ? nd : p)) }) }));
        return;
      }
      if (bgEditMode) {
        const step = e.shiftKey ? 10 : 1;
        updateState(prev => {
          const n = [...prev.bgXform] as [BgXf, BgXf];
          const xf = n[activeBg];
          n[activeBg] = { ...xf, offX: xf.offX + (e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0), offY: xf.offY + (e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0) };
          return { ...prev, bgXform: n };
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedPoint, bgEditMode, activeBg, currentState]);

  useEffect(() => {
    if (!bgEditMode) {
      dragRef.current.active = false;
      resizeRef.current.active = false;
      setHoverHandle("none");
      setPickAnchor(false);
    }
  }, [bgEditMode]);
  
  const canvasPoint = (e: { clientX: number; clientY: number }) => {
    const c = canvasRef.current!, rc = c.getBoundingClientRect();
    const sx = c.width / rc.width, sy = c.height / rc.height;
    return { px: (e.clientX - rc.left) * sx, py: (e.clientY - rc.top) * sy };
  };
  const inPlot = (px: number, py: number) => {
    const r = innerRect(), T = 14; return px >= r.x - T && px <= r.x + r.w + T && py >= r.y - T && py <= r.y + r.h + T;
  };
  const overImage = (px: number, py: number, p = 14) => {
    const lr = lastRectRef.current; if (!lr) return false;
    return px >= lr.x - p && px <= lr.x + lr.w + p && py >= lr.y - p && py <= lr.y + lr.h + p;
  };
  const pickHandle = (px: number, py: number): Handle => {
    const lr = lastRectRef.current; if (!lr) return "none";
    const H = 12, hit = (hx: number, hy: number) => Math.abs(px - hx) <= H && Math.abs(py - hy) <= H;
    if (hit(lr.x + lr.w, lr.y + lr.h)) return "uniform";
    if (hit(lr.x + lr.w, lr.y + lr.h/2)) return "right";
    if (hit(lr.x, lr.y + lr.h/2)) return "left";
    if (hit(lr.x + lr.w/2, lr.y)) return "top";
    if (hit(lr.x + lr.w/2, lr.y+lr.h)) return "bottom";
    return "none";
  };
  function cursorForHandle(handle: Handle, bgEdit: boolean, picking: boolean) {
    if (picking) return "crosshair";
    if (!bgEdit) return "crosshair";
    switch (handle) {
      case "left": case "right": return "ew-resize";
      case "top": case "bottom": return "ns-resize";
      case "uniform": return "nwse-resize";
      default: return "move";
    }
  }

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { px, py } = canvasPoint(e);
    const rr = innerRect();
    if (px >= rr.x && px <= rr.x + rr.w && py >= rr.y && py <= rr.y + rr.h) {
      hoverRef.current = pixelToData(px, py);
    } else {
      hoverRef.current = { x: null, y: null };
    }

    if (resizeRef.current.active && bgEditMode) {
      const { fx, fy, ax, ay, baseW, baseH, mode } = resizeRef.current;
      const safe = (v: number) => (Math.abs(v) < 1e-6 ? 1e-6 : v);
      let dw: number | undefined, dh: number | undefined;

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
      
      const nsx = dw !== undefined ? clampS(dw / baseW) : currentState.bgXform[activeBg].sx;
      const nsy = dh !== undefined ? clampS(dh / baseH) : currentState.bgXform[activeBg].sy;
      
      updateState(prev => {
        const n = [...prev.bgXform] as [BgXf, BgXf];
        const xf = n[activeBg];
        n[activeBg] = { ...xf, sx: keepAspect ? nsx : nsx, sy: keepAspect ? nsx : nsy };
        return { ...prev, bgXform: n };
      });
      return;
    }

    if (dragRef.current.active && bgEditMode) {
      updateState(prev => {
        const n = [...prev.bgXform] as [BgXf, BgXf];
        const xf = n[activeBg];
        n[activeBg] = { ...xf, offX: dragRef.current.baseX + (px - dragRef.current.startX), offY: dragRef.current.baseY + (py - dragRef.current.startY) };
        return { ...prev, bgXform: n };
      });
      return;
    }
    setHoverHandle(bgEditMode ? pickHandle(px, py) : "none");
    setTick(t => t + 1);
  };

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { px, py } = canvasPoint(e);
    if (e.button === 2) { setPickAnchor(false); return; }

    if (pickAnchor && overImage(px, py)) {
      const lr = lastRectRef.current!; const fx = (px - lr.x) / lr.w, fy = (py - lr.y) / lr.h;
      updateState(prev => {
        const n = [...prev.customAnchors] as [CustomAnchor, CustomAnchor];
        n[activeBg] = { ax: px - prev.bgXform[activeBg].offX, ay: py - prev.bgXform[activeBg].offY, fx: Math.max(0, Math.min(1, fx)), fy: Math.max(0, Math.min(1, fy)) };
        return { ...prev, customAnchors: n };
      });
      setPickAnchor(false);
      return;
    }

    if (bgEditMode) {
      const h = pickHandle(px, py);
      if (h !== "none") {
        const d = drawRectAndAnchor(activeBg);
        resizeRef.current = { active: true, mode: h, ax: d.ax, ay: d.ay, fx: d.fx, fy: d.fy, baseW: d.baseW, baseH: d.baseH };
      } else {
        dragRef.current = { active: true, startX: px, startY: py, baseX: currentState.bgXform[activeBg].offX, baseY: currentState.bgXform[activeBg].offY };
      }
      setSelectedPoint(null);
      return;
    }

    if (inPlot(px, py)) {
      for (let si = 0; si < currentState.series.length; si++) {
        for (let pi = 0; pi < currentState.series[si].points.length; pi++) {
          const p = currentState.series[si].points[pi];
          const { px: ppx, py: ppy } = dataToPixel(p.x, p.y);
          if (Math.hypot(px - ppx, py - ppy) < ptRadius + 4) {
            setSelectedPoint({ seriesIndex: si, pointIndex: pi }); return;
          }
        }
      }
      const d = pixelToData(px, py);
      updateState(prev => ({ ...prev, series: prev.series.map((s, i) => i === activeSeries ? { ...s, points: [...s.points, d].sort((a, b) => a.x - b.x) } : s) }));
      setSelectedPoint(null);
    }
  };

  const onMouseUp = () => { dragRef.current.active = false; resizeRef.current.active = false; };
  const onMouseLeave = () => { hoverRef.current = { x: null, y: null }; setHoverHandle("none"); dragRef.current.active = false; resizeRef.current.active = false; setTick(t => t + 1); };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if(!bgEditMode) return;
    e.preventDefault();
    const k = e.deltaY < 0 ? 1.05 : 0.95;
    updateState(prev=>{
      const n=[...prev.bgXform] as [BgXf,BgXf];
      const xf=n[activeBg];
      const nsx=clampS(xf.sx*k);
      const nsy=clampS(xf.sy*(keepAspect?k:k));
      n[activeBg]={...xf, sx: nsx, sy: keepAspect?nsx:nsy};
      return {...prev, bgXform:n};
    });
  };

  /* ... Other functions like serialize, export, presets ... */

  if (!currentState) return <div className="flex h-screen items-center justify-center text-xl">Loading Application...</div>;
  const { xMin, xMax, yMin, yMax, xLog, yLog, series } = currentState;

  // Data for coordinate panels
  const pointRows = series.flatMap((s) => s.points.map((p) => ({ series: s.name, x: p.x, y: p.y }))).sort((a, b) => a.x - b.x);
  const guideRows = [
    ...guideXs.flatMap(gx => series.map(s => ({ kind: "X" as const, guide: gx, series: s.name, value: yAtX(s.points, gx) }))),
    ...guideYs.flatMap(gy => series.map(s => ({ kind: "Y" as const, guide: gy, series: s.name, value: xAtY(s.points, gy) })))
  ];

  return (
    <div className="min-h-screen bg-gray-100 text-gray-800 font-sans antialiased">
      {/* Header */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-gray-200 bg-white/80 p-4 backdrop-blur-sm">
        <h1 className="text-xl font-bold text-gray-900">Log-scale Graph Digitizer</h1>
        <div className="flex flex-wrap items-center gap-3 text-base">
          <button onClick={() => updateState(p => ({ ...p, series: p.series.map((s, i) => i === activeSeries ? { ...s, points: s.points.slice(0, -1) } : s) }))} className="rounded-lg bg-gray-200 px-4 py-2 font-semibold hover:bg-gray-300">Undo Last Point</button>
          <button onClick={() => updateState(p => ({ ...p, series: p.series.map((s, i) => i === activeSeries ? { ...s, points: [] } : s) }))} className="rounded-lg bg-gray-200 px-4 py-2 font-semibold text-red-700 hover:bg-red-100">Clear Active Series</button>
          <div className="h-6 w-px bg-gray-300" />
          <button onClick={handleUndo} disabled={history.index <= 0} className="rounded-lg bg-gray-200 px-4 py-2 font-semibold hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed">Undo</button>
          <button onClick={handleRedo} disabled={history.index >= history.stack.length - 1} className="rounded-lg bg-gray-200 px-4 py-2 font-semibold hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed">Redo</button>
          {/* ... Other buttons */}
        </div>
      </header>

      {/* Main Layout */}
      <main className="grid grid-cols-1 gap-8 p-8 lg:grid-cols-[480px,1fr]">
        <aside className="flex flex-col gap-6">
          <AccordionSection title="Axes" isOpen={axesOpen} onToggle={() => setAxesOpen(v => !v)}>
            <div className="grid grid-cols-2 gap-4">
              <label className="col-span-2 flex items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={xLog} onChange={e => updateState(p => ({ ...p, xLog: e.target.checked }))} /> X Log Scale</label>
              <label className="flex items-center gap-3">X Min <input type="number" className="w-full rounded-md border px-3 py-2" value={xMin} onChange={e => updateState(p => ({ ...p, xMin: Number(e.target.value) }))} /></label>
              <label className="flex items-center gap-3">X Max <input type="number" className="w-full rounded-md border px-3 py-2" value={xMax} onChange={e => updateState(p => ({ ...p, xMax: Number(e.target.value) }))} /></label>
              <label className="col-span-2 flex items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={yLog} onChange={e => updateState(p => ({ ...p, yLog: e.target.checked }))} /> Y Log Scale</label>
              <label className="flex items-center gap-3">Y Min <input type="number" className="w-full rounded-md border px-3 py-2" value={yMin} onChange={e => updateState(p => ({ ...p, yMin: Number(e.target.value) }))} /></label>
              <label className="flex items-center gap-3">Y Max <input type="number" className="w-full rounded-md border px-3 py-2" value={yMax} onChange={e => updateState(p => ({ ...p, yMax: Number(e.target.value) }))} /></label>
            </div>
          </AccordionSection>
          {/* ... other sections ... */}
        </aside>

        <div className="flex flex-col gap-6">
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            {/* ... canvas ... */}
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-lg border border-gray-200">
              {/* ... points table ... */}
            </div>
            <div className="rounded-lg border border-gray-200">
              {/* ... guides table ... */}
            </div>
          </div>
        </div>
      </main>
      {toast && <div className="fixed ...">{toast.msg}</div>}
    </div>
  );
}
