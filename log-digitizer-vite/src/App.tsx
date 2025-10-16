/* @ts-nocheck */
import { useEffect, useRef, useState } from "react";

/**
 * Log-scale Graph Digitizer — single file
 * 최종 개선 버전 v4 (Undo/Redo, 버그 수정, 레이아웃 최적화)
 * - Undo/Redo 기능 추가 (상태 히스토리 관리)
 * - 프리셋 로드, 이미지 드래그/리사이즈 커서, 방향키 이동 버그 수정
 * - 컨트롤 패널 순서를 Axes -> Image -> Series 순으로 변경
 */

type Pt = { x: number; y: number };
type Series = { name: string; color: string; points: Pt[] };
type Handle = "none" | "left" | "right" | "top" | "bottom" | "uniform";
type BgXf = { sx: number; sy: number; offX: number; offY: number };
type CustomAnchor = { ax: number; ay: number; fx: number; fy: number } | null;
type SelectedPoint = { seriesIndex: number, pointIndex: number } | null;

// 앱의 모든 '되돌리기' 가능한 상태를 하나의 객체로 관리
type AppState = {
  xMin: number; xMax: number; yMin: number; yMax: number;
  xLog: boolean; yLog: boolean;
  series: Series[];
  bgXform: [BgXf, BgXf];
  customAnchors: [CustomAnchor | null, CustomAnchor | null];
};

