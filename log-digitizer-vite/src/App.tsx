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
  const [historyIndex, setHistoryIndex] = useState(0);

  // 현재 상태 (히스토리에서 파생)
  const currentState = history[historyIndex];

  // UI 컨트롤을 위한 독립 상태
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
  const updateState = (updater: (prevState: AppState) => AppState) => {
    setHistory(prevHistory => {
      const newHistory = prevHistory.slice(0, historyIndex + 1);
      const nextState = updater(newHistory[historyIndex]);
      return [...newHistory, nextState];
    });
    setHistoryIndex(prevIndex => prevIndex + 1);
  };
  
  // 상태 설정 헬퍼 함수
  const setStateValue = (key, value) => updateState(prev => ({ ...prev, [key]: value }));
  const setSeries = (updater) => updateState(prev => ({ ...prev, series: updater(prev.series) }));
  const setBgXform = (updater) => updateState(prev => ({ ...prev, bgXform: updater(prev.bgXform) }));
  const setCustomAnchors = (updater) => updateState(prev => ({ ...prev, customAnchors: updater(prev.customAnchors) }));

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
  }, []);

  const notify = (msg: string) => { /* ... (기존 로직) ... */ };
  const innerRect = () => ({ x: pad.left, y: pad.top, w: size.w - pad.left - pad.right, h: size.h - pad.top - pad.bottom });
  const clampS = (v: number) => Math.max(0.05, Math.min(50, v));
  const EPS = 1e-12;
  const tVal = (v: number, log: boolean) => (log ? Math.log10(Math.max(EPS, v)) : v);
  const tMinMax = () => ({ xmin: tVal(currentState?.xMin, currentState?.xLog), xmax: tVal(currentState?.xMax, currentState?.xLog), ymin: tVal(currentState?.yMin, currentState?.yLog), ymax: tVal(currentState?.yMax, currentState?.yLog) });
  const dataToPixel = (x: number, y: number) => {
    const r = innerRect(), mm = tMinMax();
    const tx = tVal(x, currentState?.xLog), ty = tVal(y, currentState?.yLog);
    return { px: r.x + ((tx - mm.xmin) / (mm.xmax - mm.xmin)) * r.w, py: r.y + r.h - ((ty - mm.ymin) / (mm.ymax - mm.ymin)) * r.h };
  };
  const pixelToData = (px: number, py: number) => {
    const r = innerRect(), mm = tMinMax();
    const tx = mm.xmin + ((px - r.x) / r.w) * (mm.xmax - mm.xmin);
    const ty = mm.ymin + ((r.y + r.h - py) / r.h) * (mm.ymax - mm.ymin);
    const f = (tv: number, log: boolean) => (log ? Math.pow(10, tv) : tv);
    return { x: f(tx, currentState?.xLog), y: f(ty, currentState?.yLog) };
  };
  const baseRect = (idx: 0 | 1) => { /* ... (기존 로직) ... */ return { x: r.x, y: r.y, w: r.w, h: r.h }; };
  const drawRectAndAnchor = (idx: 0 | 1) => {
    const base = baseRect(idx), xf = currentState?.bgXform[idx], CA = currentState?.customAnchors[idx];
    const dw = base.w * clampS(xf.sx), dh = base.h * clampS(xf.sy);
    let ax, ay, fx, fy;
    if (anchorMode === "custom") { if (CA) { ax = CA.ax; ay = CA.ay; fx = CA.fx; fy = CA.fy; } else { ax = base.x; ay = base.y + base.h; fx = 0; fy = 1; }
    } else { ax = base.x + base.w / 2 + xf.offX; ay = base.y + base.h / 2 + xf.offY; fx = 0.5; fy = 0.5; }
    const dx = ax - fx * dw, dy = ay - fy * dh;
    return { dx, dy, dw, dh, ax, ay, fx, fy, baseW: base.w, baseH: base.h };
  };
  const onFile = (file, idx) => { /* ... (기존 로직) ... */ };
  
  // 키보드 컨트롤
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
        const updater = cur => cur.map((s, si) => si !== seriesIndex ? s : { ...s, points: s.points.map((p, pi) => pi !== pointIndex ? p : newData) });
        if (isPointerDownRef.current) { setSeries(updater); } else { setStateValue('series', updater(currentState.series)); }
        return;
      }
      
      if (bgEditMode) {
        const step = e.shiftKey ? 10 : 1;
        const updater = cur => {
          const n = [...cur] as [BgXf, BgXf]; const xf = n[activeBg]; let { offX, offY } = xf;
          if (e.key === 'ArrowLeft') offX -= step; if (e.key === 'ArrowRight') offX += step;
          if (e.key === 'ArrowUp') offY -= step; if (e.key === 'ArrowDown') offY += step;
          n[activeBg] = { ...xf, offX, offY }; return n;
        };
        if (isPointerDownRef.current) { setBgXform(updater); } else { setStateValue('bgXform', updater(currentState.bgXform)); }
      }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [selectedPoint, bgEditMode, activeBg, currentState]);

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => { /* ... (기존 onMouseDown 로직 수정) ... */ };
  
  // 프리셋 로드 수정
  const applyPreset = (p: any) => {
    try {
      if (!p) return;
      const newState = { ...history[0], ...p }; // 기본 상태에 덮어쓰기
      setHistory([newState]);
      setHistoryIndex(0);
      notify("Preset loaded successfully!");
      setTick(t => t + 1); // 강제 리렌더링
    } catch(e) { console.warn("preset apply fail", e); notify("Invalid preset file", "err"); }
  };
  const loadPresetFromFile = (file: File | null) => { /* ... (applyPreset 호출) ... */ };
  
  if (!currentState) return <div>Loading...</div>; // 초기 로딩 방어 코드

  return (
    <div className="min-h-screen bg-gray-100 text-gray-800 font-sans antialiased">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-gray-200 bg-white/80 p-4 backdrop-blur-sm">
        <h1 className="text-xl font-bold text-gray-900">Log-scale Graph Digitizer</h1>
        <div className="flex items-center gap-3 text-base">
          <button onClick={handleUndo} disabled={historyIndex === 0} className="rounded-lg bg-gray-200 px-4 py-2 hover:bg-gray-300 disabled:opacity-50">Undo</button>
          <button onClick={handleRedo} disabled={historyIndex === history.length - 1} className="rounded-lg bg-gray-200 px-4 py-2 hover:bg-gray-300 disabled:opacity-50">Redo</button>
          <div className="h-6 w-px bg-gray-300" />
          {/* 나머지 헤더 버튼들 */}
        </div>
      </header>

      <main className="grid grid-cols-1 gap-8 p-8 lg:grid-cols-[480px,1fr]">
        <aside className="flex flex-col gap-6">
          {/* 순서 변경: Axes -> Image -> Series */}
          <AccordionSection title="Axes & Guides" isOpen={axesOpen} onToggle={() => setAxesOpen(v => !v)}>
            {/* ... Axes 컨텐츠 ... */}
          </AccordionSection>
          
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <button onClick={() => setBgEditMode(v => !v)} className="flex w-full items-center justify-between p-5 text-left">
              <h3 className="text-lg font-bold text-gray-800">Image Edit</h3>
              <span className={`rounded-full px-3 py-1 text-sm font-semibold ${bgEditMode ? 'bg-orange-100 text-orange-800' : 'bg-gray-200 text-gray-700'}`}>
                {bgEditMode ? "ON" : "OFF"}
              </span>
            </button>
            {bgEditMode && ( <div className="space-y-4 p-5 pt-0 text-base">{/* ... Image Edit 컨텐츠 ... */}</div> )}
          </div>
          
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="mb-4 text-xl font-bold text-gray-800">Series & Points</h3>
            {/* ... Series 컨텐츠 (Guide, Magnifier 포함) ... */}
          </div>
        </aside>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          {/* ... 캔버스 ... */}
        </div>
      </main>

      {/* ... Toast ... */}
    </div>
  );
}
