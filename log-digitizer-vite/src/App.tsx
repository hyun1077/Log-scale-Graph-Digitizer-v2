/* @ts-nocheck */
import { useEffect, useRef, useState } from "react";
import { toI2tCurve, type Sample } from "./lib/i2t";

/**
 * Log-scale Graph Digitizer — single file
 * v4.3
 * - 이미지 커스텀 앵커 모드에서도 드래그/오프셋 정상 반영
 * - Guides: 입력 원문(라벨) 보존/표시
 * - Points: 시리즈별 정렬(A→B), 각 시리즈 내부 x 오름차순
 * - Guides 표 폭/줄바꿈 개선(table-fixed, w-*, whitespace-nowrap, overflow-x-auto)
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
  <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
    <button onClick={onToggle} className="flex w-full items-center justify-between p-2 text-left">
      <h3 className="text-xs font-bold text-gray-800">{title}</h3>
      <span className={`transform text-gray-500 transition-transform duration-200 text-xs ${isOpen ? "rotate-180" : ""}`}>▼</span>
    </button>
    {isOpen && <div className="space-y-2 p-2 pt-0 text-xs">{children}</div>}
  </div>
);

export default function App() {
  /* ==== Refs / UI ==== */
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  
  // I²t 그래프 관련
  const i2tCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [showI2tGraph, setShowI2tGraph] = useState(true);
  // 제품 기준 수명모델 파라미터
  const [lifetimeMode, setLifetimeMode] = useState<"I_mode"|"I2t_mode">("I_mode");
  const [lifetimeCycles, setLifetimeCycles] = useState<number[]>([1,10,100,1000,10000,100000,1000000]);
  const [currentMultipliers, setCurrentMultipliers] = useState<number[]>([1.00, 2.80, 2.55, 2.06, 1.70, 1.00, 0.70]);
  const [lifetimeRatios, setLifetimeRatios] = useState<number[]>([1.000, 0.907, 0.826, 0.713, 0.551, 0.356, 0.227]);
  const [selectedLifetimeCycles, setSelectedLifetimeCycles] = useState<Set<number>>(new Set([1,10,100,1000,10000,100000,1000000]));
  const [showRealCoords, setShowRealCoords] = useState(false);
  const LIFE_CURRENT_BASE = 3050; // 기준 1배 전류 = 3.05kA = 3050A
  const [lifeCheckI, setLifeCheckI] = useState<number>(0);
  const [lifeCheckT, setLifeCheckT] = useState<number>(0);
  const [lifeIInput, setLifeIInput] = useState<string>("");
  const [lifeTInput, setLifeTInput] = useState<string>("");
  const [enterCurrents, setEnterCurrents] = useState<boolean>(false);
  const [multiplierInputs, setMultiplierInputs] = useState<Record<number,string>>({});
  const [currentInputs, setCurrentInputs] = useState<Record<number,string>>({});
  const [i2tFixedRange, setI2tFixedRange] = useState<boolean>(true);
  
  // I²t 그래프 체크 시 사이드바 접기
  useEffect(() => {
    if (showI2tGraph) {
      setSidebarCollapsed(true);
    }
  }, [showI2tGraph]);
  
  // lifetimeCycles 변경 시 selectedLifetimeCycles 업데이트
  useEffect(() => {
    const currentSelected = Array.from(selectedLifetimeCycles);
    const validSelected = currentSelected.filter(c => lifetimeCycles.includes(c));
    if (validSelected.length === 0 || validSelected.length !== currentSelected.length) {
      setSelectedLifetimeCycles(new Set(lifetimeCycles));
    }
  }, [lifetimeCycles]);

  const [activeSeries, setActiveSeries] = useState(0);
  const [selectedPoint, setSelectedPoint] = useState<SelectedPoint>(null);

  const [connectLines, setConnectLines] = useState(true);
  const [lineWidth, setLineWidth] = useState(1.6);
  const [lineAlpha, setLineAlpha] = useState(0.9);
  const [smoothLines, setSmoothLines] = useState(true);
  const [smoothAlpha, setSmoothAlpha] = useState(0.35);
  const [ptRadius, setPtRadius] = useState(5);
  const [showPoints, setShowPoints] = useState(true);

  // Magnifier → Series 헤더 옆
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

  /* ==== Guides (UI는 Series 끝으로) ==== */
  const [guideXs, setGuideXs] = useState<number[]>([]);
  const [guideInput, setGuideInput] = useState("");
  const [guideYs, setGuideYs] = useState<number[]>([]);
  const [guideYInput, setGuideYInput] = useState("");
  const [showCrossFromX, setShowCrossFromX] = useState(true);
  const [showCrossFromY, setShowCrossFromY] = useState(true);

  // 라벨(입력 원문) 보존용 맵
  const [guideXLabels, setGuideXLabels] = useState<Record<number, string>>({});
  const [guideYLabels, setGuideYLabels] = useState<Record<number, string>>({});

  /* ==== Undo / Redo ==== */
  const [history, setHistory] = useState<AppState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const currentState = history[historyIndex];

  const updateState = (updater: (prev: AppState) => AppState, overwrite = false) => {
    setHistory(prev => {
      const base = overwrite ? [] : prev.slice(0, historyIndex + 1);
      const next = updater(base[base.length - 1] || prev[0]);
      return [...base, next];
    });
    setHistoryIndex(i => (overwrite ? 0 : i + 1));
  };
  const handleUndo = () => historyIndex > 0 && setHistoryIndex(historyIndex - 1);
  const handleRedo = () => historyIndex < history.length - 1 && setHistoryIndex(historyIndex + 1);

  /* ==== 초기 상태 ==== */
  useEffect(() => {
    const init: AppState = {
      xMin: 10, xMax: 1_000_000, yMin: 0.0001, yMax: 1_000_000,
      xLog: true, yLog: true,
      series: [
        { name: "A", color: "#2563EB", points: [] },
        { name: "B", color: "#10B981", points: [] },
      ],
      bgXform: [
        { sx: 1, sy: 1, offX: 0, offY: 0 },
        { sx: 1, sy: 1, offX: 0, offY: 0 },
      ],
      customAnchors: [null, null],
    };
    setHistory([init]); setHistoryIndex(0);
  }, []);

  /* ==== 유틸 ==== */
  const notify = (msg: string, kind: "ok" | "err" = "ok") => {
    setToast({ msg, kind });
    window.clearTimeout((notify as any)._t);
    (notify as any)._t = window.setTimeout(() => setToast(null), 1500);
  };

  const innerRect = () => ({ x: pad.left, y: pad.top, w: size.w - pad.left - pad.right, h: size.h - pad.top - pad.bottom });
  const clampS = (v: number) => Math.max(0.05, Math.min(50, v));
  const EPS = 1e-12;
  const tVal = (v: number, log: boolean) => (log ? Math.log10(Math.max(EPS, v)) : v);
  const tMinMax = () => ({
    xmin: tVal(currentState.xMin, currentState.xLog),
    xmax: tVal(currentState.xMax, currentState.xLog),
    ymin: tVal(currentState.yMin, currentState.yLog),
    ymax: tVal(currentState.yMax, currentState.yLog),
  });

  const dataToPixel = (x: number, y: number) => {
    const r = innerRect(), mm = tMinMax();
    const tx = tVal(x, currentState.xLog), ty = tVal(y, currentState.yLog);
    return {
      px: r.x + ((tx - mm.xmin) / (mm.xmax - mm.xmin)) * r.w,
      py: r.y + r.h - ((ty - mm.ymin) / (mm.ymax - mm.ymin)) * r.h,
    };
  };
  const pixelToData = (px: number, py: number) => {
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

  /* ==== 이미지 베이스/앵커 ==== */
  const baseRect = (idx: 0 | 1) => {
    const r = innerRect(), meta = bgList[idx];
    if (!meta || !keepAspect) return { x: r.x, y: r.y, w: r.w, h: r.h };
    const s = Math.min(r.w / meta.w, r.h / meta.h);
    const w = meta.w * s, h = meta.h * s, x = r.x + (r.w - w) / 2, y = r.y + (r.h - h) / 2;
    return { x, y, w, h };
  };

  // custom 모드에서도 offX/offY 적용 → 드래그 이동 정상
  const drawRectAndAnchor = (idx: 0 | 1) => {
    const base = baseRect(idx), xf = currentState.bgXform[idx], CA = currentState.customAnchors[idx];
    const dw = base.w * clampS(xf.sx), dh = base.h * clampS(xf.sy);
    let ax: number, ay: number, fx: number, fy: number;
    if (anchorMode === "custom") {
      const dax = CA ? CA.ax : base.x;
      const day = CA ? CA.ay : base.y + base.h;
      ax = dax + xf.offX;  // offX/ offY 반영
      ay = day + xf.offY;
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

  /* ==== 이미지 로드 ==== */
  const onFile = (file: File, idx: 0 | 1) => {
    if (!file || !/^image\//.test(file.type)) { notify("이미지 파일만 선택하세요.", "err"); return; }
    const img = new Image(); img.crossOrigin = "anonymous";
    const finalize = (src: string) => {
      img.onload = () => {
        bgRefs.current[idx] = img; bgUrls.current[idx] = src;
        setBgList(cur => { const n = [...cur]; n[idx] = { w: img.width, h: img.height }; return n; });
      };
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
      for (let i = 0; i < items.length; i++) {
        if (items[i].type?.startsWith("image/")) {
          const f = items[i].getAsFile(); if (f) onFile(f, activeBg);
        }
      }
    };
    window.addEventListener("paste", onPaste as any);
    return () => window.removeEventListener("paste", onPaste as any);
  }, [activeBg]);

  /* ==== 키보드: 포인트/이미지 미세이동 ==== */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
        if (e.key === "ArrowLeft") nx -= step;
        if (e.key === "ArrowRight") nx += step;
        if (e.key === "ArrowUp") ny -= step;
        if (e.key === "ArrowDown") ny += step;
        const nd = pixelToData(nx, ny);
        updateState(prev => ({
          ...prev,
          series: prev.series.map((s, si) =>
            si !== seriesIndex ? s : { ...s, points: s.points.map((p, pi) => (pi === pointIndex ? nd : p)) }
          ),
        }));
        return;
      }

      if (bgEditMode) {
        const step = e.shiftKey ? 10 : 1;
        updateState(prev => {
          const n = [...prev.bgXform] as [BgXf, BgXf];
          const xf = n[activeBg];
          n[activeBg] = {
            ...xf,
            offX: xf.offX + (e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0),
            offY: xf.offY + (e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0),
          };
          return { ...prev, bgXform: n };
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedPoint, bgEditMode, activeBg, currentState]);

  /* ==== 커서 매핑 ==== */
  const cursorForHandle = (handle: Handle, bgEdit: boolean, picking: boolean) => {
    if (picking) return "crosshair";
    if (!bgEdit) return "crosshair";
    switch (handle) {
      case "left":
      case "right":
        return "ew-resize";
      case "top":
      case "bottom":
        return "ns-resize";
      case "uniform":
        return "nwse-resize";
      default:
        return "move";
    }
  };

  /* ==== 그리드/보간 ==== */
  const SUPMAP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻", "+": "⁺", ".": "." };
  const sup = (s: number | string) => String(s).split("").map(ch => SUPMAP[ch] ?? ch).join("");
  const pow10Label = (n: number) => `10${sup(n)}`;
  const numFmt = (v: number, step?: number) => {
    if (!isFinite(v)) return "";
    const a = Math.abs(v);
    if (a === 0) return "0";
    const d = step !== undefined ? Math.max(0, Math.min(6, -Math.floor(Math.log10(Math.max(1e-12, step))))) :
      Math.max(0, Math.min(6, 3 - Math.floor(Math.log10(Math.max(1e-12, a)))));
    if (a >= 1e5 || a < 1e-3) return v.toExponential(2);
    return v.toFixed(d);
  };

  function drawGrid(ctx: CanvasRenderingContext2D) {
    const r = innerRect(), mm = tMinMax();
    if (!isFinite(mm.xmin) || !isFinite(mm.xmax) || !isFinite(mm.ymin) || !isFinite(mm.ymax) || mm.xmax <= mm.xmin || mm.ymax <= mm.ymin) {
      ctx.save(); ctx.fillStyle = "#9CA3AF"; ctx.font = "12px ui-sans-serif"; ctx.fillText("Invalid axis range", r.x + r.w / 2, r.y + r.h / 2); ctx.restore(); return;
    }
    ctx.save(); ctx.strokeStyle = "#E5E7EB"; ctx.fillStyle = "#6B7280"; ctx.lineWidth = 1; ctx.font = "12px ui-sans-serif";

    // X
    if (currentState.xLog) {
      const n0 = Math.floor(mm.xmin), n1 = Math.ceil(mm.xmax);
      for (let n = n0; n <= n1; n++) {
        const px = dataToPixel(Math.pow(10, n), 1).px;
        ctx.beginPath(); ctx.moveTo(px, r.y); ctx.lineTo(px, r.y + r.h); ctx.stroke();
        ctx.textAlign = "center"; ctx.fillText(pow10Label(n), px, r.y + r.h + 18);
        for (let m = 2; m < 10; m++) {
          const v = Math.pow(10, n) * m, lv = Math.log10(v);
          if (lv > mm.xmax) break; if (lv < mm.xmin) continue;
          const xm = dataToPixel(v, 1).px; ctx.save(); ctx.strokeStyle = "#F3F4F6";
          ctx.beginPath(); ctx.moveTo(xm, r.y); ctx.lineTo(xm, r.y + r.h); ctx.stroke(); ctx.restore();
        }
      }
    } else {
      const steps = 10;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps, px = r.x + t * r.w;
        ctx.beginPath(); ctx.moveTo(px, r.y); ctx.lineTo(px, r.y + r.h); ctx.stroke();
        ctx.textAlign = "center"; ctx.fillText(numFmt(currentState.xMin + t * (currentState.xMax - currentState.xMin), (currentState.xMax - currentState.xMin) / 10), px, r.y + r.h + 18);
      }
    }

    // Y
    if (currentState.yLog) {
      const n0 = Math.floor(mm.ymin), n1 = Math.ceil(mm.ymax);
      for (let n = n0; n <= n1; n++) {
        const py = dataToPixel(1, Math.pow(10, n)).py;
        ctx.beginPath(); ctx.moveTo(r.x, py); ctx.lineTo(r.x + r.w, py); ctx.stroke();
        ctx.textAlign = "right"; ctx.fillText(pow10Label(n), r.x - 6, py + 4);
        for (let m = 2; m < 10; m++) {
          const v = Math.pow(10, n) * m, lv = Math.log10(v);
          if (lv > mm.ymax) break; if (lv < mm.ymin) continue;
          const ym = dataToPixel(1, v).py; ctx.save(); ctx.strokeStyle = "#F3F4F6";
          ctx.beginPath(); ctx.moveTo(r.x, ym); ctx.lineTo(r.x + r.w, ym); ctx.stroke(); ctx.restore();
        }
      }
    } else {
      const steps = 10;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps, py = r.y + (1 - t) * r.h, val = currentState.yMin + t * (currentState.yMax - currentState.yMin);
        ctx.beginPath(); ctx.moveTo(r.x, py); ctx.lineTo(r.x + r.w, py); ctx.stroke();
        ctx.textAlign = "right"; ctx.fillText(numFmt(val, (currentState.yMax - currentState.yMin) / 10), r.x - 6, py + 4);
      }
    }
    ctx.restore();
  }

  function catmullRomPath(ctx: CanvasRenderingContext2D, pts: { px: number; py: number }[], alpha = 0.5) {
    if (pts.length < 2) { const p = pts[0]; ctx.moveTo(p.px, p.py); return; }
    ctx.moveTo(pts[0].px, pts[0].py);
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = i === 0 ? pts[0] : pts[i - 1];
      const p1 = pts[i]; const p2 = pts[i + 1];
      const p3 = i + 2 < pts.length ? pts[i + 2] : pts[pts.length - 1];
      const c1x = p1.px + ((p2.px - p0.px) / 6) * (1 - alpha);
      const c1y = p1.py + ((p2.py - p0.py) / 6) * (1 - alpha);
      const c2x = p2.px - ((p3.px - p1.px) / 6) * (1 - alpha);
      const c2y = p2.py - ((p3.py - p1.py) / 6) * (1 - alpha);
      ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.px, p2.py);
    }
  }

  /* ==== 캔버스 헬퍼 ==== */
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
    const right = hit(lr.x + lr.w, lr.y + lr.h / 2) ? "right" : "none";
    const left = hit(lr.x, lr.y + lr.h / 2) ? "left" : "none";
    const top = hit(lr.x + lr.w / 2, lr.y) ? "top" : "none";
    const bottom = hit(lr.x + lr.w / 2, lr.y + lr.h) ? "bottom" : "none";
    const corner = hit(lr.x + lr.w, lr.y + lr.h) ? "uniform" : "none";
    return right !== "none" ? right : left !== "none" ? left : top !== "none" ? top : bottom !== "none" ? bottom : corner;
  };

  /* ==== 교점 계산 ==== */
  function yAtX(seriesPts: Pt[], xTarget: number): number | null {
    if (!seriesPts || seriesPts.length < 2) return null;
    const tx = (x: number) => tVal(x, currentState.xLog);
    const ty = (y: number) => tVal(y, currentState.yLog);
    const invY = (tv: number) => (currentState.yLog ? Math.pow(10, tv) : tv);
    const xT = tx(xTarget);
    for (let i = 0; i < seriesPts.length - 1; i++) {
      const p1 = seriesPts[i], p2 = seriesPts[i + 1];
      const x1 = tx(p1.x), x2 = tx(p2.x);
      if ((x1 <= xT && xT <= x2) || (x2 <= xT && xT <= x1)) {
        const t = (xT - x1) / ((x2 - x1) || EPS);
        const yT = ty(p1.y) + t * (ty(p2.y) - ty(p1.y));
        return invY(yT);
      }
    }
    return null;
  }
  function xAtY(seriesPts: Pt[], yTarget: number): number | null {
    if (!seriesPts || seriesPts.length < 2) return null;
    const tx = (x: number) => tVal(x, currentState.xLog);
    const ty = (y: number) => tVal(y, currentState.yLog);
    const invX = (tv: number) => (currentState.xLog ? Math.pow(10, tv) : tv);
    const yT = ty(yTarget);
    for (let i = 0; i < seriesPts.length - 1; i++) {
      const p1 = seriesPts[i], p2 = seriesPts[i + 1];
      const y1 = ty(p1.y), y2 = ty(p2.y);
      if ((y1 <= yT && yT <= y2) || (y2 <= yT && yT <= y1)) {
        const t = (yT - y1) / ((y2 - y1) || EPS);
        const xT = tx(p1.x) + t * (tx(p2.x) - tx(p1.x));
        return invX(xT);
      }
    }
    return null;
  }

  /* ==== 렌더 ==== */
  useEffect(() => {
    if (!currentState) return;
    const { series } = currentState;
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;

      const r = innerRect();
      ctx.clearRect(0, 0, size.w, size.h);
      ctx.fillStyle = "#F9FAFB"; ctx.fillRect(0, 0, size.w, size.h);
      ctx.fillStyle = "#fff"; ctx.fillRect(r.x, r.y, r.w, r.h);
      lastRectRef.current = null;

    // Background images
      for (let i = 0 as 0 | 1; i <= 1; i = ((i + 1) as 0 | 1)) {
      const img = bgRefs.current[i]; if (!img || !showAB[i] || opacityAB[i] <= 0) continue;
        const { dx, dy, dw, dh, ax, ay } = drawRectAndAnchor(i);
      ctx.globalAlpha = opacityAB[i]; ctx.drawImage(img, dx, dy, dw, dh); ctx.globalAlpha = 1;
        if (i === activeBg) lastRectRef.current = { x: dx, y: dy, w: dw, h: dh };
        if (i === activeBg && pickAnchor) {
          ctx.save(); ctx.strokeStyle = "#F59E0B"; ctx.fillStyle = "#F59E0B";
          ctx.beginPath(); ctx.arc(ax, ay, 6, 0, Math.PI * 2); ctx.globalAlpha = 0.15; ctx.fill(); ctx.globalAlpha = 1;
          ctx.beginPath(); ctx.moveTo(ax - 8, ay); ctx.lineTo(ax + 8, ay); ctx.moveTo(ax, ay - 8); ctx.lineTo(ax, ay + 8); ctx.stroke(); ctx.restore();
        }
      if (i === activeBg && bgEditMode && lastRectRef.current) {
        const lr = lastRectRef.current, H = 12;
        ctx.save();
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

    // Guide X lines
    if (guideXs.length) {
      const rr = innerRect(); ctx.save(); ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5;
      for (const gx of guideXs) {
        const gp = dataToPixel(gx, 1); ctx.strokeStyle = "#EF4444";
        ctx.beginPath(); ctx.moveTo(gp.px, rr.y); ctx.lineTo(gp.px, rr.y + rr.h); ctx.stroke();
        currentState.series.forEach((s) => {
          const y = yAtX(s.points, gx); if (y == null) return;
          const P = dataToPixel(gx, y);
          if (showCrossFromX) { ctx.strokeStyle = "rgba(239,68,68,0.5)"; ctx.beginPath(); ctx.moveTo(rr.x, P.py); ctx.lineTo(rr.x + rr.w, P.py); ctx.stroke(); }
          ctx.fillStyle = "#EF4444"; ctx.beginPath(); ctx.arc(P.px, P.py, 4, 0, Math.PI * 2); ctx.fill();
        });
      }
      ctx.restore();
    }

    // Guide Y lines
    if (guideYs.length) {
      const rr = innerRect(); ctx.save(); ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5;
      for (const gy of guideYs) {
        const gp = dataToPixel(1, gy); ctx.strokeStyle = "#3B82F6";
        ctx.beginPath(); ctx.moveTo(rr.x, gp.py); ctx.lineTo(rr.x + rr.w, gp.py); ctx.stroke();
        currentState.series.forEach((s) => {
          const x = xAtY(s.points, gy); if (x == null) return;
          const P = dataToPixel(x, gy);
          if (showCrossFromY) { ctx.strokeStyle = "rgba(59,130,246,0.5)"; ctx.beginPath(); ctx.moveTo(P.px, rr.y); ctx.lineTo(P.px, rr.y + rr.h); ctx.stroke(); }
          ctx.fillStyle = "#3B82F6"; ctx.beginPath(); ctx.arc(P.px, P.py, 4, 0, Math.PI * 2); ctx.fill();
        });
      }
      ctx.restore();
    }

    // Lines
      if (connectLines) {
        const rr = innerRect(); ctx.save(); ctx.beginPath(); ctx.rect(rr.x, rr.y, rr.w, rr.h); ctx.clip();
        ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.globalAlpha = lineAlpha; ctx.lineWidth = lineWidth;
      for (const s of currentState.series) {
        if (s.points.length < 2) continue; const pxPts = s.points.map(p => dataToPixel(p.x, p.y));
          ctx.strokeStyle = s.color; ctx.beginPath();
        if (smoothLines && pxPts.length >= 2) catmullRomPath(ctx, pxPts, smoothAlpha);
        else { ctx.moveTo(pxPts[0].px, pxPts[0].py); for (let i = 1; i < pxPts.length; i++) ctx.lineTo(pxPts[i].px, pxPts[i].py); }
          ctx.stroke();
        }
        ctx.globalAlpha = 1; ctx.restore();
      }

    // Points
      if (showPoints) {
      currentState.series.forEach((s, si) => {
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

    // Axes titles
      ctx.strokeStyle = "#374151"; ctx.lineWidth = 1.2; ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = "#111827"; ctx.font = "14px ui-sans-serif, system-ui"; ctx.textAlign = "center"; ctx.fillText(currentState.xLog ? "X (10^n)" : "X", r.x + r.w / 2, r.y + r.h + 34);
    ctx.save(); ctx.translate(r.x - 45, r.y + r.h / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(currentState.yLog ? "Y (10^n)" : "Y", 0, 0); ctx.restore();

    // Legend
    ctx.save();
    const rr2 = innerRect(); ctx.font = "600 16px ui-sans-serif, system-ui";
    let lx = rr2.x + 10, ly = rr2.y + 20; const box = 12, gap = 10;
    currentState.series.forEach((s, i) => {
      ctx.fillStyle = s.color; ctx.fillRect(lx, ly - box + 2, box, box);
      ctx.fillStyle = "#0f172a"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.fillText(`${s.name} (${s.points.length})${i === activeSeries ? "  ◀" : ""}`, lx + box + gap, ly + 2);
      ly += 22;
    });
    ctx.restore();

    // Magnifier
    if (magnifyOn && hoverRef.current.x !== null) {
        const hp = dataToPixel(hoverRef.current.x!, hoverRef.current.y!);
      const sz = 120, f = magnifyFactor;
      const sx = Math.max(0, Math.min(size.w - sz / f, hp.px - sz / (2 * f)));
      const sy = Math.max(0, Math.min(size.h - sz / f, hp.py - sz / (2 * f)));
        ctx.save(); ctx.imageSmoothingEnabled = false;
      ctx.drawImage(c, sx, sy, sz / f, sz / f, size.w - sz - 16, 16, sz, sz);
      ctx.strokeStyle = "#111827"; ctx.lineWidth = 2; ctx.strokeRect(size.w - sz - 16, 16, sz, sz);
      ctx.beginPath(); ctx.moveTo(size.w - sz - 16 + sz / 2, 16); ctx.lineTo(size.w - sz - 16 + sz / 2, 16 + sz);
      ctx.moveTo(size.w - sz - 16, 16 + sz / 2); ctx.lineTo(size.w - 16, 16 + sz / 2); ctx.stroke(); ctx.restore();
    }
  }, [
    currentState, activeBg, showAB, opacityAB, keepAspect, anchorMode, pickAnchor, hoverHandle,
    showPoints, connectLines, lineAlpha, lineWidth, smoothLines, smoothAlpha, ptRadius,
    guideXs, guideYs, showCrossFromX, showCrossFromY, magnifyOn, magnifyFactor, selectedPoint, tick
  ]);

  /* ==== I²t Lifetime Graph Render ==== */
  useEffect(() => {
    if (!showI2tGraph || !currentState) return;
    try {
      const c = i2tCanvasRef.current; if (!c) return;
      const ctx = c.getContext("2d"); if (!ctx) return;
      const r = innerRect();
      ctx.clearRect(0, 0, size.w, size.h);
      ctx.fillStyle = "#F9FAFB"; ctx.fillRect(0, 0, size.w, size.h);
      ctx.fillStyle = "#fff"; ctx.fillRect(r.x, r.y, r.w, r.h);

      // I–t 데이터를 순간 I²t로 변환 (제품 하나의 T–C 기준)
      const activeSeriesData = currentState.series[activeSeries];
      if (activeSeriesData && activeSeriesData.points.length >= 2) {
        // 원래 그래프: X=전류(I), Y=시간(t) → I²t 그래프: X=시간(t), Y=I²t
        // 따라서 t=p.y, i=p.x 로 매핑
        const samples: Sample[] = activeSeriesData.points
          .map(p => ({ t: p.y, i: p.x }))
          .filter(s => isFinite(s.t) && isFinite(s.i) && s.t > 0 && s.i > 0)
          .sort((a, b) => a.t - b.t);
        
        // 기본 순간 I²t 커브: y = I(t)^2 · t, x = t
        const baseI2t = samples.map(s => ({ x: s.t, y: (s.i * s.i) * s.t }));

        if (baseI2t.length > 0) {
          // 축 범위를 데이터 기반으로 동적 계산 (로그 스케일 경계는 10의 지수로 스냅)
          const minPos = (arr: number[]) => Math.max(1e-12, Math.min(...arr.filter(v => v > 0)) || 1e-12);
          const maxPos = (arr: number[]) => Math.max(1e-12, Math.max(...arr.filter(v => v > 0)) || 1e-12);

          const tVals = baseI2t.map(p => p.x);
          const baseY = baseI2t.map(p => p.y);
          const scales = (lifetimeMode === "I_mode" ? currentMultipliers.map(m => m * m) : lifetimeRatios).filter(v => isFinite(v) && v > 0);
          const minScale = scales.length ? Math.min(...scales) : 1;
          const maxScale = scales.length ? Math.max(...scales) : 1;

          const rawXMin = minPos(tVals), rawXMax = maxPos(tVals);
          const rawYMin = minPos(baseY) * Math.max(1e-12, minScale);
          const rawYMax = maxPos(baseY) * Math.max(1e-12, maxScale);

          const floorPow10 = (v: number) => Math.pow(10, Math.floor(Math.log10(Math.max(1e-12, v))));
          const ceilPow10 = (v: number) => Math.pow(10, Math.ceil(Math.log10(Math.max(1e-12, v))));

          const dynXMin = floorPow10(rawXMin);
          const dynXMax = ceilPow10(rawXMax);
          const dynYMin = floorPow10(rawYMin);
          const dynYMax = ceilPow10(rawYMax);
          const i2tXMin = i2tFixedRange ? 1e-3 : dynXMin;
          const i2tXMax = i2tFixedRange ? 1e4 : dynXMax;
          const i2tYMin = i2tFixedRange ? 1e2 : dynYMin;
          const i2tYMax = i2tFixedRange ? 1e10 : dynYMax;
        
          // 각 수명 곡선 그리기 (모드별 스케일 계산, 선택된 것만) — 축 내부로 클리핑
          ctx.save();
          ctx.beginPath();
          ctx.rect(r.x, r.y, r.w, r.h);
          ctx.clip();
          lifetimeCycles.forEach((cycles, idx) => {
            if (!selectedLifetimeCycles.has(cycles)) return;
            
            // I_mode: I_N = m * I_base → I²t_N = (m^2) * I²t_base
            // I2t_mode: I²t_N = r * I²t_base
            const m = currentMultipliers[idx] ?? 1.0;
            const rScale = lifetimeRatios[idx] ?? 1.0;
            const yScale = lifetimeMode === "I_mode" ? (m * m) : rScale;
            const color = idx === 0 ? "#2563EB" : idx === 1 ? "#10B981" : idx === 2 ? "#DC2626" : 
                         idx === 3 ? "#F59E0B" : idx === 4 ? "#8B5CF6" : idx === 5 ? "#EC4899" : "#6B7280";
            
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.globalAlpha = 0.8;
            ctx.beginPath();
            
            // 부드러운 곡선을 위해 Catmull-Rom 스플라인 사용
            const pxPts: { px: number; py: number }[] = [];
            baseI2t.forEach((pt) => {
              const scaledY = pt.y * yScale;
              const px = r.x + ((Math.log10(Math.max(1e-12, pt.x)) - Math.log10(i2tXMin)) / 
                                (Math.log10(i2tXMax) - Math.log10(i2tXMin))) * r.w;
              const py = r.y + r.h - ((Math.log10(Math.max(1e-12, scaledY)) - Math.log10(i2tYMin)) / 
                                      (Math.log10(i2tYMax) - Math.log10(i2tYMin))) * r.h;
              pxPts.push({ px, py });
            });
            
            if (pxPts.length >= 2) {
              catmullRomPath(ctx, pxPts, smoothAlpha);
            }
            
            ctx.stroke();
          });
          
          // 레전드 (왼쪽 상단)
          let legendY = r.y + 20;
          lifetimeCycles.forEach((cycles, idx) => {
            if (!selectedLifetimeCycles.has(cycles)) return;
            const color = idx === 0 ? "#2563EB" : idx === 1 ? "#10B981" : idx === 2 ? "#DC2626" : 
                         idx === 3 ? "#F59E0B" : idx === 4 ? "#8B5CF6" : idx === 5 ? "#EC4899" : "#6B7280";
              ctx.fillStyle = color;
            ctx.fillRect(r.x + 10, legendY - 10, 12, 12);
            ctx.fillStyle = "#0f172a";
              ctx.font = "12px ui-sans-serif";
            ctx.textAlign = "left";
            ctx.fillText(`${cycles}次`, r.x + 26, legendY + 2);
            legendY += 18;
          });
          
          ctx.globalAlpha = 1;

          // 사용자 입력 포인트 표시 (실제 전류/시간)
          if (isFinite(lifeCheckI) && isFinite(lifeCheckT) && lifeCheckI > 0 && lifeCheckT > 0) {
            const userY = lifeCheckI * lifeCheckI * lifeCheckT; // I²t
            const px = r.x + ((Math.log10(Math.max(1e-12, lifeCheckT)) - Math.log10(i2tXMin)) / (Math.log10(i2tXMax) - Math.log10(i2tXMin))) * r.w;
            const py = r.y + r.h - ((Math.log10(Math.max(1e-12, userY)) - Math.log10(i2tYMin)) / (Math.log10(i2tYMax) - Math.log10(i2tYMin))) * r.h;
            ctx.save();
            ctx.strokeStyle = "#EF4444"; ctx.fillStyle = "#EF4444";
            ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI*2); ctx.fill();
            ctx.setLineDash([4,3]);
            ctx.beginPath(); ctx.moveTo(px, r.y); ctx.lineTo(px, r.y+r.h); ctx.moveTo(r.x, py); ctx.lineTo(r.x+r.w, py); ctx.stroke();
            ctx.setLineDash([]); ctx.font = "12px ui-sans-serif"; ctx.fillStyle = "#111827";
            ctx.fillText(`I=${lifeCheckI.toFixed(3)}A, t=${lifeCheckT}`, Math.min(r.x + r.w - 120, px + 6), Math.max(r.y + 12, py - 6));
            ctx.restore();
          }

          ctx.restore(); // 클리핑 해제

          // I²t 그래프 그리드 및 축 (동적 경계 사용)
          const drawI2tGrid = (ctx: CanvasRenderingContext2D, r: { x: number; y: number; w: number; h: number }) => {
            ctx.save();
            ctx.strokeStyle = "#E5E7EB";
            ctx.fillStyle = "#6B7280";
            ctx.lineWidth = 1;
            ctx.font = "12px ui-sans-serif";

            // X축 (시간)
            const x0 = Math.floor(Math.log10(i2tXMin)), x1 = Math.ceil(Math.log10(i2tXMax));
            for (let n = x0; n <= x1; n++) {
              const px = r.x + ((n - Math.log10(i2tXMin)) / (Math.log10(i2tXMax) - Math.log10(i2tXMin))) * r.w;
              ctx.beginPath();
              ctx.moveTo(px, r.y);
              ctx.lineTo(px, r.y + r.h);
              ctx.stroke();
              ctx.textAlign = "center";
              ctx.fillText(pow10Label(n), px, r.y + r.h + 18);
            }

            // Y축 (I²t)
            const y0 = Math.floor(Math.log10(i2tYMin)), y1 = Math.ceil(Math.log10(i2tYMax));
            for (let n = y0; n <= y1; n++) {
              const py = r.y + r.h - ((n - Math.log10(i2tYMin)) / (Math.log10(i2tYMax) - Math.log10(i2tYMin))) * r.h;
              ctx.beginPath();
              ctx.moveTo(r.x, py);
              ctx.lineTo(r.x + r.w, py);
              ctx.stroke();
              ctx.textAlign = "right";
              ctx.fillText(pow10Label(n), r.x - 6, py + 4);
            }
            ctx.restore();
          };

          drawI2tGrid(ctx, r);
        }
      }
      
      ctx.strokeStyle = "#374151";
      ctx.lineWidth = 1.2;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = "#111827";
      ctx.font = "14px ui-sans-serif, system-ui";
      ctx.textAlign = "center";
      ctx.fillText("수명 I²t특성도", r.x + r.w/2, r.y - 20);
      ctx.fillText("elapsed time (Sec)", r.x + r.w/2, r.y + r.h + 34);
      ctx.save();
      ctx.translate(r.x - 45, r.y + r.h/2);
      ctx.rotate(-Math.PI/2);
      ctx.fillText("I²t", 0, 0);
      ctx.restore();
    } catch (err) {
      console.error("I²t graph render error", err);
    }
  }, [currentState, activeSeries, size, pad, showI2tGraph, lifetimeCycles, lifetimeRatios, currentMultipliers, lifetimeMode, selectedLifetimeCycles, tick, smoothAlpha, lifeCheckI, lifeCheckT]);

  /* ==== 마우스 ==== */
  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { px, py } = canvasPoint(e);
    const rr = innerRect();
    if (px >= rr.x && px <= rr.x + rr.w && py >= rr.y && py <= rr.y + rr.h) hoverRef.current = pixelToData(px, py);
    else hoverRef.current = { x: null, y: null };

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

      const nsx = dw ? clampS(dw / baseW) : currentState.bgXform[activeBg].sx;
      const nsy = dh ? clampS(dh / baseH) : currentState.bgXform[activeBg].sy;

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
        n[activeBg] = { ax: px, ay: py, fx: Math.max(0, Math.min(1, fx)), fy: Math.max(0, Math.min(1, fy)) };
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
      // 선택 검사
      for (let si = 0; si < currentState.series.length; si++) {
        for (let pi = 0; pi < currentState.series[si].points.length; pi++) {
          const p = currentState.series[si].points[pi];
          const { px: ppx, py: ppy } = dataToPixel(p.x, p.y);
          if (Math.hypot(px - ppx, py - ppy) < ptRadius + 4) {
            setSelectedPoint({ seriesIndex: si, pointIndex: pi }); return;
          }
        }
      }
      // 새 포인트
      const d = pixelToData(px, py);
      updateState(prev => ({
        ...prev,
        series: prev.series.map((s, i) =>
          i === activeSeries ? { ...s, points: [...s.points, d].sort((a, b) => a.x - b.x) } : s
        ),
      }));
      setSelectedPoint(null);
    }
  };

  const onMouseUp = () => { dragRef.current.active = false; resizeRef.current.active = false; };
  const onMouseLeave = () => { hoverRef.current = { x: null, y: null }; setHoverHandle("none"); dragRef.current.active = false; resizeRef.current.active = false; setTick(t => t + 1); };

  /* ==== 프리셋 & 내보내기 ==== */
  const serialize = () => ({
    v: 1,
    axes: { xMin: currentState.xMin, xMax: currentState.xMax, yMin: currentState.yMin, yMax: currentState.yMax, xLog: currentState.xLog, yLog: currentState.yLog },
    series: currentState.series,
    bg: { xform: currentState.bgXform, customAnchors: currentState.customAnchors, activeBg, keepAspect, showAB, opacityAB },
    guidesX: guideXs,
    guidesY: guideYs,
    cross: { fromX: showCrossFromX, fromY: showCrossFromY },
    i2t: { show: showI2tGraph, mode: lifetimeMode, cycles: lifetimeCycles, multipliers: currentMultipliers, ratios: lifetimeRatios }
  });

  const applyPreset = (p: any) => {
    try {
      const next: AppState = {
        xMin: p.axes?.xMin ?? 10,
        xMax: p.axes?.xMax ?? 1_000_000,
        yMin: p.axes?.yMin ?? 0.0001,
        yMax: p.axes?.yMax ?? 1_000_000,
        xLog: !!p.axes?.xLog,
        yLog: !!p.axes?.yLog,
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

      // I²t 옵션 로드
      if (p.i2t) {
        setShowI2tGraph(!!p.i2t.show);
        if (p.i2t.mode === "I_mode" || p.i2t.mode === "I2t_mode") setLifetimeMode(p.i2t.mode);
        if (Array.isArray(p.i2t.cycles)) setLifetimeCycles(p.i2t.cycles.map(Number).filter((v: number)=>isFinite(v)&&v>0));
        if (Array.isArray(p.i2t.multipliers)) setCurrentMultipliers(p.i2t.multipliers.map(Number).filter((v: number)=>isFinite(v)&&v>0));
        if (Array.isArray(p.i2t.ratios)) setLifetimeRatios(p.i2t.ratios.map(Number).filter((v: number)=>isFinite(v)&&v>0));
      }

      updateState(() => next, true);
      notify("Preset loaded");
    } catch { notify("Invalid preset", "err"); }
  };

  const savePresetFile = () => {
    const blob = new Blob([JSON.stringify(serialize(), null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `digitizer_preset_${Date.now()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 0);
  };
  const loadPresetFromFile = (file: File | null) => {
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      try { const p = JSON.parse(String(fr.result || "{}")); applyPreset(p); }
      catch { notify("Cannot parse preset", "err"); }
    };
    fr.readAsText(file);
  };
  const copyShareURL = () => {
    const payload = btoa(unescape(encodeURIComponent(JSON.stringify(serialize()))));
    const url = `${location.origin}${location.pathname}#s=${payload}`;
    navigator.clipboard.writeText(url).then(() => notify("URL copied"));
  };
  const exportCSV = () => {
    let out = "series,x,y\n";
    currentState.series.forEach(s => s.points.forEach(p => (out += `${s.name},${p.x},${p.y}\n`)));
    const url = URL.createObjectURL(new Blob([out], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `points_${Date.now()}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const exportPNG = () => {
    const c = canvasRef.current; if (!c) return;
    const url = c.toDataURL("image/png");
    const a = document.createElement("a"); a.href = url; a.download = `digitizer_${Date.now()}.png`; a.click();
  };

  // URL/Local 자동 로드/저장
  useEffect(() => {
    const h = location.hash || "";
    if (h.startsWith("#s=")) {
      try { applyPreset(JSON.parse(decodeURIComponent(escape(atob(h.slice(3)))))); return; } catch {}
    }
    try {
      const raw = localStorage.getItem("digitizer:auto");
      if (raw) applyPreset(JSON.parse(raw));
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem("digitizer:auto", JSON.stringify(serialize())); } catch {}
  }, [currentState, guideXs, guideYs, showCrossFromX, showCrossFromY, keepAspect, showAB, opacityAB, activeBg]);

  if (!currentState) return <div className="flex h-screen items-center justify-center">Loading...</div>;

  /* ======= 좌표 패널 데이터 ======= */
  // 시리즈별 정렬(A→B), 각 시리즈 내부 x 오름차순
  const pointRows = currentState.series
    .map(s => ({ name: s.name, rows: [...s.points].sort((a, b) => a.x - b.x) }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(s => s.rows.map(p => ({ series: s.name, x: p.x, y: p.y })));

  // Guides 표: 입력 라벨 그대로 노출
  const guideRows: Array<{ kind: "X" | "Y"; guide: number; guideLabel: string; series: string; value: number | null }> = [];
  for (const gx of guideXs) {
    const label = guideXLabels[gx] ?? fmtReal(gx);
    currentState.series.forEach(s => guideRows.push({ kind: "X", guide: gx, guideLabel: label, series: s.name, value: yAtX(s.points, gx) }));
  }
  for (const gy of guideYs) {
    const label = guideYLabels[gy] ?? fmtReal(gy);
    currentState.series.forEach(s => guideRows.push({ kind: "Y", guide: gy, guideLabel: label, series: s.name, value: xAtY(s.points, gy) }));
  }

  return (
    <div className="min-h-screen bg-gray-100 text-gray-800 font-sans antialiased">
      {/* Header */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-gray-200 bg-white/80 p-4 backdrop-blur-sm">
        <h1 className="text-xl font-bold text-gray-900">Log-scale Graph Digitizer</h1>
        <div className="flex flex-wrap items-center gap-3 text-base">
          <button onClick={() => updateState(p=>({...p, series:p.series.map((s,i)=>i===activeSeries?{...s, points:s.points.slice(0,-1)}:s)}))} className="rounded-lg bg-gray-200 px-4 py-2 font-semibold hover:bg-gray-300">Undo Last Point</button>
          <button onClick={() => updateState(p=>({...p, series:p.series.map((s,i)=>i===activeSeries?{...s, points:[]}:s)}))} className="rounded-lg bg-gray-200 px-4 py-2 font-semibold text-red-700 hover:bg-red-100">Clear Active Series</button>

          <div className="h-6 w-px bg-gray-300" />
          <button onClick={handleUndo} disabled={historyIndex <= 0} className="rounded-lg bg-gray-200 px-4 py-2 font-semibold hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed">Undo</button>
          <button onClick={handleRedo} disabled={historyIndex >= history.length - 1} className="rounded-lg bg-gray-200 px-4 py-2 font-semibold hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed">Redo</button>
          <div className="h-6 w-px bg-gray-300" />
          <button onClick={savePresetFile} className="rounded-lg bg-gray-200 px-4 py-2 hover:bg-gray-300">Save Preset</button>
          <button onClick={() => presetFileRef.current?.click()} className="rounded-lg bg-gray-200 px-4 py-2 hover:bg-gray-300">Load Preset</button>
          <input ref={presetFileRef} type="file" accept="application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) loadPresetFromFile(f); (e.target as any).value = ""; }} />
          <button onClick={copyShareURL} className="rounded-lg bg-gray-200 px-4 py-2 hover:bg-gray-300">Copy URL</button>
          <div className="h-6 w-px bg-gray-300" />
          <button onClick={exportCSV} className="rounded-lg bg-gray-200 px-4 py-2 hover:bg-gray-300">Export CSV</button>
          <button onClick={exportPNG} className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700">Export PNG</button>
        </div>
      </header>

      {/* Layout */}
      <main className={`grid grid-cols-1 gap-3 p-3 ${sidebarCollapsed ? "lg:grid-cols-[60px,1fr]" : showI2tGraph ? "lg:grid-cols-[280px,1fr,1fr]" : "lg:grid-cols-[280px,1fr]"}`}>
        {/* Left Panel */}
        <aside className={`flex flex-col gap-2 ${sidebarCollapsed ? "items-center" : ""}`}>
          {sidebarCollapsed ? (
            <div className="flex flex-col gap-2">
              <button onClick={() => setSidebarCollapsed(false)} className="rounded-lg border px-2 py-2 mb-2 text-xl">›</button>
              <button onClick={() => setAxesOpen(v => !v)} className={`rounded-lg px-2 py-2 mb-2 text-xl ${axesOpen ? "bg-gray-900 text-white" : "border"}`}>📐</button>
              <button onClick={() => setBgEditMode(v => !v)} className={`rounded-lg px-2 py-2 mb-2 text-xl ${bgEditMode ? "bg-gray-900 text-white" : "border"}`}>🖼️</button>
              <button className="rounded-lg px-2 py-2 text-xl border">📈</button>
            </div>
          ) : (
            <>
              <button onClick={() => setSidebarCollapsed(true)} className="self-end rounded-lg border px-2 py-0.5 text-xs">‹ 접기</button>
          {/* Axes */}
          <AccordionSection title="Axes" isOpen={axesOpen} onToggle={() => setAxesOpen(v => !v)}>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <label className="col-span-2 flex items-center gap-2"><input type="checkbox" className="h-3 w-3" checked={currentState.xLog} onChange={e => updateState(p => ({ ...p, xLog: e.target.checked }))} /> X Log Scale</label>
              <label className="flex items-center gap-2 text-xs">X Min <input type="number" className="w-full rounded border px-1.5 py-1 text-xs" value={currentState.xMin} onChange={e => updateState(p => ({ ...p, xMin: Number(e.target.value) }))} /></label>
              <label className="flex items-center gap-2 text-xs">X Max <input type="number" className="w-full rounded border px-1.5 py-1 text-xs" value={currentState.xMax} onChange={e => updateState(p => ({ ...p, xMax: Number(e.target.value) }))} /></label>
              <label className="col-span-2 flex items-center gap-2 text-xs"><input type="checkbox" className="h-3 w-3" checked={currentState.yLog} onChange={e => updateState(p => ({ ...p, yLog: e.target.checked }))} /> Y Log Scale</label>
              <label className="flex items-center gap-2 text-xs">Y Min <input type="number" className="w-full rounded border px-1.5 py-1 text-xs" value={currentState.yMin} onChange={e => updateState(p => ({ ...p, yMin: Number(e.target.value) }))} /></label>
              <label className="flex items-center gap-2 text-xs">Y Max <input type="number" className="w-full rounded border px-1.5 py-1 text-xs" value={currentState.yMax} onChange={e => updateState(p => ({ ...p, yMax: Number(e.target.value) }))} /></label>
            </div>
          </AccordionSection>

          {/* Image Edit */}
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <button onClick={() => setBgEditMode(v => !v)} className="flex w-full items-center justify-between p-2 text-left">
              <h3 className="text-sm font-bold text-gray-800">Image Edit</h3>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${bgEditMode ? "bg-orange-100 text-orange-800" : "bg-gray-200 text-gray-700"}`}>{bgEditMode ? "ON" : "OFF"}</span>
            </button>
            {bgEditMode && (
              <div className="space-y-2 p-2 pt-0 text-xs">
                <div className="flex border-b border-gray-200">
                  <button onClick={() => setActiveBg(0)} className={`-mb-px border-b-2 px-2 py-1 text-xs font-semibold ${activeBg === 0 ? "border-blue-500 text-blue-600" : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"}`}>Image A</button>
                  <button onClick={() => setActiveBg(1)} className={`-mb-px border-b-2 px-2 py-1 text-xs font-semibold ${activeBg === 1 ? "border-blue-500 text-blue-600" : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"}`}>Image B</button>
                </div>

                <button onClick={() => (activeBg === 0 ? fileARef : fileBRef).current?.click()} className="w-full rounded bg-gray-800 py-1.5 text-center text-xs font-semibold text-white hover:bg-gray-700">Load Image {activeBg === 0 ? "A" : "B"}</button>
                <input ref={fileARef} type="file" accept="image/*" hidden onChange={(e)=>{const f=e.target.files?.[0]; if(f) onFile(f,0); (e.target as any).value="";}}/>
                <input ref={fileBRef} type="file" accept="image/*" hidden onChange={(e)=>{const f=e.target.files?.[0]; if(f) onFile(f,1); (e.target as any).value="";}}/>

                <div className="grid grid-cols-2 gap-2">
                  <label className="flex items-center justify-between text-xs"><span>Show Image</span><input type="checkbox" className="h-3 w-3" checked={showAB[activeBg]} onChange={(e)=>setShowAB(cur=>{const n=[...cur] as [boolean,boolean]; n[activeBg]=e.target.checked; return n;})}/></label>
                  <label className="flex items-center gap-2 text-xs"><span>Opacity</span><input className="w-24" type="range" min={0} max={1} step={0.05} value={opacityAB[activeBg]} onChange={(e)=>setOpacityAB(cur=>{const n=[...cur] as [number,number]; n[activeBg]=Number(e.target.value); return n;})}/></label>
                  <label className="col-span-2 flex items-center gap-2 text-xs"><input type="checkbox" className="h-3 w-3" checked={keepAspect} onChange={(e)=>setKeepAspect(e.target.checked)}/> Keep Ratio</label>
                  <div className="col-span-2 grid grid-cols-2 gap-2">
                    <button onClick={()=>setPickAnchor(v=>!v)} className={`w-full rounded bg-gray-200 px-2 py-1 text-xs font-semibold ${pickAnchor ? "bg-orange-100 text-orange-800" : "text-gray-800"}`}>{pickAnchor ? "Picking..." : "Pick Anchor"}</button>
                    <button onClick={()=>updateState(prev=>{ const n=[...prev.customAnchors] as [CustomAnchor,CustomAnchor]; n[activeBg]=null; return {...prev, customAnchors:n};})} className="w-full rounded bg-gray-200 px-2 py-1 text-xs font-semibold text-gray-800">Clear</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Series & Points */}
          <div className="rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-800">Series & Points</h3>
              <label className="flex items-center gap-1 text-xs text-gray-700">
                <input type="checkbox" className="h-3 w-3" checked={magnifyOn} onChange={(e)=>setMagnifyOn(e.target.checked)} />
                Magnifier
                </label>
              </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold">Active:</span>
                <label className="flex items-center gap-1 text-xs"><input type="radio" className="h-3 w-3" name="series" checked={activeSeries === 0} onChange={() => { setActiveSeries(0); setSelectedPoint(null); }} /> A</label>
                <label className="flex items-center gap-1 text-xs"><input type="radio" className="h-3 w-3" name="series" checked={activeSeries === 1} onChange={() => { setActiveSeries(1); setSelectedPoint(null); }} /> B</label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs">Name A <input className="w-full rounded border px-1.5 py-1 text-xs" value={currentState.series[0].name} onChange={(e)=>updateState(p=>({...p, series:p.series.map((s,i)=>i===0?{...s, name:e.target.value}:s)}))}/></label>
                <label className="flex flex-col gap-1 text-xs">Name B <input className="w-full rounded border px-1.5 py-1 text-xs" value={currentState.series[1].name} onChange={(e)=>updateState(p=>({...p, series:p.series.map((s,i)=>i===1?{...s, name:e.target.value}:s)}))}/></label>
            </div>

              <div className="!mt-2 grid grid-cols-2 gap-x-2 gap-y-2 border-t border-gray-200 pt-2">
                <label className="col-span-2 flex items-center gap-2 text-xs"><input type="checkbox" className="h-3 w-3" checked={connectLines} onChange={(e)=>setConnectLines(e.target.checked)} /> Connect points</label>
                <label className="flex items-center gap-1 text-xs">Width <input className="w-full rounded border px-1 py-0.5 text-xs" value={lineWidth} onChange={(e)=>setLineWidth(Number(e.target.value)||1)} /></label>
                <label className="flex items-center gap-1 text-xs">Alpha <input type="range" className="w-full" min={0} max={1} step={0.05} value={lineAlpha} onChange={(e)=>setLineAlpha(Number(e.target.value))} /></label>
                <label className="col-span-2 flex items-center gap-2 text-xs"><input type="checkbox" className="h-3 w-3" checked={smoothLines} onChange={(e)=>setSmoothLines(e.target.checked)} /> Smooth</label>
                {smoothLines && (<label className="col-span-2 flex items-center gap-2 text-xs">Strength <input type="range" min={0} max={0.9} step={0.05} className="w-full" value={smoothAlpha} onChange={(e)=>setSmoothAlpha(Number(e.target.value))} /></label>)}
                <label className="col-span-2 !mt-2 flex items-center gap-2 border-t border-gray-200 pt-2 text-xs"><input type="checkbox" className="h-3 w-3" checked={showPoints} onChange={(e)=>setShowPoints(e.target.checked)} /> Show points</label>
                <label className="col-span-2 flex items-center gap-2 text-xs">Size <input type="range" className="w-full" min={1} max={8} step={1} value={ptRadius} onChange={(e)=>setPtRadius(Number(e.target.value))} /></label>
              </div>

              {/* Guides 섹션: 좌측에서는 제거됨 */}
            </div>
          </div>
            </>
          )}
        </aside>

        {/* Right: Canvas + 좌표 패널 */}
        <div className={`grid grid-cols-1 gap-3 ${showI2tGraph ? "lg:grid-cols-2" : "lg:grid-cols-1"} col-span-1`}>
          {/* Original Graph */}
          <div className="rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
            {/* I²t 그래프 체크박스 - TC 그래프 위쪽 */}
            <div className="mb-2 flex items-center gap-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-gray-700">
                <input 
                  type="checkbox" 
                  className="h-4 w-4" 
                  checked={showI2tGraph} 
                  onChange={(e) => setShowI2tGraph(e.target.checked)} 
                />
                <span>Show I²t Lifetime Graph</span>
              </label>
            </div>
            <div className="mb-2 h-4 text-xs text-gray-600">
              {hoverRef.current.x !== null ? (
                <span className="font-mono text-xs">Cursor: X={fmtReal(hoverRef.current.x)} , Y={fmtReal(hoverRef.current.y)}</span>
              ) : <span className="text-xs">Hover over the graph area to see coordinates.</span>}
            </div>
            {/* 실수좌표 토글 (상단 표시는 제거됨 — Points 섹션 내 토글만 유지) */}
            <div className="overflow-hidden rounded-lg border border-gray-300">
            <canvas
              ref={canvasRef}
              width={size.w}
              height={size.h}
                className="block touch-none select-none"
                style={{ cursor: cursorForHandle(hoverHandle, bgEditMode, pickAnchor) as any }}
              onMouseMove={onMouseMove}
              onMouseDown={onMouseDown}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseLeave}
                onWheel={(e)=>{ if(!bgEditMode) return; e.preventDefault(); const k = e.deltaY < 0 ? 1.05 : 0.95; updateState(prev=>{const n=[...prev.bgXform] as [BgXf,BgXf]; const xf=n[activeBg]; const nsx=clampS(xf.sx*k); const nsy=clampS(xf.sy*(keepAspect?k:k)); n[activeBg]={...xf, sx: nsx, sy: keepAspect?nsx:nsy}; return {...prev, bgXform:n};}); }}
              onDragOver={(e)=>e.preventDefault()}
                onDrop={(e)=>{e.preventDefault(); const f=e.dataTransfer?.files?.[0]; if(f && /^image\//.test(f.type)) onFile(f as File, activeBg);}}
                onContextMenu={(e)=>{e.preventDefault(); if(pickAnchor) setPickAnchor(false);}}
            />
          </div>
          {/* Points + Guides 래퍼: 좌우 배치 (항상 2열) */}
          <div className="mt-2 grid grid-cols-2 gap-2 border-t border-gray-200 pt-2">
          {/* Points 섹션 */}
          <div className="col-span-1 grid grid-cols-1 gap-2">
            {/* Points */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <div className="text-xs font-semibold text-gray-700">Points - Active series ({currentState.series[activeSeries].name})</div>
                <label className="flex items-center gap-1 text-[11px] text-gray-700">
                  <input type="checkbox" className="h-3 w-3" checked={showRealCoords} onChange={(e)=>setShowRealCoords(e.target.checked)} /> 실수좌표
                </label>
        </div>
              <div className="flex flex-wrap items-center gap-1.5 max-h-24 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
              {currentState.series[activeSeries].points.length === 0 ? (
                <span className="text-xs text-gray-400">No points</span>
              ) : currentState.series[activeSeries].points.map((p, idx) => (
                <div key={idx} className="flex items-center gap-1 rounded border border-gray-300 px-2 py-0.5">
                  <span className="text-[10px] text-gray-500">#{idx+1}</span>
                    <input
                    type="text"
                    className="w-20 text-right text-xs font-mono border-0 bg-transparent focus:bg-white focus:border focus:border-blue-300 rounded px-1"
                    value={showRealCoords ? fmtReal(p.x) : fmtReal(currentState.xLog ? Math.log10(Math.max(EPS, p.x)) : p.x)}
                    onChange={(e)=>{
                      const val = Number(e.target.value);
                      if (isFinite(val) && val > 0) {
                        updateState(prev => ({
                          ...prev,
                          series: prev.series.map((s, si) => si !== activeSeries ? s : ({
                            ...s,
                              points: s.points.map((pt, pi) => pi === idx ? { ...pt, x: (showRealCoords ? val : (currentState.xLog ? Math.pow(10, val) : val)) } : pt)
                          }))
                        }));
                        setTick(t=>t+1);
                      }
                    }}
                  />
                  <span className="text-[10px] text-gray-400">,</span>
                    <input
                    type="text"
                    className="w-20 text-right text-xs font-mono border-0 bg-transparent focus:bg-white focus:border focus:border-blue-300 rounded px-1"
                    value={showRealCoords ? fmtReal(p.y) : fmtReal(currentState.yLog ? Math.log10(Math.max(EPS, p.y)) : p.y)}
                    onChange={(e)=>{
                      const val = Number(e.target.value);
                      if (isFinite(val) && val > 0) {
                        updateState(prev => ({
                          ...prev,
                          series: prev.series.map((s, si) => si !== activeSeries ? s : ({
                            ...s,
                              points: s.points.map((pt, pi) => pi === idx ? { ...pt, y: (showRealCoords ? val : (currentState.yLog ? Math.pow(10, val) : val)) } : pt)
                          }))
                        }));
                        setTick(t=>t+1);
                      }
                    }}
                  />
                  <button
                    className="ml-1 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] hover:bg-gray-300"
                    onClick={() => {
                      updateState(prev => ({
                        ...prev,
                        series: prev.series.map((s, si) => si !== activeSeries ? s : ({
                          ...s,
                          points: s.points.filter((_, pi) => pi !== idx)
                        }))
                      }));
                      setTick(t=>t+1);
                    }}
                  >Del</button>
      </div>
              ))}
            </div>
          </div>

          {/* Guides 섹션 (입력/표시) */}
            <div className="col-span-1 grid grid-cols-1 gap-2">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <div className="text-xs font-semibold text-gray-700">Guides</div>
                </div>
                {/* X Guides 입력 */}
                <div className="flex items-center gap-1">
                  <span className="w-4 text-xs font-semibold text-gray-600">X</span>
                  <input
                    className="flex-grow rounded border px-1.5 py-0.5 text-xs"
                    placeholder="1,000"
                    value={guideInput}
                    onChange={(e)=>setGuideInput(e.target.value)}
                    onKeyDown={(e)=>{ if(e.key==="Enter"){ const raw=e.currentTarget.value.trim(); const n=Number(raw.replace(/,/g,"")); if(isFinite(n)&&n>0){ setGuideXs(g=>Array.from(new Set([...g,n]))); setGuideXLabels(m=>({...m,[n]:raw})); setGuideInput(""); } } }}
                  />
                  <button className="rounded bg-gray-200 px-1.5 py-0.5 text-xs hover:bg-gray-300" onClick={()=>{ const raw=guideInput.trim(); const n=Number(raw.replace(/,/g,"")); if(isFinite(n)&&n>0){ setGuideXs(g=>Array.from(new Set([...g,n]))); setGuideXLabels(m=>({...m,[n]:raw})); setGuideInput(""); } }}>Add</button>
                  <button className="rounded bg-gray-200 px-1.5 py-0.5 text-xs hover:bg-gray-300" onClick={()=>{ setGuideXs([]); setGuideXLabels({}); }}>Clear</button>
                  <label className="ml-auto flex items-center gap-1 pl-1 text-xs"><input type="checkbox" className="h-3 w-3" checked={showCrossFromX} onChange={(e)=>setShowCrossFromX(e.target.checked)} /> Cross</label>
                </div>
                {/* Y Guides 입력 */}
                <div className="mt-1 flex items-center gap-1">
                  <span className="w-4 text-xs font-semibold text-gray-600">Y</span>
                  <input
                    className="flex-grow rounded border px-1.5 py-0.5 text-xs"
                    placeholder="10"
                    value={guideYInput}
                    onChange={(e)=>setGuideYInput(e.target.value)}
                    onKeyDown={(e)=>{ if(e.key==="Enter"){ const raw=e.currentTarget.value.trim(); const n=Number(raw.replace(/,/g,"")); if(isFinite(n)&&n>0){ setGuideYs(g=>Array.from(new Set([...g,n]))); setGuideYLabels(m=>({...m,[n]:raw})); setGuideYInput(""); } } }}
                  />
                  <button className="rounded bg-gray-200 px-1.5 py-0.5 text-xs hover:bg-gray-300" onClick={()=>{ const raw=guideYInput.trim(); const n=Number(raw.replace(/,/g,"")); if(isFinite(n)&&n>0){ setGuideYs(g=>Array.from(new Set([...g,n]))); setGuideYLabels(m=>({...m,[n]:raw})); setGuideYInput(""); } }}>Add</button>
                  <button className="rounded bg-gray-200 px-1.5 py-0.5 text-xs hover:bg-gray-300" onClick={()=>{ setGuideYs([]); setGuideYLabels({}); }}>Clear</button>
                  <label className="ml-auto flex items-center gap-1 pl-1 text-xs"><input type="checkbox" className="h-3 w-3" checked={showCrossFromY} onChange={(e)=>setShowCrossFromY(e.target.checked)} /> Cross</label>
                </div>

                {/* 좌표 표시: "X=..., A: ..." 형식 (화살표 표기 제거) */}
                <div className="mt-2 max-h-24 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                  {guideRows.length === 0 ? (
                    <span className="text-xs text-gray-400">No guides</span>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {guideRows.map((r, i) => (
                        <div key={i} className="flex items-center gap-1 rounded border border-gray-300 px-2 py-0.5">
                          <span className="text-[10px] text-gray-500">{r.kind}=</span>
                          <span className="text-xs font-mono text-gray-700">{r.guideLabel}</span>
                          <span className="text-[10px] text-gray-400">,</span>
                          <span className="text-[10px] text-gray-500">{r.series}:</span>
                          <span className="text-xs font-mono text-gray-700">{fmtReal(r.value)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>
          </div>
          </div>

          {/* I²t Lifetime Graph */}
          {showI2tGraph && (
            <div className="rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
              <div className="mb-2 flex items-center justify-between h-4 text-xs text-gray-600 font-semibold"><span>I²t Lifetime Graph</span><label className="flex items-center gap-1 text-[11px]"><input type="checkbox" className="h-3 w-3" checked={i2tFixedRange} onChange={e=>setI2tFixedRange(e.target.checked)} /> 범위 고정( X:1e-3~1e4, Y:1e2~1e10 )</label></div>
              <div className="overflow-hidden rounded-lg border border-gray-300">
                <canvas
                  ref={i2tCanvasRef}
                  width={size.w}
                  height={size.h}
                  className="block touch-none select-none"
                />
              </div>
              {/* 모드/선택 UI */}
              <div className="mt-2 space-y-2 border-t border-gray-200 pt-2">
                <div className="flex items-center gap-3 text-xs">
                  <label className="flex items-center gap-1"><input type="radio" className="h-3 w-3" name="lifeMode2" checked={lifetimeMode==='I_mode'} onChange={()=>setLifetimeMode('I_mode')} /> I mode</label>
                  <label className="flex items-center gap-1"><input type="radio" className="h-3 w-3" name="lifeMode2" checked={lifetimeMode==='I2t_mode'} onChange={()=>setLifetimeMode('I2t_mode')} /> I²t mode</label>
                </div>
                <div className="text-xs font-semibold text-gray-700">N levels - Lifetime 선택:</div>
                <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                  {lifetimeCycles.map((cycle, idx) => (
                    <label key={idx} className="flex items-center gap-1 rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50">
                      <input
                        type="checkbox"
                        className="h-3 w-3"
                        checked={selectedLifetimeCycles.has(cycle)}
                        onChange={(e) => {
                          const newSet = new Set(selectedLifetimeCycles);
                          if (e.target.checked) {
                            newSet.add(cycle);
                          } else {
                            newSet.delete(cycle);
                          }
                          setSelectedLifetimeCycles(newSet);
                        }}
                      />
                      <span className="text-xs">{cycle.toLocaleString()}</span>
                    </label>
                  ))}
        </div>
                <div className="flex items-center gap-3 text-[11px]"><label className="flex items-center gap-1"><input type="checkbox" className="h-3 w-3" checked={enterCurrents} onChange={(e)=>setEnterCurrents(e.target.checked)} /> 전류로 입력</label><span className="text-gray-500">{enterCurrents && `(base ${(LIFE_CURRENT_BASE/1000).toFixed(2)} kA / ${LIFE_CURRENT_BASE} A)`}</span></div>
                <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                  {lifetimeCycles.map((cycle, idx) => {
                    const multiplier = currentMultipliers[idx] ?? 1.0;
                    const ratio = lifetimeRatios[idx] ?? 1.0;
                    return (
                      <div key={idx} className="flex items-center gap-1 rounded border border-gray-300 px-2 py-0.5">
                        <span className="text-xs text-gray-500">{cycle}:</span>
                        {lifetimeMode === 'I_mode' ? (
                          enterCurrents ? (
                            <input
                              type="text"
                              className="w-20 text-xs font-mono border-0 bg-transparent focus:bg-white focus:border focus:border-blue-300 rounded px-1"
                              value={currentInputs[idx] ?? (multiplier * LIFE_CURRENT_BASE).toFixed(3)}
                              onChange={(e)=>{
                                const v = e.target.value; setCurrentInputs(s=>({...s, [idx]: v}));
                                const n = Number(v); if(isFinite(n) && n>0){
                                  const newMultipliers = [...currentMultipliers]; newMultipliers[idx] = n / LIFE_CURRENT_BASE; setCurrentMultipliers(newMultipliers); setTick(t=>t+1);
                                }
                              }}
                            />
                          ) : (
                            <input
                              type="text"
                              className="w-16 text-xs font-mono border-0 bg-transparent focus:bg-white focus:border focus:border-blue-300 rounded px-1"
                              value={multiplierInputs[idx] ?? multiplier.toFixed(3)}
                              onChange={(e)=>{
                                const v = e.target.value; setMultiplierInputs(s=>({...s, [idx]: v}));
                                const n = Number(v); if(isFinite(n) && n>0){
                                  const newMultipliers = [...currentMultipliers]; newMultipliers[idx] = n; setCurrentMultipliers(newMultipliers); setTick(t=>t+1);
                                }
                              }}
                            />
                          )
                        ) : (
                          <input
                            type="text"
                            className="w-16 text-xs font-mono border-0 bg-transparent focus:bg-white focus:border focus:border-blue-300 rounded px-1"
                            value={(ratio).toFixed(3)}
                            onChange={(e)=>{
                              const n = Number(e.target.value); if(isFinite(n) && n>0){ const newRatios=[...lifetimeRatios]; newRatios[idx]=n; setLifetimeRatios(newRatios); setTick(t=>t+1);} }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 수명 만족도 계산기 (실제 전류/시간 입력) */}
              <div className="mt-2 space-y-2 border-t border-gray-200 pt-2">
                <div className="text-xs font-semibold text-gray-700">수명 만족도 계산</div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <label className="flex items-center gap-1">I(A)<input type="text" className="w-24 rounded border px-1 py-0.5 text-xs" value={lifeIInput} onChange={(e)=>{ const v=e.target.value; setLifeIInput(v); const n = Number(v); if(isFinite(n) && n>=0) setLifeCheckI(n); }} /></label>
                  <label className="flex items-center gap-1">t(s)<input type="text" className="w-24 rounded border px-1 py-0.5 text-xs" value={lifeTInput} onChange={(e)=>{ const v=e.target.value; setLifeTInput(v); const n = Number(v); if(isFinite(n) && n>=0) setLifeCheckT(n); }} /></label>
                  <span className="text-[11px] text-gray-500">입력 I²t = { (isFinite(lifeCheckI)&&isFinite(lifeCheckT)&&lifeCheckI>0&&lifeCheckT>0? (lifeCheckI*lifeCheckI*lifeCheckT).toExponential(2) : '-') }</span>
                </div>
                <div className="text-xs">
                  {(()=>{
                    const s = currentState.series[activeSeries];
                    if (!s || s.points.length < 2 || !(lifeCheckI>0) || !(lifeCheckT>0)) return '값을 입력하세요.';
                    const samples = s.points.map(p=>({t:p.y,i:p.x})).filter(v=>v.t>0&&v.i>0).sort((a,b)=>a.t-b.t);
                    if (samples.length<2) return '데이터가 부족합니다.';
                    const base = samples.map(x=>({x:x.t, y:(x.i*x.i)*x.t}));
                    const interp = (tx:number)=>{
                      for(let i=0;i<base.length-1;i++){
                        const a=base[i], b=base[i+1];
                        if((a.x<=tx&&tx<=b.x)||(b.x<=tx&&tx<=a.x)){
                          const t=(tx-a.x)/((b.x-a.x)||1e-12); return a.y + t*(b.y-a.y);
                        }
                      }
                      return NaN;
                    };
                    const yb = interp(lifeCheckT); if (!isFinite(yb)) return 't 범위를 벗어났습니다.';
                    const inputY = lifeCheckI*lifeCheckI*lifeCheckT;
                    const table = lifetimeCycles
                      .map((cy, idx) => ({
                        N: cy,
                        enabled: selectedLifetimeCycles.has(cy),
                        y: yb * (lifetimeMode==='I_mode' ? Math.pow(currentMultipliers[idx]??1,2) : (lifetimeRatios[idx]??1))
                      }))
                      .filter(r=>r.enabled)
                      // 보간은 같은 t에서의 I²t(y) 축으로 이웃을 잡아야 정확함 → y로 정렬
                      .sort((a,b)=>a.y-b.y);
                    if (table.length === 0) return '선택된 수명 곡선이 없습니다.';

                    let Nest: number | null = null;
                    if (inputY <= table[0].y) {
                      Nest = table[0].N;
                    } else if (inputY >= table[table.length-1].y) {
                      Nest = table[table.length-1].N;
                    } else {
                      for (let i=0;i<table.length-1;i++){
                        const a = table[i], b = table[i+1];
                        if (a.y <= inputY && inputY <= b.y) {
                          const f = (inputY - a.y) / ((b.y - a.y) || 1e-12);
                          Nest = a.N + f * (b.N - a.N);
                          break;
                        }
                      }
                    }
                    const hint = (Nest!=null && Nest>=10000 && Nest<=100000) ? ' (1만~10만 회 구간, 보간값)' : '';
                    return Nest!=null ? `추정 만족 수명: N≈${Math.round(Nest).toLocaleString()}회${hint}` : '보간에 실패했습니다.';
                  })()}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* (삭제됨) 기존 하단 좌표 패널 대체 완료 */}
      </main>

      {toast && <div className="fixed bottom-6 right-6 rounded-xl bg-gray-900 px-5 py-3 text-lg text-white shadow-lg">{toast.msg}</div>}
    </div>
  );
}