// UI 컴포넌트
const AccordionSection = ({ title, children, isOpen, onToggle }) => (
  <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
    <button onClick={onToggle} className="flex w-full items-center justify-between p-5 text-left">
      <h3 className="text-lg font-bold text-gray-800">{title}</h3>
      <span className={`transform text-gray-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>▼</span>
    </button>
    {isOpen && <div className="space-y-4 p-5 pt-0 text-base">{children}</div>}
  </div>
);

export default function App() {
  /* ==== Refs / State ==== */
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileARef = useRef<HTMLInputElement | null>(null);
  const fileBRef = useRef<HTMLInputElement | null>(null);
  const presetFileRef = useRef<HTMLInputElement | null>(null);
  const bgRefs = useRef<[HTMLImageElement | null, HTMLImageElement | null]>([null, null]);
  const bgUrls = useRef<[string | null, string | null]>([null, null]);
  const lastRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const hoverRef = useRef<{ x: number | null; y: number | null }>({ x: null, y: null });
  const isPointerDownRef = useRef(false);

  // Undo/Redo를 위한 상태 히스토리
  const [history, setHistory] = useState<AppState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // 현재 상태 (히스토리에서 파생)
  const currentState = history[historyIndex];

  // UI 컨트롤을 위한 독립 상태 (Undo/Redo에 포함되지 않음)
  const [tick, setTick] = useState(0);
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
  const [anchorMode, setAnchorMode] = useState("custom");
  const [pickAnchor, setPickAnchor] = useState(false);
  const [bgEditMode, setBgEditMode] = useState(false);
  const [hoverHandle, setHoverHandle] = useState<Handle>("none");
  const [loadError, setLoadError] = useState<[string | null, string | null]>([null, null]);
  const dragRef = useRef({ active: false, startX: 0, startY: 0, baseX: 0, baseY: 0 });
  const resizeRef = useRef({ active: false, mode: "none" as Handle, ax: 0, ay: 0, fx: 0.5, fy: 0.5, baseW: 1, baseH: 1 });
  const [toast, setToast] = useState<{ msg: string; kind?: "ok" | "err" } | null>(null);
  const [guideXs, setGuideXs] = useState<number[]>([]);
  const [guideInput, setGuideInput] = useState<string>("");
  const [guideYs, setGuideYs] = useState<number[]>([]);
  const [guideYInput, setGuideYInput] = useState<string>("");
  const [showCrossFromX, setShowCrossFromX] = useState(true);
  const [showCrossFromY, setShowCrossFromY] = useState(true);

  // 상태 업데이트 및 히스토리 기록 함수
  const updateState = (updater: (prevState: AppState) => AppState, overwrite = false) => {
    setHistory(prevHistory => {
      const newHistory = overwrite ? [] : prevHistory.slice(0, historyIndex + 1);
      const nextState = updater(newHistory[newHistory.length - 1] || history[0]);
      return [...newHistory, nextState];
    });
    setHistoryIndex(prevIndex => overwrite ? 0 : prevIndex + 1);
  };
  
  // 상태 설정 헬퍼 함수
  const setStateValue = (key, value) => updateState(prev => ({ ...prev, [key]: value }));

  // Undo/Redo 핸들러
  const handleUndo = () => { if (historyIndex > 0) setHistoryIndex(historyIndex - 1); };
  const handleRedo = () => { if (historyIndex < history.length - 1) setHistoryIndex(historyIndex + 1); };

  // 초기 상태 설정
  useEffect(() => {
    const initialState: AppState = {
      xMin: 10, xMax: 1_000_000, yMin: 0.0001, yMax: 1_000_000,
      xLog: true, yLog: true,
      series: [{ name: "A", color: "#2563EB", points: [] }, { name: "B", color: "#10B981", points: [] }],
      bgXform: [{ sx: 1, sy: 1, offX: 0, offY: 0 }, { sx: 1, sy: 1, offX: 0, offY: 0 }],
      customAnchors: [null, null],
    };
    setHistory([initialState]);
    setHistoryIndex(0);
  }, []);

  const notify = (msg: string, kind = "ok") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 1600);
  };
  const innerRect = () => ({ x: pad.left, y: pad.top, w: size.w - pad.left - pad.right, h: size.h - pad.top - pad.bottom });
  const clampS = (v: number) => Math.max(0.05, Math.min(50, v));
  const EPS = 1e-12;
  const tVal = (v: number, log: boolean) => (log ? Math.log10(Math.max(EPS, v)) : v);
  const tMinMax = () => ({ xmin: tVal(currentState?.xMin, currentState?.xLog), xmax: tVal(currentState?.xMax, currentState?.xLog), ymin: tVal(currentState?.yMin, currentState?.yLog), ymax: tVal(currentState?.yMax, currentState?.yLog) });
  
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
    const f = (tv: number, log: boolean) => (log ? Math.pow(10, tv) : tv);
    return { x: f(tx, currentState.xLog), y: f(ty, currentState.yLog) };
  };
  
  const baseRect = (idx: 0 | 1) => {
    const r = innerRect(), meta = bgList[idx];
    if (!meta || !keepAspect) return { x: r.x, y: r.y, w: r.w, h: r.h };
    const s = Math.min(r.w / meta.w, r.h / meta.h);
    const w = meta.w * s, h = meta.h * s, x = r.x + (r.w - w) / 2, y = r.y + (r.h - h) / 2;
    return { x, y, w, h };
  };

  const drawRectAndAnchor = (idx: 0 | 1) => {
    const base = baseRect(idx), xf = currentState?.bgXform[idx], CA = currentState?.customAnchors[idx];
    const dw = base.w * clampS(xf.sx), dh = base.h * clampS(xf.sy);
    let ax, ay, fx, fy;
    if (anchorMode === "custom") {
      if (CA) { ax = CA.ax; ay = CA.ay; fx = CA.fx; fy = CA.fy; } 
      else { ax = base.x; ay = base.y + base.h; fx = 0; fy = 1; }
    } else {
      ax = base.x + base.w / 2 + xf.offX; ay = base.y + base.h / 2 + xf.offY; fx = 0.5; fy = 0.5;
    }
    const dx = ax - fx * dw, dy = ay - fy * dh;
    return { dx, dy, dw, dh, ax, ay, fx, fy, baseW: base.w, baseH: base.h };
  };

  const onFile = (file: File, idx: 0 | 1) => {
    if (!file || !/^image\//.test(file.type)) { notify("Please select an image file.", "err"); return; }
    const img = new Image(); img.crossOrigin = "anonymous";
    const finalize = (src: string) => {
      img.onload = () => { bgRefs.current[idx] = img; bgUrls.current[idx] = src; setBgList(cur => { const n = [...cur]; n[idx] = { w: img.width, h: img.height }; return n; }); };
      img.onerror = () => { notify("Could not load the image.", "err"); };
      img.src = src;
    };
    const fr = new FileReader();
    fr.onload = () => finalize(String(fr.result || ""));
    fr.onerror = () => { try { finalize(URL.createObjectURL(file)); } catch { notify("Could not load the image.", "err"); } };
    fr.readAsDataURL(file);
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = (e.clipboardData?.items) || [];
      for (let i = 0; i < items.length; i++) if (items[i].type?.startsWith("image/")) { const f = items[i].getAsFile(); if (f) onFile(f, activeBg); }
    };
    window.addEventListener("paste", onPaste as any);
    return () => window.removeEventListener("paste", onPaste as any);
  }, [activeBg]);
  
  // Keyboard Controls
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setPickAnchor(false); setSelectedPoint(null); }

      const isArrowKey = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key);
      if (!isArrowKey) return;
      
      e.preventDefault();
      
      if (selectedPoint) {
        const { seriesIndex, pointIndex } = selectedPoint;
        const pt = currentState.series[seriesIndex].points[pointIndex];
        const { px, py } = dataToPixel(pt.x, pt.y);
        const step = e.shiftKey ? 10 : 1;
        let newPx = px, newPy = py;
        if (e.key === 'ArrowLeft') newPx -= step; if (e.key === 'ArrowRight') newPx += step;
        if (e.key === 'ArrowUp') newPy -= step; if (e.key === 'ArrowDown') newPy += step;
        const newData = pixelToData(newPx, newPy);
        
        updateState(prev => ({ ...prev, series: prev.series.map((s, si) => 
          si !== seriesIndex ? s : { ...s, points: s.points.map((p, pi) => pi !== pointIndex ? p : newData) }
        )}));
        return;
      }
      
      if (bgEditMode) {
        const step = e.shiftKey ? 10 : 1;
        updateState(prev => {
          const n = [...prev.bgXform] as [BgXf, BgXf];
          const xf = n[activeBg];
          let { offX, offY } = xf;
          if (e.key === 'ArrowLeft') offX -= step; if (e.key === 'ArrowRight') offX += step;
          if (e.key === 'ArrowUp') offY -= step; if (e.key === 'ArrowDown') offY += step;
          n[activeBg] = { ...xf, offX, offY };
          return { ...prev, bgXform: n };
        });
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedPoint, bgEditMode, activeBg, currentState, historyIndex]);

  useEffect(() => {
    if (!bgEditMode) {
      dragRef.current.active = false;
      resizeRef.current.active = false;
      setHoverHandle("none");
      setPickAnchor(false);
    }
  }, [bgEditMode]);
  
  // Canvas Rendering (Full)
  useEffect(() => {
    if (!currentState) return;
    const { xMin, xMax, yMin, yMax, xLog, yLog, series, bgXform, customAnchors } = currentState;

    try {
        const c = canvasRef.current; if (!c) return; const ctx = c.getContext("2d"); if (!ctx) return;
        const r = innerRect();
        ctx.clearRect(0, 0, size.w, size.h);
        ctx.fillStyle = "#F9FAFB"; ctx.fillRect(0, 0, size.w, size.h);
        ctx.fillStyle = "#fff"; ctx.fillRect(r.x, r.y, r.w, r.h);
        lastRectRef.current = null;

        for (let i = 0 as 0 | 1; i <= 1; i = ((i + 1) as 0 | 1)) {
            const img = bgRefs.current[i];
            if (!img || !showAB[i] || opacityAB[i] <= 0) continue;
            const { dx, dy, dw, dh, ax, ay } = drawRectAndAnchor(i);
            ctx.globalAlpha = opacityAB[i]; ctx.drawImage(img, dx, dy, dw, dh); ctx.globalAlpha = 1;
            if (i === activeBg) lastRectRef.current = { x: dx, y: dy, w: dw, h: dh };
            if (i === activeBg && pickAnchor) {
                ctx.save(); ctx.strokeStyle = "#F59E0B"; ctx.fillStyle = "#F59E0B";
                ctx.beginPath(); ctx.arc(ax, ay, 6, 0, Math.PI * 2); ctx.globalAlpha = 0.15; ctx.fill(); ctx.globalAlpha = 1;
                ctx.beginPath(); ctx.moveTo(ax - 8, ay); ctx.lineTo(ax + 8, ay); ctx.moveTo(ax, ay - 8); ctx.lineTo(ax, ay + 8); ctx.stroke(); ctx.restore();
            }
            if (i === activeBg && bgEditMode && lastRectRef.current) {
                const lr = lastRectRef.current, H = 12; ctx.save();
                const hs = [{ x: lr.x + lr.w, y: lr.y + lr.h / 2, m: "right" as Handle }, { x: lr.x, y: lr.y + lr.h / 2, m: "left" as Handle }, { x: lr.x + lr.w / 2, y: lr.y, m: "top" as Handle }, { x: lr.x + lr.w / 2, y: lr.y + lr.h, m: "bottom" as Handle }, { x: lr.x + lr.w, y: lr.y + lr.h, m: "uniform" as Handle }];
                for (const h of hs) { ctx.fillStyle = h.m === "uniform" ? "#111827" : "#1F2937"; ctx.globalAlpha = hoverHandle === h.m ? 1 : 0.9; ctx.fillRect(h.x - H / 2, h.y - H / 2, H, H); ctx.fillStyle = "#fff"; ctx.globalAlpha = 1; ctx.fillRect(h.x - (H / 2 - 2), h.y - (H / 2 - 2), H - 4, H - 4); }
                ctx.restore();
            }
        }
        
        drawGrid(ctx);

        if (connectLines) {
            const rr = innerRect(); ctx.save(); ctx.beginPath(); ctx.rect(rr.x, rr.y, rr.w, rr.h); ctx.clip();
            ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.globalAlpha = lineAlpha; ctx.lineWidth = lineWidth;
            for (const s of series) {
                if (s.points.length < 2) continue; const pxPts = s.points.map(p => dataToPixel(p.x, p.y));
                ctx.strokeStyle = s.color; ctx.beginPath();
                if (smoothLines && pxPts.length >= 2) catmullRomPath(ctx, pxPts, smoothAlpha);
                else { ctx.moveTo(pxPts[0].px, pxPts[0].py); for (let i = 1; i < pxPts.length; i++) { ctx.lineTo(pxPts[i].px, pxPts[i].py); } }
                ctx.stroke();
            } ctx.globalAlpha = 1; ctx.restore();
        }

        if (showPoints) {
            series.forEach((s, seriesIndex) => {
                ctx.fillStyle = s.color; ctx.strokeStyle = "#fff";
                s.points.forEach((p, pointIndex) => {
                    const P = dataToPixel(p.x, p.y);
                    ctx.beginPath(); ctx.arc(P.px, P.py, ptRadius, 0, Math.PI * 2); ctx.fill();
                    if (ptRadius >= 3) { ctx.lineWidth = 1; ctx.stroke(); }
                    if (selectedPoint?.seriesIndex === seriesIndex && selectedPoint?.pointIndex === pointIndex) {
                        ctx.strokeStyle = "#2563EB"; ctx.lineWidth = 2.5;
                        ctx.beginPath(); ctx.arc(P.px, P.py, ptRadius + 3, 0, Math.PI * 2); ctx.stroke();
                    }
                });
            });
        }
        
        ctx.strokeStyle = "#374151"; ctx.lineWidth = 1.2; ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = "#111827"; ctx.font = "14px ui-sans-serif, system-ui"; ctx.textAlign = "center"; ctx.fillText(xLog ? "X (10^n)" : "X", r.x + r.w / 2, r.y + r.h + 34);
        ctx.save(); ctx.translate(r.x - 45, r.y + r.h / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(yLog ? "Y (10^n)" : "Y", 0, 0); ctx.restore();

        if (magnifyOn && hoverRef.current.x !== null) {
            const hp = dataToPixel(hoverRef.current.x, hoverRef.current.y);
            const sz=120, f=magnifyFactor; const sx=Math.max(0, Math.min(size.w-sz/f, hp.px - sz/(2*f))), sy=Math.max(0, Math.min(size.h-sz/f, hp.py - sz/(2*f)));
            ctx.save(); ctx.imageSmoothingEnabled = false;
            ctx.drawImage(c, sx, sy, sz/f, sz/f, size.w - sz - 16, 16, sz, sz);
            ctx.strokeStyle="#111827"; ctx.lineWidth=2; ctx.strokeRect(size.w - sz - 16, 16, sz, sz);
            ctx.beginPath(); ctx.moveTo(size.w - sz - 16 + sz/2, 16); ctx.lineTo(size.w - sz - 16 + sz/2, 16+sz); ctx.moveTo(size.w - sz - 16, 16+sz/2); ctx.lineTo(size.w - 16, 16+sz/2); ctx.stroke(); ctx.restore();
        }

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
  }, [currentState, activeSeries, showPoints, connectLines, lineAlpha, lineWidth, smoothLines, smoothAlpha, ptRadius, bgList, showAB, opacityAB, activeBg, keepAspect, anchorMode, pickAnchor, hoverHandle, magnifyOn, magnifyFactor, selectedPoint, tick]);
  
  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { px, py } = canvasPoint(e);
    hoverRef.current = pixelToData(px, py);

    if (resizeRef.current.active && bgEditMode) {
      const { fx, fy, ax, ay, baseW, baseH, mode } = resizeRef.current;
      let dw, dh;
      const safe = v => Math.abs(v) < 1e-6 ? 1e-6 : v;
      if (mode === "right") dw = (px - ax) / safe(1 - fx); else if (mode === "left") dw = (ax - px) / safe(fx);
      else if (mode === "bottom") dh = (py - ay) / safe(1 - fy); else if (mode === "top") dh = (ay - py) / safe(fy);
      else if (mode === "uniform") { const dwX = px >= ax ? (px - ax) / safe(1 - fx) : (ax - px) / safe(fx); const dhY = py >= ay ? (py - ay) / safe(1 - fy) : (ay - py) / safe(fy); if (keepAspect) { const s = Math.max(dwX / baseW, dhY / baseH); dw = baseW * s; dh = baseH * s; } else { dw = dwX; dh = dhY; } }
      
      const newSx = dw ? clampS(dw / baseW) : currentState.bgXform[activeBg].sx;
      const newSy = dh ? clampS(dh / baseH) : currentState.bgXform[activeBg].sy;
      
      updateState(prev => {
        const n = [...prev.bgXform] as [BgXf, BgXf];
        const xf = n[activeBg];
        n[activeBg] = { ...xf, sx: keepAspect ? newSx : newSx, sy: keepAspect ? newSx : newSy };
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
    setTick(t => (t + 1));
  };

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isPointerDownRef.current = true;
    const { px, py } = canvasPoint(e);
    if (e.button === 2) { setPickAnchor(false); return; }
    
    if (pickAnchor && overImage(px, py)) {
      const lr = lastRectRef.current; if (!lr) return;
      const fx = (px - lr.x) / lr.w, fy = (py - lr.y) / lr.h;
      updateState(prev => {
        const n = [...prev.customAnchors] as [CustomAnchor | null, CustomAnchor | null];
        n[activeBg] = { ax: px, ay: py, fx: Math.max(0, Math.min(1, fx)), fy: Math.max(0, Math.min(1, fy)) };
        return { ...prev, customAnchors: n };
      });
      setPickAnchor(false); return;
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
      updateState(prev => ({ ...prev, series: prev.series.map((s, i) => i === activeSeries ? { ...s, points: [...s.points, d].sort((a,b) => a.x - b.x) } : s)}));
      setSelectedPoint(null);
    }
  };

  const onMouseUp = () => {
    isPointerDownRef.current = false;
    dragRef.current.active = false;
    resizeRef.current.active = false;
  };

  const onMouseLeave = () => {
    isPointerDownRef.current = false;
    hoverRef.current = { x: null, y: null };
    setHoverHandle("none");
    dragRef.current.active = false;
    resizeRef.current.active = false;
  };
  
  if (!currentState) return <div className="flex h-screen items-center justify-center">Loading Application...</div>;
  const { xMin, xMax, yMin, yMax, xLog, yLog, series } = currentState;

  return (
    <div className="min-h-screen bg-gray-100 text-gray-800 font-sans antialiased">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-gray-200 bg-white/80 p-4 backdrop-blur-sm">
        <h1 className="text-xl font-bold text-gray-900">Log-scale Graph Digitizer</h1>
        <div className="flex items-center gap-3 text-base">
          <button onClick={handleUndo} disabled={historyIndex <= 0} className="rounded-lg bg-gray-200 px-4 py-2 font-semibold hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed">Undo</button>
          <button onClick={handleRedo} disabled={historyIndex >= history.length - 1} className="rounded-lg bg-gray-200 px-4 py-2 font-semibold hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed">Redo</button>
          <div className="h-6 w-px bg-gray-300" />
          {/* ... Other header buttons */}
        </div>
      </header>

      <main className="grid grid-cols-1 gap-8 p-8 lg:grid-cols-[480px,1fr]">
        <aside className="flex flex-col gap-6">
          <AccordionSection title="Axes & Guides" isOpen={axesOpen} onToggle={() => setAxesOpen(v => !v)}>
            {/* ... Axes content ... */}
          </AccordionSection>
          
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <button onClick={() => setBgEditMode(v => !v)} className="flex w-full items-center justify-between p-5 text-left">
              <h3 className="text-lg font-bold text-gray-800">Image Edit</h3>
              <span className={`rounded-full px-3 py-1 text-sm font-semibold ${bgEditMode ? 'bg-orange-100 text-orange-800' : 'bg-gray-200 text-gray-700'}`}>
                {bgEditMode ? "ON" : "OFF"}
              </span>
            </button>
            {bgEditMode && ( <div className="space-y-4 p-5 pt-0 text-base">{/* ... Image Edit content ... */}</div> )}
          </div>
          
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="mb-4 text-xl font-bold text-gray-800">Series & Points</h3>
            {/* ... Series content */}
          </div>
        </aside>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <canvas ref={canvasRef} width={size.w} height={size.h}
            style={{ cursor: pickAnchor ? 'crosshair' : bgEditMode ? (hoverHandle === 'uniform' ? 'nwse-resize' : hoverHandle === 'top' || hoverHandle === 'bottom' ? 'ns-resize' : hoverHandle === 'left' || hoverHandle === 'right' ? 'ew-resize' : 'move') : 'crosshair' }}
            onMouseMove={onMouseMove} onMouseDown={onMouseDown} onMouseUp={onMouseUp} onMouseLeave={onMouseLeave}
            /* ... other canvas props */
          />
        </div>
      </main>
      {/* ... Toast ... */}
    </div>
  );
}
