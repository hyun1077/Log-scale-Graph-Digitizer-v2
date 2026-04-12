/* @ts-nocheck */
import { Fragment, useEffect, useRef, useState } from "react";
import { type Sample } from "./lib/i2t";

/**
 * Log-scale Graph Digitizer
 * v5.1 - images x5, series x5, intersections, min-break dashed lines
 */

const MAX_BG = 5;
const MAX_SERIES = 5;
const SERIES_COLORS = ["#2563EB", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6"];
const SERIES_NAMES  = ["A", "B", "C", "D", "E"];
const BG_LABELS     = ["A", "B", "C", "D", "E"];
const BG_DEFAULT_OPACITY = [1, 0.7, 0.6, 0.5, 0.4];

type Pt = { x: number; y: number };
type Series = { name: string; color: string; points: Pt[] };
type Handle = "none" | "left" | "right" | "top" | "bottom" | "uniform";
type BgXf = { sx: number; sy: number; offX: number; offY: number };
type CustomAnchor = { ax: number; ay: number; fx: number; fy: number } | null;
type SelectedPoint = { seriesIndex: number; pointIndex: number } | null;
type CalPickKey = "x1" | "x2" | "y1" | "y2" | null;
type CalPixel = { px: number; py: number } | null;
type CalPixels = { x1: CalPixel; x2: CalPixel; y1: CalPixel; y2: CalPixel };
type CalValues = { x1: string; x2: string; y1: string; y2: string };

type AppState = {
  xMin: number; xMax: number; yMin: number; yMax: number;
  xLog: boolean; yLog: boolean;
  series: Series[];
  bgXform: BgXf[];
  customAnchors: (CustomAnchor | null)[];
};

const AccordionSection = ({ title, children, isOpen, onToggle }) => (
  <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
    <button onClick={onToggle} className="flex w-full items-center justify-between p-2 text-left">
      <h3 className="text-xs font-bold text-gray-800">{title}</h3>
      <span className={`transform text-gray-500 transition-transform duration-200 text-xs ${isOpen ? "rotate-180" : ""}`}>v</span>
    </button>
    {isOpen && <div className="space-y-2 p-2 pt-0 text-xs">{children}</div>}
  </div>
);

export default function App() {
  const canvasRef  = useRef(null);
  const fileRefs   = useRef(Array(MAX_BG).fill(null));
  const presetFileRef = useRef(null);

  const bgRefs = useRef(Array(MAX_BG).fill(null));
  const bgUrls = useRef(Array(MAX_BG).fill(null));
  const lastRectRef = useRef(null);
  const hoverRef    = useRef({ x: null, y: null });

  const [size] = useState({ w: 960, h: 560 });
  const [pad]  = useState({ left: 60, right: 20, top: 30, bottom: 46 });
  const [axesOpen, setAxesOpen] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  /* I2t graph */
  const i2tCanvasRef = useRef(null);
  const [showI2tGraph, setShowI2tGraph] = useState(true);
  const [lifetimeMode, setLifetimeMode] = useState("I_mode");
  const [lifetimeCycles, setLifetimeCycles] = useState([1,10,100,1000,10000,100000,1000000]);
  const [currentMultipliers, setCurrentMultipliers] = useState([3.15,2.80,2.55,2.06,1.70,1.00,0.70]);
  const [lifetimeRatios, setLifetimeRatios] = useState([1.000,0.907,0.826,0.713,0.551,0.356,0.227]);
  const [loggedInUser, setLoggedInUser] = useState<string|null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginUserInput, setLoginUserInput] = useState("");
  const [loginPwInput, setLoginPwInput] = useState("");
  const [loginError, setLoginError] = useState(false);
  const [selectedLifetimeCycles, setSelectedLifetimeCycles] = useState(new Set([1,10,100,1000,10000,100000,1000000]));
  const [showRealCoords, setShowRealCoords] = useState(true);
  const [calEnabledByBg, setCalEnabledByBg] = useState(Array(MAX_BG).fill(false));
  const [calClipByBg, setCalClipByBg] = useState(Array(MAX_BG).fill(false));
  const [calPixelsByBg, setCalPixelsByBg] = useState<CalPixels[]>(Array(MAX_BG).fill(null).map(() => ({ x1: null, x2: null, y1: null, y2: null })));
  const [calValuesByBg, setCalValuesByBg] = useState<CalValues[]>(Array(MAX_BG).fill(null).map(() => ({ x1: "", x2: "", y1: "", y2: "" })));
  const [calPick, setCalPick] = useState<CalPickKey>(null);
  const [selectedCalPoint, setSelectedCalPoint] = useState<CalPickKey>(null);
  const LIFE_CURRENT_BASE = 3050;
  const [lifeCheckI, setLifeCheckI] = useState(0);
  const [lifeCheckT, setLifeCheckT] = useState(0);
  const [lifeIInput, setLifeIInput] = useState("");
  const [lifeTInput, setLifeTInput] = useState("");
  const [enterCurrents, setEnterCurrents] = useState(false);
  const [multiplierInputs, setMultiplierInputs] = useState({});
  const [currentInputs, setCurrentInputs] = useState({});
  const [i2tFixedRange, setI2tFixedRange] = useState(true);

  useEffect(() => { if (showI2tGraph) setSidebarCollapsed(true); }, [showI2tGraph]);
  useEffect(() => {
    const cur = Array.from(selectedLifetimeCycles);
    const valid = cur.filter(c => lifetimeCycles.includes(c));
    if (valid.length === 0 || valid.length !== cur.length) setSelectedLifetimeCycles(new Set(lifetimeCycles));
  }, [lifetimeCycles]);

  const [activeSeries, setActiveSeries] = useState(0);
  const [selectedPoint, setSelectedPoint] = useState(null);

  const [connectLines, setConnectLines] = useState(true);
  const [lineWidth, setLineWidth] = useState(1.6);
  const [lineAlpha, setLineAlpha] = useState(0.9);
  const [smoothLines, setSmoothLines] = useState(true);
  const [smoothAlpha, setSmoothAlpha] = useState(0.35);
  const [ptRadius, setPtRadius] = useState(5);
  const [showPoints, setShowPoints] = useState(true);

  /* min break currents - per series, dashes line below threshold */
  const [minBreakCurrents, setMinBreakCurrents] = useState(() => Array(MAX_SERIES).fill(null));
  const [minBreakInputs, setMinBreakInputs] = useState({});

  /* spreadsheet table edit state */
  const [rawEdits, setRawEdits] = useState<Record<string,string>>({});
  const [newPtX, setNewPtX] = useState("");
  const [newPtY, setNewPtY] = useState("");
  const [pasteText, setPasteText] = useState('');

  /* product library */
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryItems, setLibraryItems] = useState([]);
  const [serverAvail, setServerAvail] = useState(false);
  const [saveFormCompany, setSaveFormCompany] = useState('');
  const [saveFormName, setSaveFormName] = useState('');
  const [libFilter, setLibFilter] = useState('');

  const [magnifyOn, setMagnifyOn] = useState(false);
  const [magnifyFactor] = useState(3);

  const [bgList, setBgList] = useState(Array(MAX_BG).fill(null));
  const [keepAspect, setKeepAspect] = useState(false);
  const [showBgs, setShowBgs] = useState(Array(MAX_BG).fill(true));
  const [opacityBgs, setOpacityBgs] = useState([...BG_DEFAULT_OPACITY]);
  const [activeBg, setActiveBg] = useState(0);
  const calEnabled = calEnabledByBg[activeBg];
  const calClip = calClipByBg[activeBg];
  const calPixels = calPixelsByBg[activeBg];
  const calValues = calValuesByBg[activeBg];

  const [anchorMode] = useState("custom");
  const [pickAnchor, setPickAnchor] = useState(false);
  const [bgEditMode, setBgEditMode] = useState(false);
  const [hoverHandle, setHoverHandle] = useState("none");

  const dragRef   = useRef({ active: false, startX: 0, startY: 0, baseX: 0, baseY: 0 });
  const resizeRef = useRef({ active: false, mode: "none", ax: 0, ay: 0, fx: 0.5, fy: 0.5, baseW: 1, baseH: 1 });
  const moveRafRef = useRef(null);
  const latestMouse = useRef({ clientX: 0, clientY: 0 });
  const snapPreviewRef = useRef(null); // {px,py} snapped grid point for anchor pick preview

  const [toast, setToast] = useState(null);
  const [tick, setTick] = useState(0);

  /* Guides */
  const [guideXs, setGuideXs] = useState([]);
  const [guideInput, setGuideInput] = useState("");
  const [guideYs, setGuideYs] = useState([]);
  const [guideYInput, setGuideYInput] = useState("");
  const [showCrossFromX, setShowCrossFromX] = useState(true);
  const [showCrossFromY, setShowCrossFromY] = useState(true);
  const [guideXLabels, setGuideXLabels] = useState({});
  const [guideYLabels, setGuideYLabels] = useState({});

  /* Undo / Redo */
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const currentState = history[historyIndex];

  const updateState = (updater, overwrite = false) => {
    setHistory(prev => {
      const base = overwrite ? [] : prev.slice(0, historyIndex + 1);
      const next = updater(base[base.length - 1] || prev[0]);
      return [...base, next];
    });
    setHistoryIndex(i => (overwrite ? 0 : i + 1));
  };
  /* replace current history entry in-place (no new undo step) ? used during continuous drag/resize */
  const updateStateInPlace = updater => {
    setHistory(prev => prev.map((entry, i) => i === historyIndex ? updater(entry) : entry));
  };
  const handleUndo = () => historyIndex > 0 && setHistoryIndex(historyIndex - 1);
  const handleRedo = () => historyIndex < history.length - 1 && setHistoryIndex(historyIndex + 1);

  /* init */
  useEffect(() => {
    const init = {
      xMin: 10, xMax: 1000000, yMin: 0.0001, yMax: 1000000,
      xLog: true, yLog: true,
      series: [
        { name: "A", color: SERIES_COLORS[0], points: [] },
        { name: "B", color: SERIES_COLORS[1], points: [] },
      ],
      bgXform:       Array(MAX_BG).fill(null).map(() => ({ sx: 1, sy: 1, offX: 0, offY: 0 })),
      customAnchors: Array(MAX_BG).fill(null),
    };
    setHistory([init]); setHistoryIndex(0);
  }, []);

  /* utils */
  const notifyTimerRef = useRef<number | null>(null);
  const notify = (msg, kind = "ok") => {
    setToast({ msg, kind });
    if (notifyTimerRef.current) window.clearTimeout(notifyTimerRef.current);
    notifyTimerRef.current = window.setTimeout(() => setToast(null), 1500);
  };

  const innerRect = () => ({ x: pad.left, y: pad.top, w: size.w - pad.left - pad.right, h: size.h - pad.top - pad.bottom });
  const clampS = v => Math.max(0.05, Math.min(50, v));
  const EPS = 1e-12;
  const tVal = (v, log) => log ? Math.log10(Math.max(EPS, v)) : v;
  const tMinMax = () => ({
    xmin: tVal(currentState.xMin, currentState.xLog),
    xmax: tVal(currentState.xMax, currentState.xLog),
    ymin: tVal(currentState.yMin, currentState.yLog),
    ymax: tVal(currentState.yMax, currentState.yLog),
  });

  const calModel = () => {
    if (!calEnabled) return null;
    const x1 = calPixels.x1, x2 = calPixels.x2, y1 = calPixels.y1, y2 = calPixels.y2;
    if (!x1 || !x2 || !y1 || !y2) return null;
    const vx1 = Number(calValues.x1), vx2 = Number(calValues.x2), vy1 = Number(calValues.y1), vy2 = Number(calValues.y2);
    if (![vx1, vx2, vy1, vy2].every(Number.isFinite)) return null;
    if ((currentState.xLog && (vx1 <= 0 || vx2 <= 0)) || (currentState.yLog && (vy1 <= 0 || vy2 <= 0))) return null;
    const tx1 = tVal(vx1, currentState.xLog), tx2 = tVal(vx2, currentState.xLog);
    const ty1 = tVal(vy1, currentState.yLog), ty2 = tVal(vy2, currentState.yLog);
    if (Math.abs(tx2 - tx1) < EPS || Math.abs(ty2 - ty1) < EPS) return null;
    if (Math.abs(x2.px - x1.px) < EPS || Math.abs(y2.py - y1.py) < EPS) return null;
    return { tx1, tx2, ty1, ty2, px1: x1.px, px2: x2.px, py1: y1.py, py2: y2.py };
  };
  const dataToPixel = (x, y) => {
    const tx = tVal(x, currentState.xLog), ty = tVal(y, currentState.yLog);
    const cm = calModel();
    if (cm) {
      return {
        px: cm.px1 + ((tx - cm.tx1) / (cm.tx2 - cm.tx1)) * (cm.px2 - cm.px1),
        py: cm.py1 + ((ty - cm.ty1) / (cm.ty2 - cm.ty1)) * (cm.py2 - cm.py1),
      };
    }
    const r = innerRect(), mm = tMinMax();
    return { px: r.x + ((tx - mm.xmin) / (mm.xmax - mm.xmin)) * r.w,
             py: r.y + r.h - ((ty - mm.ymin) / (mm.ymax - mm.ymin)) * r.h };
  };
  const pixelToData = (px, py) => {
    const inv = (tv, log) => log ? Math.pow(10, tv) : tv;
    const cm = calModel();
    if (cm) {
      const tx = cm.tx1 + ((px - cm.px1) / (cm.px2 - cm.px1)) * (cm.tx2 - cm.tx1);
      const ty = cm.ty1 + ((py - cm.py1) / (cm.py2 - cm.py1)) * (cm.ty2 - cm.ty1);
      return { x: inv(tx, currentState.xLog), y: inv(ty, currentState.yLog) };
    }
    const r = innerRect(), mm = tMinMax();
    const tx = mm.xmin + ((px - r.x) / r.w) * (mm.xmax - mm.xmin);
    const ty = mm.ymin + ((r.y + r.h - py) / r.h) * (mm.ymax - mm.ymin);
    return { x: inv(tx, currentState.xLog), y: inv(ty, currentState.yLog) };
  };
  const fmtReal = v => {
    if (v == null || !isFinite(v)) return "-";
    const a = Math.abs(v);
    const s = a >= 1e6 || a < 1e-4 ? Number(v).toPrecision(6) : Number(v).toLocaleString(undefined, { maximumFractionDigits: 6 });
    return s.replace(/\.?0+$/, "");
  };
  const setCalEnabledForBg = (idx, enabled) => setCalEnabledByBg(prev => { const n=[...prev]; n[idx]=enabled; return n; });
  const setCalClipForBg = (idx, clip) => setCalClipByBg(prev => { const n=[...prev]; n[idx]=clip; return n; });
  const setCalPixelsForBg = (idx, updater) => setCalPixelsByBg(prev => { const n=[...prev]; n[idx]=typeof updater==="function" ? updater(n[idx]) : updater; return n; });
  const setCalValuesForBg = (idx, updater) => setCalValuesByBg(prev => { const n=[...prev]; n[idx]=typeof updater==="function" ? updater(n[idx]) : updater; return n; });

  /* image base/anchor */
  const baseRect = idx => {
    const r = innerRect(), meta = bgList[idx];
    if (!meta || !keepAspect) return { x: r.x, y: r.y, w: r.w, h: r.h };
    const s = Math.min(r.w / meta.w, r.h / meta.h);
    const w = meta.w * s, h = meta.h * s, x = r.x + (r.w - w) / 2, y = r.y + (r.h - h) / 2;
    return { x, y, w, h };
  };
  const drawRectAndAnchor = idx => {
    const base = baseRect(idx), xf = currentState.bgXform[idx], CA = currentState.customAnchors[idx];
    const dw = base.w * clampS(xf.sx), dh = base.h * clampS(xf.sy);
    let ax, ay, fx, fy;
    if (anchorMode === "custom") {
      const dax = CA ? CA.ax : base.x; const day = CA ? CA.ay : base.y + base.h;
      ax = dax + xf.offX; ay = day + xf.offY; fx = CA ? CA.fx : 0; fy = CA ? CA.fy : 1;
    } else {
      ax = base.x + base.w / 2 + xf.offX; ay = base.y + base.h / 2 + xf.offY; fx = 0.5; fy = 0.5;
    }
    const dx = ax - fx * dw, dy = ay - fy * dh;
    return { dx, dy, dw, dh, ax, ay, fx, fy, baseW: base.w, baseH: base.h };
  };

  /** 캘리브로 찍은 이미지 위 점을 Axes 패널의 격자(축 한계) 좌표계에 맞게 배경 스케일·이동 + 캘리브 픽셀 동기화 */
  const fitImageToAxesCalibration = bgIdx => {
    const st = currentState;
    if (!st) return;
    const img = bgRefs.current[bgIdx];
    if (!img || !bgList[bgIdx]) {
      notify('이 슬롯에 이미지를 먼저 불러오세요', 'err');
      return;
    }
    const cp = calPixelsByBg[bgIdx];
    const cv = calValuesByBg[bgIdx];
    const vx1 = Number(cv.x1), vx2 = Number(cv.x2), vy1 = Number(cv.y1), vy2 = Number(cv.y2);
    if (!cp?.x1 || !cp?.x2 || !cp?.y1 || !cp?.y2 || ![vx1, vx2, vy1, vy2].every(Number.isFinite)) {
      notify('캘리브 4점을 찍고 숫자 값을 모두 입력하세요', 'err');
      return;
    }
    if ((st.xLog && (vx1 <= 0 || vx2 <= 0)) || (st.yLog && (vy1 <= 0 || vy2 <= 0))) {
      notify('로그 축에는 양수 값만 사용할 수 있습니다', 'err');
      return;
    }
    const { dx, dy, dw, dh } = drawRectAndAnchor(bgIdx);
    if (Math.abs(dw) < EPS || Math.abs(dh) < EPS) {
      notify('이미지 표시 크기가 너무 작습니다', 'err');
      return;
    }
    const fu1 = (cp.x1.px - dx) / dw;
    const fu2 = (cp.x2.px - dx) / dw;
    const fv1 = (cp.y1.py - dy) / dh;
    const fv2 = (cp.y2.py - dy) / dh;
    if (Math.abs(fu2 - fu1) < 1e-5 || Math.abs(fv2 - fv1) < 1e-5) {
      notify('X1·X2 또는 Y1·Y2가 이미지에서 너무 가깝습니다', 'err');
      return;
    }

    const r = innerRect();
    const mm = {
      xmin: tVal(st.xMin, st.xLog),
      xmax: tVal(st.xMax, st.xLog),
      ymin: tVal(st.yMin, st.yLog),
      ymax: tVal(st.yMax, st.yLog),
    };
    if (!(mm.xmax > mm.xmin && mm.ymax > mm.ymin)) {
      notify('Axes 축 범위(X/Y Min·Max)를 확인하세요', 'err');
      return;
    }
    const pxAt = tx => r.x + ((tx - mm.xmin) / (mm.xmax - mm.xmin)) * r.w;
    const pyAt = ty => r.y + r.h - ((ty - mm.ymin) / (mm.ymax - mm.ymin)) * r.h;
    const tx1 = tVal(vx1, st.xLog), tx2 = tVal(vx2, st.xLog);
    const ty1 = tVal(vy1, st.yLog), ty2 = tVal(vy2, st.yLog);
    const pxT1 = pxAt(tx1), pxT2 = pxAt(tx2);
    const pyT1 = pyAt(ty1), pyT2 = pyAt(ty2);

    const dwNew = (pxT2 - pxT1) / (fu2 - fu1);
    const dxNew = pxT1 - fu1 * dwNew;
    const dhNew = (pyT2 - pyT1) / (fv2 - fv1);
    const dyNew = pyT1 - fv1 * dhNew;

    if (!Number.isFinite(dwNew) || !Number.isFinite(dhNew) || dwNew <= 1 || dhNew <= 1) {
      notify('맞춤 계산에 실패했습니다. 점 위치와 축 값이 서로 맞는지 확인하세요', 'err');
      return;
    }
    if (dwNew < 0 || dhNew < 0) {
      notify('X1이 X2보다 작은 데이터(왼쪽)·Y 방향이 화면과 일치하는지 확인하세요', 'err');
      return;
    }

    const base = baseRect(bgIdx);
    const sx = clampS(dwNew / base.w);
    const sy = clampS(dhNew / base.h);
    const dwAdj = base.w * sx;
    const dhAdj = base.h * sy;
    const dxAdj = pxT1 - fu1 * dwAdj;
    const dyAdj = pyT1 - fv1 * dhAdj;

    const CA = st.customAnchors[bgIdx];
    let offX, offY;
    if (anchorMode === 'custom') {
      const dax = CA ? CA.ax : base.x;
      const day = CA ? CA.ay : base.y + base.h;
      const fx = CA ? CA.fx : 0;
      const fy = CA ? CA.fy : 1;
      offX = dxAdj - dax + fx * dwAdj;
      offY = dyAdj - day + fy * dhAdj;
    } else {
      offX = dxAdj - base.x - base.w / 2 + 0.5 * dwAdj;
      offY = dyAdj - base.y - base.h / 2 + 0.5 * dhAdj;
    }

    const remap = pt => {
      if (!pt) return null;
      const fu = (pt.px - dx) / dw;
      const fv = (pt.py - dy) / dh;
      return { px: dxAdj + fu * dwAdj, py: dyAdj + fv * dhAdj };
    };

    updateState(prev => {
      const nxf = [...prev.bgXform];
      const cur = nxf[bgIdx] || { sx: 1, sy: 1, offX: 0, offY: 0 };
      nxf[bgIdx] = { ...cur, sx, sy, offX, offY };
      return { ...prev, bgXform: nxf };
    });
    setCalPixelsForBg(bgIdx, {
      x1: remap(cp.x1),
      x2: remap(cp.x2),
      y1: remap(cp.y1),
      y2: remap(cp.y2),
    });
    setTick(t => t + 1);
    notify('Axes 격자에 이미지·캘리브 점을 맞췄습니다');
  };

  /* image load — 파일·캡처·URL 등 data URL / blob URL 공통 */
  const loadImageFromSrc = (idx, src) => {
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => {
      bgRefs.current[idx] = img; bgUrls.current[idx] = src;
      setBgList(cur => { const n = [...cur]; n[idx] = { w: img.width, h: img.height }; return n; });
    };
    img.onerror = () => notify("Image load failed", "err");
    img.src = src;
  };

  const onFile = (file, idx) => {
    if (!file || !/^image\//.test(file.type)) { notify("Image files only", "err"); return; }
    const fr = new FileReader();
    fr.onload = () => loadImageFromSrc(idx, String(fr.result || ""));
    fr.onerror = () => { try { loadImageFromSrc(idx, URL.createObjectURL(file)); } catch { notify("Image load failed", "err"); } };
    fr.readAsDataURL(file);
  };

  /** 화면/창/탭 공유(getDisplayMedia)로 한 장 캡처 후 현재 이미지 슬롯에 넣기 */
  const captureScreenToSlot = async idx => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      notify("이 환경에서는 화면 캡처 API를 쓸 수 없습니다(HTTPS 또는 localhost 필요)", "err");
      return;
    }
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    } catch (e) {
      const name = e && e.name;
      if (name === "NotAllowedError" || name === "PermissionDeniedError") notify("화면 공유가 취소되었습니다", "err");
      else notify("화면 캡처를 시작할 수 없습니다", "err");
      return;
    }
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach(t => t.stop());
      notify("비디오 트랙이 없습니다", "err");
      return;
    }
    const video = document.createElement("video");
    video.playsInline = true;
    video.muted = true;
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      stream.getTracks().forEach(t => t.stop());
      notify("영상 재생에 실패했습니다", "err");
      return;
    }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    let w = video.videoWidth, h = video.videoHeight;
    if (w < 2 || h < 2) {
      stream.getTracks().forEach(t => t.stop());
      video.srcObject = null;
      notify("화면 크기를 읽을 수 없습니다. 다시 시도해 주세요", "err");
      return;
    }
    const MAX = 4096;
    if (w > MAX || h > MAX) {
      const s = Math.min(MAX / w, MAX / h);
      w = Math.max(2, Math.floor(w * s));
      h = Math.max(2, Math.floor(h * s));
    }
    const cap = document.createElement("canvas");
    cap.width = w; cap.height = h;
    const ctx = cap.getContext("2d");
    if (!ctx) {
      stream.getTracks().forEach(t => t.stop());
      video.srcObject = null;
      notify("캔버스를 만들 수 없습니다", "err");
      return;
    }
    try {
      ctx.drawImage(video, 0, 0, w, h);
    } catch {
      stream.getTracks().forEach(t => t.stop());
      video.srcObject = null;
      notify("그리기에 실패했습니다(캔버스 한도 등)", "err");
      return;
    }
    stream.getTracks().forEach(t => t.stop());
    video.srcObject = null;
    let dataUrl = "";
    try {
      dataUrl = cap.toDataURL("image/png");
    } catch {
      notify("이미지로 변환하지 못했습니다", "err");
      return;
    }
    if (!dataUrl || dataUrl.length < 32) {
      notify("캡처 데이터가 비었습니다", "err");
      return;
    }
    loadImageFromSrc(idx, dataUrl);
    notify(`화면 캡처 반영 (${w}×${h})`);
  };

  useEffect(() => {
    const onPaste = e => {
      /* textarea/input 포커스 중엔 기본 동작 유지 */
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "textarea" || tag === "input") return;

      const items = e.clipboardData?.items || [];

      /* 이미지 우선 처리 */
      for (let i = 0; i < items.length; i++) {
        if (items[i].type?.startsWith("image/")) { const f = items[i].getAsFile(); if (f) { onFile(f, activeBg); return; } }
      }

      /* 텍스트(엑셀 복사 등) 처리 */
      const text = e.clipboardData?.getData("text") || "";
      if (!text.trim()) return;
      const lines = text.trim().split(/\r?\n/);
      const pts = [];
      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.split(/\t|,|;/).map(s => s.trim().replace(/,/g, ""));
        if (parts.length < 2) continue;
        const x = Number(parts[0]), y = Number(parts[1]);
        if (!isFinite(x) || !isFinite(y) || x <= 0 || y <= 0) continue;
        pts.push({ x, y });
      }
      if (pts.length === 0) return;
      e.preventDefault();
      pts.sort((a, b) => a.x - b.x);
      updateState(prev => ({
        ...prev,
        series: prev.series.map((s, i) =>
          i !== activeSeries ? s : { ...s, points: [...s.points, ...pts].sort((a, b) => a.x - b.x) }
        ),
      }));
      notify(`${pts.length}개 포인트 추가됨 (시리즈 ${currentState.series[activeSeries]?.name})`);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [activeBg, activeSeries, currentState]);




  /* keyboard */
  useEffect(() => {
    const onKey = e => {
      if (e.key === "Escape") { setPickAnchor(false); setSelectedPoint(null); setCalPick(null); setSelectedCalPoint(null); }
      const arrows = ["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"];
      if (!arrows.includes(e.key)) return;
      e.preventDefault();
      if (selectedPoint) {
        const { seriesIndex, pointIndex } = selectedPoint;
        const pt = currentState.series[seriesIndex].points[pointIndex];
        const { px, py } = dataToPixel(pt.x, pt.y);
        const step = e.shiftKey ? 10 : 1;
        let nx = px, ny = py;
        if (e.key === "ArrowLeft") nx -= step; if (e.key === "ArrowRight") nx += step;
        if (e.key === "ArrowUp") ny -= step;   if (e.key === "ArrowDown") ny += step;
        const nd = pixelToData(nx, ny);
        updateState(prev => ({ ...prev, series: prev.series.map((s, si) => si !== seriesIndex ? s : { ...s, points: s.points.map((p, pi) => pi === pointIndex ? nd : p) }) }));
        return;
      }
      if (selectedCalPoint) {
        const p = calPixels[selectedCalPoint];
        if (!p) return;
        const step = e.shiftKey ? 10 : 1;
        let nx = p.px, ny = p.py;
        if (e.key === "ArrowLeft") nx -= step; if (e.key === "ArrowRight") nx += step;
        if (e.key === "ArrowUp") ny -= step;   if (e.key === "ArrowDown") ny += step;
        setCalPixelsForBg(activeBg, prev => ({ ...prev, [selectedCalPoint]: { px: nx, py: ny } }));
        return;
      }
      if (bgEditMode) {
        const step = e.shiftKey ? 10 : 1;
        updateState(prev => {
          const n = [...prev.bgXform]; const xf = n[activeBg];
          n[activeBg] = { ...xf, offX: xf.offX + (e.key==="ArrowLeft"?-step:e.key==="ArrowRight"?step:0), offY: xf.offY + (e.key==="ArrowUp"?-step:e.key==="ArrowDown"?step:0) };
          return { ...prev, bgXform: n };
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedPoint, selectedCalPoint, bgEditMode, activeBg, currentState, calPixels]);

  const cursorForHandle = (handle, bgEdit, picking, calPicking) => {
    if (calPicking) return "crosshair";
    if (picking) return "crosshair"; if (!bgEdit) return "crosshair";
    switch (handle) {
      case "left": case "right": return "ew-resize";
      case "top": case "bottom": return "ns-resize";
      case "uniform": return "nwse-resize";
      default: return "move";
    }
  };

  /* grid helpers */
  const SUPMAP = { "0":"\u2070","1":"\u00B9","2":"\u00B2","3":"\u00B3","4":"\u2074","5":"\u2075","6":"\u2076","7":"\u2077","8":"\u2078","9":"\u2079","-":"\u207B","+":"\u207A",".":"." };
  const sup = s => String(s).split("").map(ch => SUPMAP[ch] ?? ch).join("");
  const pow10Label = n => "10" + sup(n);
  const numFmt = (v, step) => {
    if (!isFinite(v)) return ""; const a = Math.abs(v); if (a === 0) return "0";
    const d = step !== undefined ? Math.max(0, Math.min(6, -Math.floor(Math.log10(Math.max(1e-12, step))))) : Math.max(0, Math.min(6, 3 - Math.floor(Math.log10(Math.max(1e-12, a)))));
    if (a >= 1e5 || a < 1e-3) return v.toExponential(2);
    return v.toFixed(d);
  };

  function drawGrid(ctx) {
    const r = innerRect(), mm = tMinMax();
    if (!isFinite(mm.xmin)||!isFinite(mm.xmax)||!isFinite(mm.ymin)||!isFinite(mm.ymax)||mm.xmax<=mm.xmin||mm.ymax<=mm.ymin) {
      ctx.save(); ctx.fillStyle="#9CA3AF"; ctx.font="12px ui-sans-serif"; ctx.fillText("Invalid axis range",r.x+r.w/2,r.y+r.h/2); ctx.restore(); return;
    }
    ctx.save(); ctx.strokeStyle="#E5E7EB"; ctx.fillStyle="#6B7280"; ctx.lineWidth=1; ctx.font="12px ui-sans-serif";
    if (currentState.xLog) {
      const n0=Math.floor(mm.xmin),n1=Math.ceil(mm.xmax);
      for (let n=n0;n<=n1;n++) {
        const px=dataToPixel(Math.pow(10,n),1).px;
        ctx.beginPath(); ctx.moveTo(px,r.y); ctx.lineTo(px,r.y+r.h); ctx.stroke();
        ctx.textAlign="center"; ctx.fillText(pow10Label(n),px,r.y+r.h+18);
        for (let m=2;m<10;m++) { const v=Math.pow(10,n)*m,lv=Math.log10(v); if(lv>mm.xmax)break; if(lv<mm.xmin)continue; const xm=dataToPixel(v,1).px; ctx.save(); ctx.strokeStyle="#F3F4F6"; ctx.beginPath(); ctx.moveTo(xm,r.y); ctx.lineTo(xm,r.y+r.h); ctx.stroke(); ctx.restore(); }
      }
    } else {
      for (let i=0;i<=10;i++) { const t=i/10,px=r.x+t*r.w; ctx.beginPath(); ctx.moveTo(px,r.y); ctx.lineTo(px,r.y+r.h); ctx.stroke(); ctx.textAlign="center"; ctx.fillText(numFmt(currentState.xMin+t*(currentState.xMax-currentState.xMin),(currentState.xMax-currentState.xMin)/10),px,r.y+r.h+18); }
    }
    if (currentState.yLog) {
      const n0=Math.floor(mm.ymin),n1=Math.ceil(mm.ymax);
      for (let n=n0;n<=n1;n++) {
        const py=dataToPixel(1,Math.pow(10,n)).py;
        ctx.beginPath(); ctx.moveTo(r.x,py); ctx.lineTo(r.x+r.w,py); ctx.stroke();
        ctx.textAlign="right"; ctx.fillText(pow10Label(n),r.x-6,py+4);
        for (let m=2;m<10;m++) { const v=Math.pow(10,n)*m,lv=Math.log10(v); if(lv>mm.ymax)break; if(lv<mm.ymin)continue; const ym=dataToPixel(1,v).py; ctx.save(); ctx.strokeStyle="#F3F4F6"; ctx.beginPath(); ctx.moveTo(r.x,ym); ctx.lineTo(r.x+r.w,ym); ctx.stroke(); ctx.restore(); }
      }
    } else {
      for (let i=0;i<=10;i++) { const t=i/10,py=r.y+(1-t)*r.h,val=currentState.yMin+t*(currentState.yMax-currentState.yMin); ctx.beginPath(); ctx.moveTo(r.x,py); ctx.lineTo(r.x+r.w,py); ctx.stroke(); ctx.textAlign="right"; ctx.fillText(numFmt(val,(currentState.yMax-currentState.yMin)/10),r.x-6,py+4); }
    }
    ctx.restore();
  }

  function catmullRomPath(ctx, pts, alpha = 0.5) {
    if (pts.length < 2) { ctx.moveTo(pts[0].px, pts[0].py); return; }
    ctx.moveTo(pts[0].px, pts[0].py);
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = i===0?pts[0]:pts[i-1], p1=pts[i], p2=pts[i+1], p3=i+2<pts.length?pts[i+2]:pts[pts.length-1];
      const c1x=p1.px+((p2.px-p0.px)/6)*(1-alpha), c1y=p1.py+((p2.py-p0.py)/6)*(1-alpha);
      const c2x=p2.px-((p3.px-p1.px)/6)*(1-alpha), c2y=p2.py-((p3.py-p1.py)/6)*(1-alpha);
      ctx.bezierCurveTo(c1x,c1y,c2x,c2y,p2.px,p2.py);
    }
  }

  /* canvas helpers */
  const canvasPoint = e => { const c=canvasRef.current,rc=c.getBoundingClientRect(); const sx=c.width/rc.width,sy=c.height/rc.height; return { px:(e.clientX-rc.left)*sx, py:(e.clientY-rc.top)*sy }; };
  /* snap a data value to nearest power-of-10 for log axes, else unchanged */
  const snapLogVal = (v, isLog) => { if (!isLog||v<=0) return v; return Math.pow(10, Math.round(Math.log10(v))); };
  const snapToGrid = (px, py) => {
    const d = pixelToData(px, py);
    const sx = snapLogVal(d.x, currentState.xLog), sy = snapLogVal(d.y, currentState.yLog);
    return dataToPixel(sx, sy);
  };
  const inPlot = (px,py) => { const r=innerRect(),T=14; return px>=r.x-T&&px<=r.x+r.w+T&&py>=r.y-T&&py<=r.y+r.h+T; };
  const overImage = (px,py,p=14) => { const lr=lastRectRef.current; if(!lr) return false; return px>=lr.x-p&&px<=lr.x+lr.w+p&&py>=lr.y-p&&py<=lr.y+lr.h+p; };
  const pickHandle = (px,py) => {
    const lr=lastRectRef.current; if(!lr) return "none";
    const H=12, hit=(hx,hy)=>Math.abs(px-hx)<=H&&Math.abs(py-hy)<=H;
    if (hit(lr.x+lr.w,lr.y+lr.h/2)) return "right";
    if (hit(lr.x,lr.y+lr.h/2)) return "left";
    if (hit(lr.x+lr.w/2,lr.y)) return "top";
    if (hit(lr.x+lr.w/2,lr.y+lr.h)) return "bottom";
    if (hit(lr.x+lr.w,lr.y+lr.h)) return "uniform";
    return "none";
  };

  /* guide intersections */
  function yAtX(pts, xTarget) {
    if (!pts||pts.length<2) return null;
    const tx=x=>tVal(x,currentState.xLog), ty=y=>tVal(y,currentState.yLog);
    const invY=tv=>currentState.yLog?Math.pow(10,tv):tv;
    const xT=tx(xTarget);
    for (let i=0;i<pts.length-1;i++) {
      const p1=pts[i],p2=pts[i+1],x1=tx(p1.x),x2=tx(p2.x);
      if ((x1<=xT&&xT<=x2)||(x2<=xT&&xT<=x1)) { const t=(xT-x1)/((x2-x1)||EPS); return invY(ty(p1.y)+t*(ty(p2.y)-ty(p1.y))); }
    }
    return null;
  }
  function xAtY(pts, yTarget) {
    if (!pts||pts.length<2) return null;
    const tx=x=>tVal(x,currentState.xLog), ty=y=>tVal(y,currentState.yLog);
    const invX=tv=>currentState.xLog?Math.pow(10,tv):tv;
    const yT=ty(yTarget);
    for (let i=0;i<pts.length-1;i++) {
      const p1=pts[i],p2=pts[i+1],y1=ty(p1.y),y2=ty(p2.y);
      if ((y1<=yT&&yT<=y2)||(y2<=yT&&yT<=y1)) { const t=(yT-y1)/((y2-y1)||EPS); return invX(tx(p1.x)+t*(tx(p2.x)-tx(p1.x))); }
    }
    return null;
  }

  /* series-to-series intersections */
  function computeSeriesIntersections() {
    if (!currentState) return [];
    const { series } = currentState, results = [];
    const txFn=x=>tVal(x,currentState.xLog), tyFn=y=>tVal(y,currentState.yLog);
    const invX=v=>currentState.xLog?Math.pow(10,v):v, invY=v=>currentState.yLog?Math.pow(10,v):v;
    for (let si=0;si<series.length;si++) {
      for (let sj=si+1;sj<series.length;sj++) {
        const p1s=series[si].points, p2s=series[sj].points;
        if (p1s.length<2||p2s.length<2) continue;
        const t1=p1s.map(p=>({x:txFn(p.x),y:tyFn(p.y)})), t2=p2s.map(p=>({x:txFn(p.x),y:tyFn(p.y)}));
        for (let i=0;i<t1.length-1;i++) {
          for (let j=0;j<t2.length-1;j++) {
            const a=t1[i],b=t1[i+1],c=t2[j],d=t2[j+1];
            const dx1=b.x-a.x,dy1=b.y-a.y,dx2=d.x-c.x,dy2=d.y-c.y;
            const denom=dx1*dy2-dy1*dx2;
            if (Math.abs(denom)<1e-12) continue;
            const t=((c.x-a.x)*dy2-(c.y-a.y)*dx2)/denom;
            const u=((c.x-a.x)*dy1-(c.y-a.y)*dx1)/denom;
            if (t>=0&&t<=1&&u>=0&&u<=1) {
              const ix=invX(a.x+t*dx1),iy=invY(a.y+t*dy1);
              if (isFinite(ix)&&isFinite(iy)) results.push({si,sj,x:ix,y:iy});
            }
          }
        }
      }
    }
    return results;
  }

  /* ============ canvas render ============ */
  useEffect(() => {
    if (!currentState) return;
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    const r = innerRect();
    ctx.clearRect(0,0,size.w,size.h);
    ctx.fillStyle="#F9FAFB"; ctx.fillRect(0,0,size.w,size.h);
    ctx.fillStyle="#fff"; ctx.fillRect(r.x,r.y,r.w,r.h);
    lastRectRef.current = null;

    /* background images */
    for (let i=0;i<MAX_BG;i++) {
      const img=bgRefs.current[i]; if(!img||!showBgs[i]||opacityBgs[i]<=0) continue;
      const {dx,dy,dw,dh,ax,ay}=drawRectAndAnchor(i);
      const cOn = calEnabledByBg[i];
      const cClip = calClipByBg[i];
      const cPx = calPixelsByBg[i];
      const hasCalRect = cOn && cPx?.x1 && cPx?.x2 && cPx?.y1 && cPx?.y2;
      if (hasCalRect && cClip) {
        const left = Math.min(cPx.x1.px, cPx.x2.px);
        const right = Math.max(cPx.x1.px, cPx.x2.px);
        const top = Math.min(cPx.y1.py, cPx.y2.py);
        const bottom = Math.max(cPx.y1.py, cPx.y2.py);
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, Math.max(1, right-left), Math.max(1, bottom-top));
        ctx.clip();
        ctx.globalAlpha=opacityBgs[i]; ctx.drawImage(img,dx,dy,dw,dh); ctx.globalAlpha=1;
        ctx.restore();
      } else {
        ctx.globalAlpha=opacityBgs[i]; ctx.drawImage(img,dx,dy,dw,dh); ctx.globalAlpha=1;
      }
      if (i===activeBg) lastRectRef.current={x:dx,y:dy,w:dw,h:dh};
      if (i===activeBg&&pickAnchor) {
        ctx.save(); ctx.strokeStyle="#F59E0B"; ctx.fillStyle="#F59E0B";
        ctx.beginPath(); ctx.arc(ax,ay,6,0,Math.PI*2); ctx.globalAlpha=0.15; ctx.fill(); ctx.globalAlpha=1;
        ctx.beginPath(); ctx.moveTo(ax-8,ay); ctx.lineTo(ax+8,ay); ctx.moveTo(ax,ay-8); ctx.lineTo(ax,ay+8); ctx.stroke(); ctx.restore();
      }
      if (i===activeBg&&bgEditMode&&lastRectRef.current) {
        const lr=lastRectRef.current,H=12; ctx.save();
        const hs=[{x:lr.x+lr.w,y:lr.y+lr.h/2,m:"right"},{x:lr.x,y:lr.y+lr.h/2,m:"left"},{x:lr.x+lr.w/2,y:lr.y,m:"top"},{x:lr.x+lr.w/2,y:lr.y+lr.h,m:"bottom"},{x:lr.x+lr.w,y:lr.y+lr.h,m:"uniform"}];
        for (const h of hs) {
          ctx.fillStyle=h.m==="uniform"?"#111827":"#1F2937"; ctx.globalAlpha=hoverHandle===h.m?1:0.9;
          ctx.fillRect(h.x-H/2,h.y-H/2,H,H); ctx.fillStyle="#fff"; ctx.globalAlpha=1;
          ctx.fillRect(h.x-(H/2-2),h.y-(H/2-2),H-4,H-4);
        }
        ctx.restore();
      }
    }

    drawGrid(ctx);

    /* guide X */
    if (guideXs.length) {
      const rr=innerRect(); ctx.save(); ctx.setLineDash([6,4]); ctx.lineWidth=1.5;
      for (const gx of guideXs) {
        const gp=dataToPixel(gx,1); ctx.strokeStyle="#EF4444";
        ctx.beginPath(); ctx.moveTo(gp.px,rr.y); ctx.lineTo(gp.px,rr.y+rr.h); ctx.stroke();
        currentState.series.forEach(s => {
          const y=yAtX(s.points,gx); if(y==null) return;
          const P=dataToPixel(gx,y);
          if (showCrossFromX) { ctx.strokeStyle="rgba(239,68,68,0.5)"; ctx.beginPath(); ctx.moveTo(rr.x,P.py); ctx.lineTo(rr.x+rr.w,P.py); ctx.stroke(); }
          ctx.fillStyle="#EF4444"; ctx.beginPath(); ctx.arc(P.px,P.py,4,0,Math.PI*2); ctx.fill();
        });
      }
      ctx.restore();
    }

    /* guide Y */
    if (guideYs.length) {
      const rr=innerRect(); ctx.save(); ctx.setLineDash([6,4]); ctx.lineWidth=1.5;
      for (const gy of guideYs) {
        const gp=dataToPixel(1,gy); ctx.strokeStyle="#3B82F6";
        ctx.beginPath(); ctx.moveTo(rr.x,gp.py); ctx.lineTo(rr.x+rr.w,gp.py); ctx.stroke();
        currentState.series.forEach(s => {
          const x=xAtY(s.points,gy); if(x==null) return;
          const P=dataToPixel(x,gy);
          if (showCrossFromY) { ctx.strokeStyle="rgba(59,130,246,0.5)"; ctx.beginPath(); ctx.moveTo(P.px,rr.y); ctx.lineTo(P.px,rr.y+rr.h); ctx.stroke(); }
          ctx.fillStyle="#3B82F6"; ctx.beginPath(); ctx.arc(P.px,P.py,4,0,Math.PI*2); ctx.fill();
        });
      }
      ctx.restore();
    }

    /* lines - with min-break dashed split */
    if (connectLines) {
      const rr=innerRect(); ctx.save(); ctx.beginPath(); ctx.rect(rr.x,rr.y,rr.w,rr.h); ctx.clip();
      ctx.lineJoin="round"; ctx.lineCap="round"; ctx.globalAlpha=lineAlpha; ctx.lineWidth=lineWidth;

      currentState.series.forEach((s, si) => {
        if (s.points.length<2) return;
        const pxPts = s.points.map(p=>dataToPixel(p.x,p.y));
        ctx.strokeStyle = s.color;
        const minBreak = minBreakCurrents[si] ?? null;

        const drawPath = () => {
          ctx.beginPath();
          if (smoothLines) catmullRomPath(ctx, pxPts, smoothAlpha);
          else { ctx.moveTo(pxPts[0].px,pxPts[0].py); for (let k=1;k<pxPts.length;k++) ctx.lineTo(pxPts[k].px,pxPts[k].py); }
          ctx.stroke();
        };

        if (!minBreak||!isFinite(minBreak)||minBreak<=0) {
          ctx.setLineDash([]);
          drawPath();
        } else {
          /* find where curve crosses X = minBreak, interpolate the Y there */
          const spts = s.points.slice().sort((a,b)=>a.x-b.x);
          const ci = spts.findIndex(p=>p.x>=minBreak);
          let markerPy = rr.y + rr.h * 0.5;
          if (ci > 0) {
            const p1=spts[ci-1], p2=spts[ci];
            const txL=v=>tVal(v,currentState.xLog), tyL=v=>tVal(v,currentState.yLog);
            const invY=tv=>currentState.yLog?Math.pow(10,tv):tv;
            const ratio=(txL(minBreak)-txL(p1.x))/((txL(p2.x)-txL(p1.x))||EPS);
            markerPy = dataToPixel(minBreak, invY(tyL(p1.y)+ratio*(tyL(p2.y)-tyL(p1.y)))).py;
          } else if (ci===0) {
            markerPy = dataToPixel(spts[0].x, spts[0].y).py;
          } else {
            const lp=spts[spts.length-1];
            markerPy = dataToPixel(lp.x, lp.y).py;
          }
          /* draw full path as dashed first */
          ctx.setLineDash([8,5]);
          drawPath();
          /* overdraw BELOW the marker (py >= markerPy = lower Y data) as solid */
          ctx.save();
          ctx.beginPath();
          ctx.rect(rr.x-2, markerPy-2, rr.w+4, rr.y+rr.h-markerPy+4);
          ctx.clip();
          ctx.setLineDash([]);
          drawPath();
          ctx.restore();
          ctx.setLineDash([]);
          /* horizontal reference line at the crossing Y */
          ctx.save(); ctx.setLineDash([4,4]); ctx.lineWidth=1; ctx.globalAlpha=0.55;
          ctx.strokeStyle=s.color;
          ctx.beginPath(); ctx.moveTo(rr.x, markerPy); ctx.lineTo(rr.x+rr.w, markerPy); ctx.stroke();
          ctx.restore(); ctx.lineWidth=lineWidth; ctx.globalAlpha=lineAlpha;
        }
        ctx.setLineDash([]);
      });

      ctx.globalAlpha=1; ctx.restore();
    }

    /* points */
    if (showPoints) {
      currentState.series.forEach((s,si) => {
        ctx.fillStyle=s.color; ctx.strokeStyle="#fff";
        s.points.forEach((p,pi) => {
          const P=dataToPixel(p.x,p.y);
          ctx.beginPath(); ctx.arc(P.px,P.py,ptRadius,0,Math.PI*2); ctx.fill();
          if (ptRadius>=3) { ctx.lineWidth=1; ctx.stroke(); }
          if (selectedPoint?.seriesIndex===si&&selectedPoint?.pointIndex===pi) {
            ctx.strokeStyle="#2563EB"; ctx.lineWidth=2.5;
            ctx.beginPath(); ctx.arc(P.px,P.py,ptRadius+3,0,Math.PI*2); ctx.stroke();
          }
        });
      });
    }

    /* series intersections */
    const intersections = computeSeriesIntersections();
    if (intersections.length>0) {
      const rr=innerRect(); ctx.save(); ctx.beginPath(); ctx.rect(rr.x,rr.y,rr.w,rr.h); ctx.clip();
      for (const inter of intersections) {
        const P=dataToPixel(inter.x,inter.y);
        const s1=currentState.series[inter.si],s2=currentState.series[inter.sj];
        ctx.strokeStyle="#fff"; ctx.lineWidth=3;
        ctx.beginPath(); ctx.arc(P.px,P.py,7,0,Math.PI*2); ctx.stroke();
        ctx.fillStyle="#F97316";
        ctx.beginPath(); ctx.arc(P.px,P.py,7,0,Math.PI*2); ctx.fill();
        ctx.fillStyle="#fff";
        ctx.beginPath(); ctx.arc(P.px,P.py,2.5,0,Math.PI*2); ctx.fill();
        ctx.font="bold 10px ui-sans-serif"; ctx.fillStyle="#92400E"; ctx.textAlign="left";
        ctx.fillText(s1.name+"n"+s2.name, P.px+10, P.py+4);
      }
      ctx.restore();
    }

    /* axes border + titles */
    ctx.strokeStyle="#374151"; ctx.lineWidth=1.2; ctx.strokeRect(r.x,r.y,r.w,r.h);
    ctx.fillStyle="#111827"; ctx.font="14px ui-sans-serif, system-ui"; ctx.textAlign="center";
    ctx.fillText(currentState.xLog?"X (10^n)":"X", r.x+r.w/2, r.y+r.h+34);
    ctx.save(); ctx.translate(r.x-45,r.y+r.h/2); ctx.rotate(-Math.PI/2); ctx.fillText(currentState.yLog?"Y (10^n)":"Y",0,0); ctx.restore();

    /* snap preview for anchor pick mode */
    if (pickAnchor && snapPreviewRef.current) {
      const {px:spx,py:spy}=snapPreviewRef.current; const rr=innerRect();
      ctx.save(); ctx.strokeStyle="#f59e0b"; ctx.lineWidth=1.5; ctx.setLineDash([4,3]);
      ctx.beginPath(); ctx.moveTo(rr.x,spy); ctx.lineTo(rr.x+rr.w,spy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(spx,rr.y); ctx.lineTo(spx,rr.y+rr.h); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle="#f59e0b";
      ctx.beginPath(); ctx.arc(spx,spy,5,0,Math.PI*2); ctx.fill();
      ctx.restore();
    }

    /* calibration markers */
    const drawCal = (pt, label, color) => {
      if (!pt) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(pt.px - 8, pt.py); ctx.lineTo(pt.px + 8, pt.py); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pt.px, pt.py - 8); ctx.lineTo(pt.px, pt.py + 8); ctx.stroke();
      ctx.beginPath(); ctx.arc(pt.px, pt.py, 3, 0, Math.PI * 2); ctx.fill();
      ctx.font = "bold 11px ui-sans-serif"; ctx.textAlign = "left";
      ctx.fillText(label, pt.px + 10, pt.py - 8);
      if (selectedCalPoint === label.toLowerCase()) {
        ctx.beginPath(); ctx.arc(pt.px, pt.py, 8, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    };
    if (calEnabled && calPixels.x1 && calPixels.x2 && calPixels.y1 && calPixels.y2) {
      const left = Math.min(calPixels.x1.px, calPixels.x2.px);
      const right = Math.max(calPixels.x1.px, calPixels.x2.px);
      const top = Math.min(calPixels.y1.py, calPixels.y2.py);
      const bottom = Math.max(calPixels.y1.py, calPixels.y2.py);
      ctx.save();
      ctx.strokeStyle = "#0EA5E9";
      ctx.lineWidth = 2;
      ctx.setLineDash([7,4]);
      ctx.strokeRect(left, top, right - left, bottom - top);
      ctx.restore();
    }
    drawCal(calPixels.x1, "X1", "#2563EB");
    drawCal(calPixels.x2, "X2", "#2563EB");
    drawCal(calPixels.y1, "Y1", "#DC2626");
    drawCal(calPixels.y2, "Y2", "#DC2626");

    /* legend */
    ctx.save();
    const rr2=innerRect(); ctx.font="600 16px ui-sans-serif, system-ui";
    let lx=rr2.x+10,ly=rr2.y+20;
    currentState.series.forEach((s,i) => {
      ctx.fillStyle=s.color; ctx.fillRect(lx,ly-10,12,12);
      ctx.fillStyle="#0f172a"; ctx.textAlign="left"; ctx.textBaseline="alphabetic";
      ctx.fillText(s.name+" ("+s.points.length+")"+(i===activeSeries?"  <":""), lx+22, ly+2);
      ly+=22;
    });
    ctx.restore();

    /* magnifier */
    if (magnifyOn&&hoverRef.current.x!==null) {
      const hp=dataToPixel(hoverRef.current.x,hoverRef.current.y);
      const sz=120,f=magnifyFactor;
      const sx=Math.max(0,Math.min(size.w-sz/f,hp.px-sz/(2*f)));
      const sy=Math.max(0,Math.min(size.h-sz/f,hp.py-sz/(2*f)));
      ctx.save(); ctx.imageSmoothingEnabled=false;
      ctx.drawImage(c,sx,sy,sz/f,sz/f,size.w-sz-16,16,sz,sz);
      ctx.strokeStyle="#111827"; ctx.lineWidth=2; ctx.strokeRect(size.w-sz-16,16,sz,sz);
      ctx.beginPath(); ctx.moveTo(size.w-sz-16+sz/2,16); ctx.lineTo(size.w-sz-16+sz/2,16+sz);
      ctx.moveTo(size.w-sz-16,16+sz/2); ctx.lineTo(size.w-16,16+sz/2); ctx.stroke(); ctx.restore();
    }
  }, [currentState,activeBg,showBgs,opacityBgs,keepAspect,anchorMode,pickAnchor,hoverHandle,
      showPoints,connectLines,lineAlpha,lineWidth,smoothLines,smoothAlpha,ptRadius,
      guideXs,guideYs,showCrossFromX,showCrossFromY,magnifyOn,selectedPoint,tick,minBreakCurrents,
      calEnabledByBg,calClipByBg,calPixelsByBg,calValuesByBg,calPick,selectedCalPoint]);

  /* I2t graph render */
  useEffect(() => {
    if (!showI2tGraph||!currentState) return;
    try {
      const c=i2tCanvasRef.current; if(!c) return;
      const ctx=c.getContext("2d"); if(!ctx) return;
      const r=innerRect();
      ctx.clearRect(0,0,size.w,size.h);
      ctx.fillStyle="#F9FAFB"; ctx.fillRect(0,0,size.w,size.h);
      ctx.fillStyle="#fff"; ctx.fillRect(r.x,r.y,r.w,r.h);

      const activeS=currentState.series[activeSeries];
      if (activeS&&activeS.points.length>=2) {
        const samples=activeS.points.map(p=>({t:p.y,i:p.x})).filter(s=>isFinite(s.t)&&isFinite(s.i)&&s.t>0&&s.i>0).sort((a,b)=>a.t-b.t);
        const baseI2t=samples.map(s=>({x:s.t,y:s.i*s.i*s.t}));
        if (baseI2t.length>0) {
          const minPos=arr=>Math.max(1e-12,Math.min(...arr.filter(v=>v>0))||1e-12);
          const maxPos=arr=>Math.max(1e-12,Math.max(...arr.filter(v=>v>0))||1e-12);
          const scales=(lifetimeMode==="I_mode"?currentMultipliers.map(m=>m*m):lifetimeRatios).filter(v=>isFinite(v)&&v>0);
          const minScale=scales.length?Math.min(...scales):1, maxScale=scales.length?Math.max(...scales):1;
          const tVals=baseI2t.map(p=>p.x),baseY=baseI2t.map(p=>p.y);
          const floorP10=v=>Math.pow(10,Math.floor(Math.log10(Math.max(1e-12,v))));
          const ceilP10=v=>Math.pow(10,Math.ceil(Math.log10(Math.max(1e-12,v))));
          const i2tXMin=i2tFixedRange?1e-3:floorP10(minPos(tVals));
          const i2tXMax=i2tFixedRange?1e4:ceilP10(maxPos(tVals));
          const i2tYMin=i2tFixedRange?1e2:floorP10(minPos(baseY)*Math.max(1e-12,minScale));
          const i2tYMax=i2tFixedRange?1e10:ceilP10(maxPos(baseY)*Math.max(1e-12,maxScale));
          const xPx=v=>r.x+((Math.log10(Math.max(1e-12,v))-Math.log10(i2tXMin))/(Math.log10(i2tXMax)-Math.log10(i2tXMin)))*r.w;
          const yPx=v=>r.y+r.h-((Math.log10(Math.max(1e-12,v))-Math.log10(i2tYMin))/(Math.log10(i2tYMax)-Math.log10(i2tYMin)))*r.h;
          ctx.save(); ctx.beginPath(); ctx.rect(r.x,r.y,r.w,r.h); ctx.clip();
          const COLORS=["#2563EB","#10B981","#DC2626","#F59E0B","#8B5CF6","#EC4899","#6B7280"];
          lifetimeCycles.forEach((cycles,idx) => {
            if (!selectedLifetimeCycles.has(cycles)) return;
            const yScale=lifetimeMode==="I_mode"?Math.pow(currentMultipliers[idx]??1,2):(lifetimeRatios[idx]??1);
            const pxPts=baseI2t.map(pt=>({px:xPx(pt.x),py:yPx(pt.y*yScale)}));
            ctx.strokeStyle=COLORS[idx%COLORS.length]; ctx.lineWidth=2; ctx.globalAlpha=0.8; ctx.beginPath();
            if (pxPts.length>=2) catmullRomPath(ctx,pxPts,smoothAlpha);
            ctx.stroke();
          });
          /* legend */
          let legendY=r.y+20;
          lifetimeCycles.forEach((cycles,idx) => {
            if (!selectedLifetimeCycles.has(cycles)) return;
            ctx.fillStyle=COLORS[idx%COLORS.length]; ctx.fillRect(r.x+10,legendY-10,12,12);
            ctx.fillStyle="#0f172a"; ctx.font="12px ui-sans-serif"; ctx.textAlign="left"; ctx.globalAlpha=1;
            ctx.fillText(cycles+"x", r.x+26, legendY+2); legendY+=18;
          });
          ctx.globalAlpha=1;
          /* check point */
          if (isFinite(lifeCheckI)&&isFinite(lifeCheckT)&&lifeCheckI>0&&lifeCheckT>0) {
            const userY=lifeCheckI*lifeCheckI*lifeCheckT;
            const px=xPx(lifeCheckT),py=yPx(userY);
            ctx.save(); ctx.strokeStyle="#EF4444"; ctx.fillStyle="#EF4444";
            ctx.beginPath(); ctx.arc(px,py,4,0,Math.PI*2); ctx.fill();
            ctx.setLineDash([4,3]); ctx.beginPath(); ctx.moveTo(px,r.y); ctx.lineTo(px,r.y+r.h); ctx.moveTo(r.x,py); ctx.lineTo(r.x+r.w,py); ctx.stroke();
            ctx.setLineDash([]); ctx.font="12px ui-sans-serif"; ctx.fillStyle="#111827";
            ctx.fillText("I="+lifeCheckI.toFixed(3)+"A, t="+lifeCheckT, Math.min(r.x+r.w-120,px+6), Math.max(r.y+12,py-6)); ctx.restore();
          }
          ctx.restore();
          /* i2t grid */
          ctx.save(); ctx.strokeStyle="#E5E7EB"; ctx.fillStyle="#6B7280"; ctx.lineWidth=1; ctx.font="12px ui-sans-serif";
          const x0=Math.floor(Math.log10(i2tXMin)),x1=Math.ceil(Math.log10(i2tXMax));
          for (let n=x0;n<=x1;n++) { const px=xPx(Math.pow(10,n)); ctx.beginPath(); ctx.moveTo(px,r.y); ctx.lineTo(px,r.y+r.h); ctx.stroke(); ctx.textAlign="center"; ctx.fillText(pow10Label(n),px,r.y+r.h+18); }
          const y0=Math.floor(Math.log10(i2tYMin)),y1=Math.ceil(Math.log10(i2tYMax));
          for (let n=y0;n<=y1;n++) { const py=yPx(Math.pow(10,n)); ctx.beginPath(); ctx.moveTo(r.x,py); ctx.lineTo(r.x+r.w,py); ctx.stroke(); ctx.textAlign="right"; ctx.fillText(pow10Label(n),r.x-6,py+4); }
          ctx.restore();
        }
      }
      ctx.strokeStyle="#374151"; ctx.lineWidth=1.2; ctx.strokeRect(r.x,r.y,r.w,r.h);
      ctx.fillStyle="#111827"; ctx.font="14px ui-sans-serif, system-ui"; ctx.textAlign="center";
      ctx.fillText("I2t Lifetime", r.x+r.w/2, r.y-20);
      ctx.fillText("elapsed time (Sec)", r.x+r.w/2, r.y+r.h+34);
      ctx.save(); ctx.translate(r.x-45,r.y+r.h/2); ctx.rotate(-Math.PI/2); ctx.fillText("I2t",0,0); ctx.restore();
    } catch(err) { console.error("I2t render error",err); }
  }, [currentState,activeSeries,size,pad,showI2tGraph,lifetimeCycles,lifetimeRatios,currentMultipliers,lifetimeMode,selectedLifetimeCycles,tick,smoothAlpha,lifeCheckI,lifeCheckT,i2tFixedRange]);

  /* mouse */
  const onMouseMove = e => {
    latestMouse.current = { clientX: e.clientX, clientY: e.clientY };
    const {px,py}=canvasPoint(e); const rr=innerRect();
    if (px>=rr.x&&px<=rr.x+rr.w&&py>=rr.y&&py<=rr.y+rr.h) hoverRef.current=pixelToData(px,py);
    else hoverRef.current={x:null,y:null};
    if ((resizeRef.current.active||dragRef.current.active)&&bgEditMode) {
      if (!moveRafRef.current) {
        moveRafRef.current = requestAnimationFrame(() => {
          moveRafRef.current = null;
          const {px:mpx,py:mpy}=canvasPoint(latestMouse.current);
          if (resizeRef.current.active) {
            const {fx,fy,ax,ay,baseW,baseH,mode}=resizeRef.current;
            const safe=v=>Math.abs(v)<1e-6?1e-6:v;
            let dw,dh;
            if (mode==="right") dw=(mpx-ax)/safe(1-fx);
            else if (mode==="left") dw=(ax-mpx)/safe(fx);
            else if (mode==="bottom") dh=(mpy-ay)/safe(1-fy);
            else if (mode==="top") dh=(ay-mpy)/safe(fy);
            else if (mode==="uniform") { const dwX=mpx>=ax?(mpx-ax)/safe(1-fx):(ax-mpx)/safe(fx); const dhY=mpy>=ay?(mpy-ay)/safe(1-fy):(ay-mpy)/safe(fy); if(keepAspect){const s=Math.max(dwX/baseW,dhY/baseH);dw=baseW*s;dh=baseH*s;}else{dw=dwX;dh=dhY;} }
            const nsx=dw!=null?clampS(dw/baseW):null, nsy=dh!=null?clampS(dh/baseH):null;
            updateStateInPlace(prev=>{const n=[...prev.bgXform];const xf=n[activeBg];n[activeBg]={...xf,sx:nsx??xf.sx,sy:keepAspect?(nsx??xf.sx):nsy??xf.sy};return{...prev,bgXform:n};});
          } else {
            const bx=dragRef.current.baseX+(mpx-dragRef.current.startX), by=dragRef.current.baseY+(mpy-dragRef.current.startY);
            updateStateInPlace(prev=>{const n=[...prev.bgXform];const xf=n[activeBg];n[activeBg]={...xf,offX:bx,offY:by};return{...prev,bgXform:n};});
          }
        });
      }
      return;
    }
    setHoverHandle(bgEditMode?pickHandle(px,py):"none");
    if (pickAnchor) { snapPreviewRef.current = overImage(px,py) ? snapToGrid(px,py) : null; }
    setTick(t=>t+1);
  };
  const onMouseDown = e => {
    const {px,py}=canvasPoint(e); if(e.button===2){setPickAnchor(false);return;}
    if (calPick && inPlot(px, py)) {
      setCalPixelsForBg(activeBg, prev => ({ ...prev, [calPick]: { px, py } }));
      setSelectedCalPoint(calPick);
      setCalPick(null);
      notify(`Calibration ${calPick.toUpperCase()} point set`);
      return;
    }
    if (calEnabled) {
      const keys = ["x1","x2","y1","y2"];
      for (const k of keys) {
        const p = calPixels[k];
        if (p && Math.hypot(px - p.px, py - p.py) <= 10) {
          setSelectedCalPoint(k as CalPickKey);
          notify(`${k.toUpperCase()} selected (arrow keys move)`);
          return;
        }
      }
    }
    if (pickAnchor&&overImage(px,py)) {
      const xf=currentState.bgXform[activeBg];
      const lr=lastRectRef.current;
      // snap to nearest log-grid intersection
      const snapped = snapToGrid(px, py);
      const spx=snapped.px, spy=snapped.py;
      const fx=(spx-lr.x)/lr.w, fy=(spy-lr.y)/lr.h;
      snapPreviewRef.current = null;
      updateState(prev=>{const n=[...prev.customAnchors];n[activeBg]={ax:spx-xf.offX,ay:spy-xf.offY,fx:Math.max(0,Math.min(1,fx)),fy:Math.max(0,Math.min(1,fy))};return{...prev,customAnchors:n};}); setPickAnchor(false); return;
    }
    if (bgEditMode) {
      const h=pickHandle(px,py);
      if (h!=="none") { const d=drawRectAndAnchor(activeBg); resizeRef.current={active:true,mode:h,ax:d.ax,ay:d.ay,fx:d.fx,fy:d.fy,baseW:d.baseW,baseH:d.baseH}; }
      else { dragRef.current={active:true,startX:px,startY:py,baseX:currentState.bgXform[activeBg].offX,baseY:currentState.bgXform[activeBg].offY}; }
      /* attach window-level listeners so resize/drag continues outside the canvas */
      const winMove = ev => onMouseMove(ev);
      const winUp   = () => {
        dragRef.current.active=false; resizeRef.current.active=false;
        window.removeEventListener("mousemove", winMove);
        window.removeEventListener("mouseup",   winUp);
        setHoverHandle("none"); setTick(t=>t+1);
      };
      window.addEventListener("mousemove", winMove);
      window.addEventListener("mouseup",   winUp);
      setSelectedPoint(null); return;
    }
    if (inPlot(px,py)) {
      for (let si=0;si<currentState.series.length;si++) {
        for (let pi=0;pi<currentState.series[si].points.length;pi++) {
          const p=currentState.series[si].points[pi]; const {px:ppx,py:ppy}=dataToPixel(p.x,p.y);
          if (Math.hypot(px-ppx,py-ppy)<ptRadius+4) { setSelectedPoint({seriesIndex:si,pointIndex:pi}); return; }
        }
      }
      const d=pixelToData(px,py);
      updateState(prev=>({...prev,series:prev.series.map((s,i)=>i===activeSeries?{...s,points:[...s.points,d].sort((a,b)=>a.x-b.x)}:s)}));
      setSelectedPoint(null);
    }
  };
  const onMouseUp    = () => { dragRef.current.active=false; resizeRef.current.active=false; };
  const onMouseLeave = () => {
    hoverRef.current={x:null,y:null};
    /* do NOT cancel active resize/drag ? window listeners keep tracking */
    if (!resizeRef.current.active && !dragRef.current.active) setHoverHandle("none");
    setTick(t=>t+1);
  };

  /* paste from excel */
  const parsePastedPoints = (text) => {
    const lines = text.trim().split(/\r?\n/);
    const pts = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = line.split(/[\t,;]+/).map(s => s.trim().replace(/[,\s]/g, ''));
      if (parts.length < 2) continue;
      const x = Number(parts[0]), y = Number(parts[1]);
      if (!isFinite(x) || !isFinite(y) || x <= 0 || y <= 0) continue;
      pts.push({ x, y });
    }
    return pts.sort((a, b) => a.x - b.x);
  };

  const applyPastedPoints = (mode) => {
    const pts = parsePastedPoints(pasteText);
    if (pts.length === 0) { notify('No valid points found'); return; }
    updateState(prev => ({
      ...prev,
      series: prev.series.map((s, i) => {
        if (i !== activeSeries) return s;
        const merged = mode === 'replace' ? pts : [...s.points, ...pts].sort((a, b) => a.x - b.x);
        return { ...s, points: merged };
      }),
    }));
    notify(pts.length + ' points ' + (mode === 'replace' ? 'replaced' : 'added'));
    setPasteText('');
  };

  const copyPointsToClipboard = (seriesIdx = activeSeries) => {
    const s = currentState.series[seriesIdx ?? activeSeries];
    if (!s || s.points.length === 0) { notify('No points to copy', 'err'); return; }
    const text = s.points.map(p => `${p.x}\t${p.y}`).join('\n');
    navigator.clipboard.writeText(text).then(() => notify(`${s.points.length} points copied`)).catch(() => {
      /* fallback: textarea trick */
      const ta = document.createElement('textarea'); ta.value = text;
      document.body.appendChild(ta); ta.select(); document.execCommand('copy');
      document.body.removeChild(ta); notify(`${s.points.length} points copied`);
    });
  };

  /* product library API */
  const fetchLibrary = async () => {
    try {
      const res = await fetch('/api/products', { signal: AbortSignal.timeout(2000) });
      if (res.ok) { setLibraryItems(await res.json()); setServerAvail(true); }
      else setServerAvail(false);
    } catch { setServerAvail(false); }
  };

  const saveToLibrary = async (slot) => {
    if (!saveFormCompany.trim() || !saveFormName.trim()) { notify("Enter company and product name", "err"); return; }
    const s = currentState.series[slot];
    const payload = {
      company: saveFormCompany.trim(),
      name: saveFormName.trim(),
      sourceSlot: slot,
      imageData: bgUrls.current[slot] ?? null,
      bgXform: currentState.bgXform[slot],
      customAnchor: currentState.customAnchors[slot] ?? null,
      seriesName: s?.name ?? SERIES_NAMES[slot] ?? 'S',
      seriesColor: s?.color ?? SERIES_COLORS[slot] ?? '#64748B',
      points: s?.points ?? [],
      minBreakCurrent: minBreakCurrents[slot] ?? null,
    };
    try {
      const res = await fetch('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (res.ok) { notify('Saved!'); fetchLibrary(); }
      else notify('Save failed', 'err');
    } catch { notify('Server error', 'err'); }
  };

  const loadFromLibrary = async (itemId, targetSlot) => {
    try {
      const res = await fetch('/api/products/' + itemId);
      if (!res.ok) { notify('Load failed', 'err'); return; }
      const product = await res.json();
      if (product.imageData) {
        const img = new Image(); img.crossOrigin = "anonymous";
        img.onload = () => {
          bgRefs.current[targetSlot] = img;
          bgUrls.current[targetSlot] = product.imageData;
          setBgList(cur => { const n = [...cur]; n[targetSlot] = { w: img.width, h: img.height }; return n; });
          setShowBgs(cur => { const n = [...cur]; n[targetSlot] = true; return n; });
        };
        img.src = product.imageData;
      }
      updateState(prev => {
        const newBgXform = [...prev.bgXform];
        const newAnchors = [...prev.customAnchors];
        if (product.bgXform) newBgXform[targetSlot] = product.bgXform;
        newAnchors[targetSlot] = product.customAnchor ?? null;
        const newSeries = [...prev.series];
        while (newSeries.length <= targetSlot) newSeries.push({ name: SERIES_NAMES[newSeries.length] ?? 'S', color: SERIES_COLORS[newSeries.length] ?? '#64748B', points: [] });
        newSeries[targetSlot] = { name: product.seriesName ?? SERIES_NAMES[targetSlot], color: product.seriesColor ?? SERIES_COLORS[targetSlot], points: product.points ?? [] };
        return { ...prev, bgXform: newBgXform, customAnchors: newAnchors, series: newSeries };
      });
      setMinBreakCurrents(prev => { const n = [...prev]; while (n.length <= targetSlot) n.push(null); n[targetSlot] = product.minBreakCurrent ?? null; return n; });
      if (product.minBreakCurrent != null) setMinBreakInputs(prev => ({ ...prev, [targetSlot]: String(product.minBreakCurrent) }));
      notify('Loaded to slot ' + SERIES_NAMES[targetSlot]);
      setShowLibrary(false);
    } catch { notify('Server error', 'err'); }
  };

  const deleteFromLibrary = async (itemId) => {
    try {
      await fetch('/api/products/' + itemId, { method: 'DELETE' });
      fetchLibrary();
    } catch { notify('Delete failed', 'err'); }
  };

  /* preset */
  const serialize = () => ({
    v:2,
    axes:{xMin:currentState.xMin,xMax:currentState.xMax,yMin:currentState.yMin,yMax:currentState.yMax,xLog:currentState.xLog,yLog:currentState.yLog},
    series:currentState.series,
    bg:{xform:currentState.bgXform,customAnchors:currentState.customAnchors,activeBg,keepAspect,showBgs,opacityBgs},
    guidesX:guideXs,guidesY:guideYs,
    cross:{fromX:showCrossFromX,fromY:showCrossFromY},
    i2t:{show:showI2tGraph,mode:lifetimeMode,cycles:lifetimeCycles,multipliers:currentMultipliers,ratios:lifetimeRatios},
    minBreakCurrents,
    calibrationByBg:{enabled:calEnabledByBg,clip:calClipByBg,pixels:calPixelsByBg,values:calValuesByBg},
  });
  const applyPreset = p => {
    try {
      const rawSeries=(p.series??currentState.series).slice(0,MAX_SERIES);
      const nextSeries=rawSeries.map((s,i)=>({name:s.name??SERIES_NAMES[i],color:s.color??SERIES_COLORS[i],points:(s.points??[]).map(pt=>({x:Number(pt.x),y:Number(pt.y)}))}));
      const rawXform=Array.isArray(p.bg?.xform)?p.bg.xform:[];
      const rawAnchors=Array.isArray(p.bg?.customAnchors)?p.bg.customAnchors:[];
      const bgXform=Array(MAX_BG).fill(null).map((_,i)=>rawXform[i]??currentState.bgXform[i]??{sx:1,sy:1,offX:0,offY:0});
      const customAnchors=Array(MAX_BG).fill(null).map((_,i)=>rawAnchors[i]??null);
      const next={xMin:p.axes?.xMin??10,xMax:p.axes?.xMax??1000000,yMin:p.axes?.yMin??0.0001,yMax:p.axes?.yMax??1000000,xLog:!!p.axes?.xLog,yLog:!!p.axes?.yLog,series:nextSeries,bgXform,customAnchors};
      setGuideXs(Array.isArray(p.guidesX)?p.guidesX:[]);
      setGuideYs(Array.isArray(p.guidesY)?p.guidesY:[]);
      setShowCrossFromX(p.cross?.fromX??true); setShowCrossFromY(p.cross?.fromY??true);
      setKeepAspect(!!p.bg?.keepAspect);
      const rawShow=p.bg?.showBgs??p.bg?.showAB??null;
      const rawOpac=p.bg?.opacityBgs??p.bg?.opacityAB??null;
      setShowBgs(Array(MAX_BG).fill(null).map((_,i)=>rawShow?.[i]??true));
      setOpacityBgs(Array(MAX_BG).fill(null).map((_,i)=>rawOpac?.[i]??BG_DEFAULT_OPACITY[i]));
      setActiveBg(p.bg?.activeBg??0);
      if (p.i2t) {
        setShowI2tGraph(!!p.i2t.show);
        if (p.i2t.mode==="I_mode"||p.i2t.mode==="I2t_mode") setLifetimeMode(p.i2t.mode);
        if (Array.isArray(p.i2t.cycles)) setLifetimeCycles(p.i2t.cycles.map(Number).filter(v=>isFinite(v)&&v>0));
        if (Array.isArray(p.i2t.multipliers)) {
          const loaded = p.i2t.multipliers.map(Number).filter(v=>isFinite(v)&&v>0);
          /* 1회(index 0) 기본값은 항상 3.15로 고정 */
          if (loaded.length > 0) loaded[0] = 3.15;
          setCurrentMultipliers(loaded);
        }
        if (Array.isArray(p.i2t.ratios)) setLifetimeRatios(p.i2t.ratios.map(Number).filter(v=>isFinite(v)&&v>0));
      }
      if (Array.isArray(p.minBreakCurrents)) {
        setMinBreakCurrents(p.minBreakCurrents.slice(0,MAX_SERIES).map(v=>(v!=null&&isFinite(Number(v))&&Number(v)>0)?Number(v):null));
        setMinBreakInputs({});
      }
      if (p.calibrationByBg) {
        const en = Array(MAX_BG).fill(false).map((_,i)=>!!p.calibrationByBg?.enabled?.[i]);
        const cp = Array(MAX_BG).fill(false).map((_,i)=>!!p.calibrationByBg?.clip?.[i]);
        const px = Array(MAX_BG).fill(null).map((_,i)=>p.calibrationByBg?.pixels?.[i] ?? {x1:null,x2:null,y1:null,y2:null});
        const vv = Array(MAX_BG).fill(null).map((_,i)=>p.calibrationByBg?.values?.[i] ?? {x1:"",x2:"",y1:"",y2:""});
        setCalEnabledByBg(en); setCalClipByBg(cp); setCalPixelsByBg(px); setCalValuesByBg(vv);
      } else if (p.calibration) {
        const en = Array(MAX_BG).fill(false); en[0] = !!p.calibration.enabled;
        const cp = Array(MAX_BG).fill(false);
        const px = Array(MAX_BG).fill(null).map((_,i)=>i===0?(p.calibration.pixels ?? {x1:null,x2:null,y1:null,y2:null}):{x1:null,x2:null,y1:null,y2:null});
        const vv = Array(MAX_BG).fill(null).map((_,i)=>i===0?(p.calibration.values ?? {x1:"",x2:"",y1:"",y2:""}):{x1:"",x2:"",y1:"",y2:""});
        setCalEnabledByBg(en); setCalClipByBg(cp); setCalPixelsByBg(px); setCalValuesByBg(vv);
      }
      updateState(()=>next,true); notify("Preset loaded");
    } catch { notify("Invalid preset","err"); }
  };
  const savePresetFile = () => { const blob=new Blob([JSON.stringify(serialize(),null,2)],{type:"application/json"}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="digitizer_preset_"+Date.now()+".json"; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),0); };
  const loadPresetFromFile = file => { if(!file) return; const fr=new FileReader(); fr.onload=()=>{try{applyPreset(JSON.parse(String(fr.result||"{}")));}catch{notify("Cannot parse preset","err");}}; fr.readAsText(file); };
  const copyShareURL = () => { const payload=btoa(unescape(encodeURIComponent(JSON.stringify(serialize())))); navigator.clipboard.writeText(location.origin+location.pathname+"#s="+payload).then(()=>notify("URL copied")); };
  const exportCSV = () => { let out="series,x,y\n"; currentState.series.forEach(s=>s.points.forEach(p=>(out+=s.name+","+p.x+","+p.y+"\n"))); const url=URL.createObjectURL(new Blob([out],{type:"text/csv"})); const a=document.createElement("a"); a.href=url; a.download="points_"+Date.now()+".csv"; a.click(); setTimeout(()=>URL.revokeObjectURL(url),0); };
  const exportPNG  = () => { const c=canvasRef.current; if(!c) return; const a=document.createElement("a"); a.href=c.toDataURL("image/png"); a.download="digitizer_"+Date.now()+".png"; a.click(); };

  useEffect(() => {
    const h=location.hash||"";
    if (h.startsWith("#s=")) { try{applyPreset(JSON.parse(decodeURIComponent(escape(atob(h.slice(3))))));return;}catch{} }
    try{const raw=localStorage.getItem("digitizer:auto");if(raw)applyPreset(JSON.parse(raw));}catch{}
  }, []);
  useEffect(() => { try{localStorage.setItem("digitizer:auto",JSON.stringify(serialize()));}catch{} }, [currentState,guideXs,guideYs,showCrossFromX,showCrossFromY,keepAspect,showBgs,opacityBgs,activeBg,calEnabledByBg,calClipByBg,calPixelsByBg,calValuesByBg]);

  if (!currentState) return <div className="flex h-screen items-center justify-center">Loading...</div>;

  /* ===== Spreadsheet helpers ===== */
  const ptEditKey = (row: number, col: number) => `${activeSeries},${row},${col}`;

  const fmtCell = (p: Pt, col: number): string => {
    if (col === 0) return showRealCoords ? fmtReal(p.x) : fmtReal(currentState.xLog ? Math.log10(Math.max(EPS, p.x)) : p.x);
    return showRealCoords ? fmtReal(p.y) : fmtReal(currentState.yLog ? Math.log10(Math.max(EPS, p.y)) : p.y);
  };

  const cellDisplayVal = (p: Pt, row: number, col: number): string => {
    const k = ptEditKey(row, col);
    return rawEdits[k] !== undefined ? rawEdits[k] : fmtCell(p, col);
  };

  const realVal = (raw: string, col: number): number | null => {
    const n = Number(raw.replace(/,/g, ""));
    if (!isFinite(n) || n <= 0) return null;
    if (showRealCoords) return n;
    return col === 0
      ? (currentState.xLog ? Math.pow(10, n) : n)
      : (currentState.yLog ? Math.pow(10, n) : n);
  };

  const commitCell = (row: number, col: number) => {
    const k = ptEditKey(row, col);
    const raw = rawEdits[k];
    if (raw === undefined) return;
    const rv = realVal(raw, col);
    if (rv !== null) {
      updateState(prev => ({
        ...prev,
        series: prev.series.map((s, si) => si !== activeSeries ? s : {
          ...s,
          points: s.points.map((pt, pi) => pi !== row ? pt : { ...pt, [col === 0 ? 'x' : 'y']: rv })
        })
      }));
    }
    setRawEdits(prev => { const n = { ...prev }; delete n[k]; return n; });
  };

  const focusPtCell = (row: number, col: number) => {
    setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>(`[data-ptrow="${row}"][data-ptcol="${col}"][data-ptseries="${activeSeries}"]`);
      el?.focus(); el?.select();
    }, 0);
  };

  const handlePtKeyDown = (e: React.KeyboardEvent, row: number, col: number, isNewRow = false) => {
    const pts = currentState.series[activeSeries]?.points ?? [];
    if (e.key === "Tab") {
      e.preventDefault();
      if (!isNewRow) commitCell(row, col);
      if (col === 0) { focusPtCell(row, 1); }
      else { focusPtCell(row + 1, 0); }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!isNewRow) commitCell(row, col);
      if (isNewRow) {
        const xv = realVal(newPtX, 0), yv = realVal(newPtY, 1);
        if (xv !== null && yv !== null) {
          updateState(prev => ({
            ...prev,
            series: prev.series.map((s, si) => si !== activeSeries ? s : {
              ...s, points: [...s.points, { x: xv, y: yv }].sort((a, b) => a.x - b.x)
            })
          }));
          setNewPtX(""); setNewPtY("");
          focusPtCell(pts.length + 1, 0);
        } else {
          focusPtCell(pts.length, col === 0 ? 1 : 0);
        }
      } else {
        focusPtCell(row + 1, col);
      }
    } else if (e.key === "ArrowUp" && !isNewRow) {
      e.preventDefault();
      commitCell(row, col);
      if (row > 0) focusPtCell(row - 1, col);
    } else if (e.key === "ArrowDown" && !isNewRow) {
      e.preventDefault();
      commitCell(row, col);
      focusPtCell(row + 1, col);
    } else if (e.key === "Escape") {
      setRawEdits(prev => { const n = { ...prev }; delete n[ptEditKey(row, col)]; return n; });
    }
  };

  const handlePtPaste = (e: React.ClipboardEvent, startRow: number, startCol: number) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text");
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
    const pts = [...(currentState.series[activeSeries]?.points ?? [])];
    let added = 0;
    lines.forEach((line, i) => {
      const parts = line.split(/\t|,|;/).map(s => s.trim().replace(/,/g, ""));
      const row = startRow + i;
      if (startCol === 0 && parts.length >= 2) {
        const xv = realVal(parts[0], 0), yv = realVal(parts[1], 1);
        if (xv === null || yv === null) return;
        if (row < pts.length) pts[row] = { x: xv, y: yv };
        else pts.push({ x: xv, y: yv });
        added++;
      } else if (startCol === 1 && parts.length >= 1) {
        const yv = realVal(parts[0], 1);
        if (yv === null || row >= pts.length) return;
        pts[row] = { ...pts[row], y: yv };
        added++;
      }
    });
    if (added === 0) { notify("유효한 데이터 없음", "err"); return; }
    updateState(prev => ({
      ...prev,
      series: prev.series.map((s, si) => si !== activeSeries ? s : {
        ...s, points: pts.sort((a, b) => a.x - b.x)
      })
    }));
    notify(`${added}행 붙여넣기 완료`);
  };

  /* data for panels */
  const guideRows = [];
  for (const gx of guideXs) { const label=guideXLabels[gx]??fmtReal(gx); currentState.series.forEach(s=>guideRows.push({kind:"X",guide:gx,guideLabel:label,series:s.name,value:yAtX(s.points,gx)})); }
  for (const gy of guideYs) { const label=guideYLabels[gy]??fmtReal(gy); currentState.series.forEach(s=>guideRows.push({kind:"Y",guide:gy,guideLabel:label,series:s.name,value:xAtY(s.points,gy)})); }
  const seriesIntersections = computeSeriesIntersections();

  return (
    <div className="min-h-screen bg-gray-100 text-gray-800 font-sans antialiased">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-gray-200 bg-white/80 p-4 backdrop-blur-sm">
        <h1 className="text-xl font-bold text-gray-900">Log-scale Graph Digitizer</h1>
        <div className="flex flex-wrap items-center gap-3 text-base">
          <button onClick={()=>updateState(p=>({...p,series:p.series.map((s,i)=>i===activeSeries?{...s,points:s.points.slice(0,-1)}:s)}))} className="rounded-lg bg-gray-200 px-4 py-2 font-semibold hover:bg-gray-300">Undo Last Point</button>
          <button onClick={()=>updateState(p=>({...p,series:p.series.map((s,i)=>i===activeSeries?{...s,points:[]}:s)}))} className="rounded-lg bg-gray-200 px-4 py-2 font-semibold text-red-700 hover:bg-red-100">Clear Active</button>
          <div className="h-6 w-px bg-gray-300"/>
          <button onClick={handleUndo} disabled={historyIndex<=0} className="rounded-lg bg-gray-200 px-4 py-2 font-semibold hover:bg-gray-300 disabled:opacity-50">Undo</button>
          <button onClick={handleRedo} disabled={historyIndex>=history.length-1} className="rounded-lg bg-gray-200 px-4 py-2 font-semibold hover:bg-gray-300 disabled:opacity-50">Redo</button>
          <div className="h-6 w-px bg-gray-300"/>
          <button onClick={savePresetFile} className="rounded-lg bg-gray-200 px-4 py-2 hover:bg-gray-300">Save Preset</button>
          <button onClick={()=>presetFileRef.current?.click()} className="rounded-lg bg-gray-200 px-4 py-2 hover:bg-gray-300">Load Preset</button>
          <input ref={presetFileRef} type="file" accept="application/json" hidden onChange={e=>{const f=e.target.files?.[0];if(f)loadPresetFromFile(f);e.target.value="";}}/>
          <button onClick={copyShareURL} className="rounded-lg bg-gray-200 px-4 py-2 hover:bg-gray-300">Copy URL</button>
          <div className="h-6 w-px bg-gray-300"/>
          <button onClick={exportCSV} className="rounded-lg bg-gray-200 px-4 py-2 hover:bg-gray-300">Export CSV</button>
          <button onClick={exportPNG} className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700">Export PNG</button>
          <div className="h-6 w-px bg-gray-300"/>
          <button onClick={()=>{setShowLibrary(true);fetchLibrary();}} className="rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700">Product Library</button>
          <div className="h-6 w-px bg-gray-300"/>
          {loggedInUser?(
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-green-700">👤 {loggedInUser}</span>
              <button onClick={()=>setLoggedInUser(null)} className="rounded-lg bg-gray-200 px-3 py-2 text-sm hover:bg-gray-300">로그아웃</button>
            </div>
          ):(
            <button onClick={()=>{setShowLoginModal(true);setLoginUserInput("");setLoginPwInput("");setLoginError(false);}}
              className="rounded-lg bg-gray-200 px-4 py-2 font-semibold hover:bg-gray-300">🔒 로그인</button>
          )}
        </div>
      </header>

      <main className={`grid grid-cols-1 gap-3 p-3 ${sidebarCollapsed?"lg:grid-cols-[60px,1fr]":showI2tGraph?"lg:grid-cols-[280px,1fr,1fr]":"lg:grid-cols-[280px,1fr]"}`}>
        {/* Sidebar */}
        <aside className={`flex flex-col gap-2 ${sidebarCollapsed?"items-center":""}`}>
          {sidebarCollapsed?(
            <div className="flex flex-col gap-2">
              <button onClick={()=>setSidebarCollapsed(false)} className="rounded-lg border px-2 py-2 text-xl">{">"}</button>
              <button onClick={()=>setAxesOpen(v=>!v)} className={`rounded-lg px-2 py-2 text-xl ${axesOpen?"bg-gray-900 text-white":"border"}`}>A</button>
              <button onClick={()=>setBgEditMode(v=>!v)} className={`rounded-lg px-2 py-2 text-xl ${bgEditMode?"bg-gray-900 text-white":"border"}`}>I</button>
            </div>
          ):(
            <>
              <button onClick={()=>setSidebarCollapsed(true)} className="self-end rounded-lg border px-2 py-0.5 text-xs">{"< Hide"}</button>

              <AccordionSection title="Axes" isOpen={axesOpen} onToggle={()=>setAxesOpen(v=>!v)}>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <label className="col-span-2 flex items-center gap-2"><input type="checkbox" className="h-3 w-3" checked={currentState.xLog} onChange={e=>updateState(p=>({...p,xLog:e.target.checked}))} /> X Log Scale</label>
                  <label className="flex items-center gap-2">X Min <input type="number" className="w-full rounded border px-1.5 py-1 text-xs" value={currentState.xMin} onChange={e=>updateState(p=>({...p,xMin:Number(e.target.value)}))} /></label>
                  <label className="flex items-center gap-2">X Max <input type="number" className="w-full rounded border px-1.5 py-1 text-xs" value={currentState.xMax} onChange={e=>updateState(p=>({...p,xMax:Number(e.target.value)}))} /></label>
                  <label className="col-span-2 flex items-center gap-2"><input type="checkbox" className="h-3 w-3" checked={currentState.yLog} onChange={e=>updateState(p=>({...p,yLog:e.target.checked}))} /> Y Log Scale</label>
                  <label className="flex items-center gap-2">Y Min <input type="number" className="w-full rounded border px-1.5 py-1 text-xs" value={currentState.yMin} onChange={e=>updateState(p=>({...p,yMin:Number(e.target.value)}))} /></label>
                  <label className="flex items-center gap-2">Y Max <input type="number" className="w-full rounded border px-1.5 py-1 text-xs" value={currentState.yMax} onChange={e=>updateState(p=>({...p,yMax:Number(e.target.value)}))} /></label>
                </div>
              </AccordionSection>

              {/* Image Edit */}
              <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
                <button onClick={()=>setBgEditMode(v=>!v)} className="flex w-full items-center justify-between p-2 text-left">
                  <h3 className="text-sm font-bold text-gray-800">Image Edit</h3>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${bgEditMode?"bg-orange-100 text-orange-800":"bg-gray-200 text-gray-700"}`}>{bgEditMode?"ON":"OFF"}</span>
                </button>
                {bgEditMode&&(
                  <div className="space-y-2 p-2 pt-0 text-xs">
                    <div className="flex border-b border-gray-200 overflow-x-auto">
                      {BG_LABELS.map((label,i)=>(
                        <button key={i} onClick={()=>setActiveBg(i)} className={`-mb-px flex-shrink-0 border-b-2 px-2 py-1 text-xs font-semibold ${activeBg===i?"border-blue-500 text-blue-600":"border-transparent text-gray-500 hover:border-gray-300"}`}>
                          {label}{bgList[i]?" *":""}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      <button type="button" onClick={()=>fileRefs.current[activeBg]?.click()} className="rounded bg-gray-800 py-1.5 text-xs font-semibold text-white hover:bg-gray-700">
                        파일에서 불러오기 ({BG_LABELS[activeBg]})
                      </button>
                      <button type="button" onClick={()=>captureScreenToSlot(activeBg)} className="rounded border border-emerald-700 bg-emerald-600 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
                        화면·창 캡처
                      </button>
                    </div>
                    <p className="text-[9px] leading-snug text-gray-500">
                      캡처: 브라우저가 화면/창/탭 선택 창을 띄운 뒤, <strong>그 순간</strong> 한 장을 PNG로 슬롯에 넣습니다. 다른 창의 그래프를 골라 캡처하면 됩니다(HTTPS 또는 localhost).
                    </p>
                    {BG_LABELS.map((_,i)=>(
                      <input key={i} ref={el=>{fileRefs.current[i]=el;}} type="file" accept="image/*" hidden onChange={e=>{const f=e.target.files?.[0];if(f)onFile(f,i);e.target.value="";}}/>
                    ))}
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex items-center justify-between">Show <input type="checkbox" className="h-3 w-3" checked={showBgs[activeBg]} onChange={e=>setShowBgs(cur=>{const n=[...cur];n[activeBg]=e.target.checked;return n;})}/></label>
                      <label className="flex items-center gap-1">Opacity <input className="w-20" type="range" min={0} max={1} step={0.05} value={opacityBgs[activeBg]} onChange={e=>setOpacityBgs(cur=>{const n=[...cur];n[activeBg]=Number(e.target.value);return n;})}/></label>
                      <label className="col-span-2 flex items-center gap-2"><input type="checkbox" className="h-3 w-3" checked={keepAspect} onChange={e=>setKeepAspect(e.target.checked)}/> Keep Ratio</label>
                      <div className="col-span-2 grid grid-cols-2 gap-2">
                        <button onClick={()=>setPickAnchor(v=>!v)} className={`rounded bg-gray-200 px-2 py-1 text-xs ${pickAnchor?"bg-orange-100 text-orange-800":""}`}>{pickAnchor?"Click pivot point...":"Set Pivot"}</button>
                        <button onClick={()=>updateState(prev=>{const n=[...prev.customAnchors];n[activeBg]=null;return{...prev,customAnchors:n};})} className="rounded bg-gray-200 px-2 py-1 text-xs">Clear</button>
                      </div>
                    </div>
                    <div className="rounded border border-blue-200 bg-blue-50 p-2">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-blue-900">Calibration (Image {BG_LABELS[activeBg]})</span>
                        <label className="flex items-center gap-1 text-[11px]">
                          <input type="checkbox" className="h-3 w-3" checked={calEnabled} onChange={e=>setCalEnabledForBg(activeBg, e.target.checked)} />
                          Enable
                        </label>
                      </div>
                      <label className="mb-1 flex items-center gap-2 text-[10px] text-blue-800">
                        <input type="checkbox" className="h-3 w-3" checked={calClip} onChange={e=>setCalClipForBg(activeBg, e.target.checked)} />
                        Clip outside calibration rectangle (이미지가 작아보이면 OFF)
                      </label>
                      <p className="mb-1 text-[10px] text-blue-700">X/Y 점 선택 후 값 입력. 점 클릭 재선택 가능, 화살표로 미세 이동.</p>
                      <div className="grid grid-cols-[auto,1fr,auto] gap-1">
                        {["x1","x2","y1","y2"].map((k) => (
                          <Fragment key={k}>
                            <button
                              onClick={()=>{ setCalPick(k as CalPickKey); setSelectedCalPoint(k as CalPickKey); notify(`Click ${k.toUpperCase()} point on graph`); }}
                              className={`rounded px-1.5 py-1 text-[10px] font-semibold ${calPick===k||selectedCalPoint===k?"bg-amber-200 text-amber-900":"bg-white border border-blue-200 text-blue-800"}`}>
                              Pick {k.toUpperCase()}
                            </button>
                            <input
                              type="number"
                              className="rounded border px-1.5 py-1 text-[10px]"
                              placeholder={`${k.toUpperCase()} value`}
                              value={calValues[k]}
                              onChange={e=>setCalValuesForBg(activeBg, v=>({ ...v, [k]: e.target.value }))}
                            />
                            <span className={`self-center text-[10px] ${calPixels[k] ? "text-green-700" : "text-gray-400"}`}>
                              {calPixels[k] ? "●" : "○"}
                            </span>
                          </Fragment>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="w-full rounded bg-blue-600 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-700"
                        onClick={() => fitImageToAxesCalibration(activeBg)}>
                        축(Axes) 격자에 이미지 맞춤 (자동)
                      </button>
                      <p className="text-[9px] leading-snug text-blue-800/90">
                        4점·값 기준으로 배경을 스케일·이동해, 해당 데이터 좌표가 Axes에 설정한 Min/Max 격자 위에 오도록 합니다. 캘리브 점은 같은 그래프 위치를 유지하도록 같이 이동합니다.
                      </p>
                      <div className="mt-1 flex gap-1">
                        <button
                          className="rounded bg-gray-200 px-2 py-1 text-[10px] hover:bg-gray-300"
                          onClick={()=>{setCalPick(null); setSelectedCalPoint(null); setCalPixelsForBg(activeBg,{x1:null,x2:null,y1:null,y2:null}); setCalValuesForBg(activeBg,{x1:"",x2:"",y1:"",y2:""}); setCalEnabledForBg(activeBg,false); setCalClipForBg(activeBg,false);}}>
                          Clear Calibration
                        </button>
                        {selectedCalPoint && <span className="self-center text-[10px] text-blue-700">Selected: {selectedCalPoint.toUpperCase()}</span>}
                        {calPick && <span className="self-center text-[10px] text-amber-700">Picking {calPick.toUpperCase()}...</span>}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Series & Points */}
              <div className="rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-gray-800">Series & Points</h3>
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" className="h-3 w-3" checked={magnifyOn} onChange={e=>setMagnifyOn(e.target.checked)}/> Magnifier</label>
                </div>
                <div className="space-y-2 text-xs">
                  {/* active selector */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">Active:</span>
                    {currentState.series.map((s,i)=>(
                      <label key={i} className="flex items-center gap-1">
                        <input type="radio" className="h-3 w-3" name="series" checked={activeSeries===i} onChange={()=>{setActiveSeries(i);setSelectedPoint(null);}}/>
                        <span style={{color:s.color}} className="font-bold">{s.name}</span>
                      </label>
                    ))}
                  </div>

                  {/* series list with name / color / min-break */}
                  <div className="grid grid-cols-1 gap-1.5">
                    {currentState.series.map((s,i)=>(
                      <div key={i} className="flex flex-col gap-0.5 rounded border border-gray-100 p-1">
                        <div className="flex items-center gap-1">
                          <input type="color" className="h-6 w-6 cursor-pointer rounded border-0 p-0" value={s.color} onChange={e=>updateState(p=>({...p,series:p.series.map((ss,si)=>si===i?{...ss,color:e.target.value}:ss)}))}/>
                          <input className="flex-1 rounded border px-1.5 py-0.5 text-xs" value={s.name} onChange={e=>updateState(p=>({...p,series:p.series.map((ss,si)=>si===i?{...ss,name:e.target.value}:ss)}))} placeholder={"Series "+(i+1)}/>
                          {currentState.series.length>1&&(
                            <button className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700 hover:bg-red-200"
                              onClick={()=>{
                                updateState(p=>({...p,series:p.series.filter((_,si)=>si!==i)}));
                                setMinBreakCurrents(prev=>prev.filter((_,mi)=>mi!==i));
                                setMinBreakInputs(prev=>{const next={};Object.entries(prev).forEach(([k,v])=>{const ki=Number(k);if(ki!==i)next[ki>i?ki-1:ki]=v;});return next;});
                                if(activeSeries>=i&&activeSeries>0)setActiveSeries(activeSeries-1);
                              }}>x</button>
                          )}
                        </div>
                        {/* Min breaking current */}
                        <div className="flex items-center gap-1 pl-1">
                          <span className="text-[10px] text-gray-500">Min I (dashed below):</span>
                          <input
                            type="text"
                            className="w-20 rounded border px-1 py-0.5 text-[10px] font-mono"
                            placeholder="none"
                            value={minBreakInputs[i]??(minBreakCurrents[i]!=null?String(minBreakCurrents[i]):"")}
                            onChange={e=>{
                              const v=e.target.value;
                              setMinBreakInputs(prev=>({...prev,[i]:v}));
                              const n=Number(v.replace(/,/g,""));
                              setMinBreakCurrents(prev=>{const next=[...prev];next[i]=(v.trim()===""?null:(isFinite(n)&&n>0?n:prev[i]));return next;});
                            }}
                          />
                          {minBreakCurrents[i]!=null&&(
                            <button className="text-[10px] text-gray-400 hover:text-red-500"
                              onClick={()=>{setMinBreakCurrents(prev=>{const n=[...prev];n[i]=null;return n;});setMinBreakInputs(prev=>{const n={...prev};delete n[i];return n;});}}>x</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {currentState.series.length<MAX_SERIES&&(
                    <button className="w-full rounded border border-dashed border-gray-400 py-1 text-xs text-gray-600 hover:bg-gray-50"
                      onClick={()=>{
                        const idx=currentState.series.length;
                        updateState(p=>({...p,series:[...p.series,{name:SERIES_NAMES[idx]??"S"+(idx+1),color:SERIES_COLORS[idx]??"#64748B",points:[]}]}));
                        setMinBreakCurrents(prev=>[...prev,null]);
                        setActiveSeries(idx);
                      }}>+ Add Series ({currentState.series.length}/{MAX_SERIES})</button>
                  )}


                  <div className="!mt-2 grid grid-cols-2 gap-x-2 gap-y-2 border-t border-gray-200 pt-2">
                    <label className="col-span-2 flex items-center gap-2"><input type="checkbox" className="h-3 w-3" checked={connectLines} onChange={e=>setConnectLines(e.target.checked)}/> Connect points</label>
                    <label className="flex items-center gap-1">Width <input className="w-full rounded border px-1 py-0.5 text-xs" value={lineWidth} onChange={e=>setLineWidth(Number(e.target.value)||1)}/></label>
                    <label className="flex items-center gap-1">Alpha <input type="range" className="w-full" min={0} max={1} step={0.05} value={lineAlpha} onChange={e=>setLineAlpha(Number(e.target.value))}/></label>
                    <label className="col-span-2 flex items-center gap-2"><input type="checkbox" className="h-3 w-3" checked={smoothLines} onChange={e=>setSmoothLines(e.target.checked)}/> Smooth</label>
                    {smoothLines&&<label className="col-span-2 flex items-center gap-2">Strength <input type="range" min={0} max={0.9} step={0.05} className="w-full" value={smoothAlpha} onChange={e=>setSmoothAlpha(Number(e.target.value))}/></label>}
                    <label className="col-span-2 !mt-2 flex items-center gap-2 border-t border-gray-200 pt-2"><input type="checkbox" className="h-3 w-3" checked={showPoints} onChange={e=>setShowPoints(e.target.checked)}/> Show points</label>
                    <label className="col-span-2 flex items-center gap-2">Size <input type="range" className="w-full" min={1} max={8} step={1} value={ptRadius} onChange={e=>setPtRadius(Number(e.target.value))}/></label>
                  </div>
                </div>
              </div>
            </>
          )}
        </aside>

        <div className={`grid grid-cols-1 gap-3 ${showI2tGraph?"lg:grid-cols-2":"lg:grid-cols-1"} col-span-1`}>
          {/* Main graph */}
          <div className="rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
            <div className="mb-2 flex items-center gap-2">
              <label className="flex items-center gap-2 text-xs font-semibold">
                <input type="checkbox" className="h-4 w-4" checked={showI2tGraph} onChange={e=>setShowI2tGraph(e.target.checked)}/>
                Show I2t Lifetime Graph
              </label>
            </div>
            <div className="mb-2 h-4 text-xs text-gray-600">
              {hoverRef.current.x!==null
                ?<span className="font-mono">Cursor: X={fmtReal(hoverRef.current.x)} , Y={fmtReal(hoverRef.current.y)}</span>
                :<span>Hover over graph to see coordinates.</span>}
            </div>
            <div className="overflow-hidden rounded-lg border border-gray-300">
              <canvas ref={canvasRef} width={size.w} height={size.h} className="block touch-none select-none"
                style={{cursor:cursorForHandle(hoverHandle,bgEditMode,pickAnchor,calPick)}}
                onMouseMove={onMouseMove} onMouseDown={onMouseDown} onMouseUp={onMouseUp} onMouseLeave={onMouseLeave}
                onDragOver={e=>e.preventDefault()}
                onDrop={e=>{e.preventDefault();const f=e.dataTransfer?.files?.[0];if(f&&/^image\//.test(f.type))onFile(f,activeBg);}}
                onContextMenu={e=>{e.preventDefault();if(pickAnchor)setPickAnchor(false);}}
              />
            </div>

            {/* Points + Guides row */}
            <div className="mt-2 grid grid-cols-2 gap-2 border-t border-gray-200 pt-2">
              <div>
                {/* 헤더 */}
                <div className="mb-1 flex items-center justify-between gap-1">
                  <div className="text-xs font-semibold">
                    Points — <span style={{color:currentState.series[activeSeries]?.color}}>{currentState.series[activeSeries]?.name}</span>
                    <span className="ml-1 text-gray-400">({currentState.series[activeSeries]?.points.length})</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <label className="flex items-center gap-1 text-[10px] text-gray-500 cursor-pointer">
                      <input type="checkbox" className="h-3 w-3" checked={showRealCoords} onChange={e=>setShowRealCoords(e.target.checked)}/> 실제값
                    </label>
                    <button onClick={()=>copyPointsToClipboard()}
                      className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700 hover:bg-green-200"
                      title="모든 포인트를 Excel 형식으로 클립보드에 복사">📋 복사</button>
                  </div>
                </div>

                {/* 스프레드시트 테이블 */}
                <div className="overflow-y-auto rounded border border-gray-300 bg-white" style={{maxHeight:"220px",scrollbarWidth:"thin"}}>
                  <table className="w-full border-collapse text-xs">
                    <thead className="sticky top-0 z-10 bg-gray-100">
                      <tr>
                        <th className="border-b border-gray-300 px-1 py-1 text-center text-[10px] font-semibold text-gray-500 w-5 select-none">#</th>
                        <th className="border-b border-gray-300 px-1 py-1 text-center text-[10px] font-semibold text-gray-600">
                          {showRealCoords ? "X" : (currentState.xLog ? "log₁₀ X" : "X")}
                        </th>
                        <th className="border-b border-gray-300 px-1 py-1 text-center text-[10px] font-semibold text-gray-600">
                          {showRealCoords ? "Y" : (currentState.yLog ? "log₁₀ Y" : "Y")}
                        </th>
                        <th className="border-b border-gray-300 w-5"/>
                      </tr>
                    </thead>
                    <tbody>
                      {/* 기존 포인트 행 */}
                      {(currentState.series[activeSeries]?.points ?? []).map((p, idx) => {
                        const isSelected = selectedPoint?.seriesIndex===activeSeries && selectedPoint?.pointIndex===idx;
                        const cellCls = "w-full text-right font-mono text-xs bg-transparent focus:bg-blue-50 focus:outline-none px-1 py-0.5";
                        return (
                          <tr key={idx} className={`border-b border-gray-100 ${isSelected ? "bg-blue-50" : "hover:bg-gray-50"}`}>
                            <td className="px-1 text-center text-[10px] text-gray-400 select-none">{idx+1}</td>
                            <td className="border-r border-gray-100 p-0">
                              <input
                                className={cellCls}
                                value={cellDisplayVal(p, idx, 0)}
                                data-ptseries={activeSeries} data-ptrow={idx} data-ptcol={0}
                                onChange={e => setRawEdits(prev => ({...prev, [ptEditKey(idx,0)]: e.target.value}))}
                                onBlur={() => commitCell(idx, 0)}
                                onFocus={() => setSelectedPoint({seriesIndex:activeSeries, pointIndex:idx})}
                                onKeyDown={e => handlePtKeyDown(e, idx, 0)}
                                onPaste={e => handlePtPaste(e, idx, 0)}
                              />
                            </td>
                            <td className="border-r border-gray-100 p-0">
                              <input
                                className={cellCls}
                                value={cellDisplayVal(p, idx, 1)}
                                data-ptseries={activeSeries} data-ptrow={idx} data-ptcol={1}
                                onChange={e => setRawEdits(prev => ({...prev, [ptEditKey(idx,1)]: e.target.value}))}
                                onBlur={() => commitCell(idx, 1)}
                                onFocus={() => setSelectedPoint({seriesIndex:activeSeries, pointIndex:idx})}
                                onKeyDown={e => handlePtKeyDown(e, idx, 1)}
                                onPaste={e => handlePtPaste(e, idx, 1)}
                              />
                            </td>
                            <td className="px-0.5 text-center">
                              <button className="rounded px-1 py-0.5 text-[10px] text-gray-300 hover:bg-red-100 hover:text-red-500"
                                tabIndex={-1}
                                onClick={()=>{updateState(prev=>({...prev,series:prev.series.map((s,si)=>si!==activeSeries?s:({...s,points:s.points.filter((_,pi)=>pi!==idx)}))}));setTick(t=>t+1);}}>✕</button>
                            </td>
                          </tr>
                        );
                      })}
                      {/* 새 포인트 입력 행 */}
                      {(()=>{
                        const pts = currentState.series[activeSeries]?.points ?? [];
                        const newRow = pts.length;
                        const cellCls = "w-full text-right font-mono text-xs bg-transparent focus:bg-yellow-50 focus:outline-none px-1 py-0.5 placeholder-gray-300";
                        return (
                          <tr className="bg-gray-50 border-t-2 border-dashed border-gray-200">
                            <td className="px-1 text-center text-[10px] text-gray-300 select-none">+</td>
                            <td className="border-r border-gray-100 p-0">
                              <input
                                className={cellCls}
                                placeholder="X"
                                value={newPtX}
                                data-ptseries={activeSeries} data-ptrow={newRow} data-ptcol={0}
                                onChange={e => setNewPtX(e.target.value)}
                                onKeyDown={e => handlePtKeyDown(e, newRow, 0, true)}
                                onPaste={e => handlePtPaste(e, newRow, 0)}
                              />
                            </td>
                            <td className="border-r border-gray-100 p-0">
                              <input
                                className={cellCls}
                                placeholder="Y"
                                value={newPtY}
                                data-ptseries={activeSeries} data-ptrow={newRow} data-ptcol={1}
                                onChange={e => setNewPtY(e.target.value)}
                                onKeyDown={e => handlePtKeyDown(e, newRow, 1, true)}
                                onPaste={e => handlePtPaste(e, newRow, 1)}
                              />
                            </td>
                            <td/>
                          </tr>
                        );
                      })()}
                    </tbody>
                  </table>
                </div>
                <p className="mt-0.5 text-[10px] text-gray-400">Tab/Enter: 셀 이동 · 마지막 빈 행에서 Enter: 추가 · Ctrl+V: 다중 행 붙여넣기</p>
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold">Guides</div>
                <div className="flex items-center gap-1">
                  <span className="w-4 text-xs font-semibold text-gray-600">X</span>
                  <input className="flex-grow rounded border px-1.5 py-0.5 text-xs" placeholder="1000" value={guideInput} onChange={e=>setGuideInput(e.target.value)}
                    onKeyDown={e=>{if(e.key==="Enter"){const raw=e.currentTarget.value.trim();const n=Number(raw.replace(/,/g,""));if(isFinite(n)&&n>0){setGuideXs(g=>Array.from(new Set([...g,n])));setGuideXLabels(m=>({...m,[n]:raw}));setGuideInput("");}}}}/>
                  <button className="rounded bg-gray-200 px-1.5 py-0.5 text-xs" onClick={()=>{const raw=guideInput.trim();const n=Number(raw.replace(/,/g,""));if(isFinite(n)&&n>0){setGuideXs(g=>Array.from(new Set([...g,n])));setGuideXLabels(m=>({...m,[n]:raw}));setGuideInput("");}}}>Add</button>
                  <button className="rounded bg-gray-200 px-1.5 py-0.5 text-xs" onClick={()=>{setGuideXs([]);setGuideXLabels({});}}>Clr</button>
                  <label className="ml-auto flex items-center gap-1 text-xs"><input type="checkbox" className="h-3 w-3" checked={showCrossFromX} onChange={e=>setShowCrossFromX(e.target.checked)}/> X</label>
                </div>
                <div className="mt-1 flex items-center gap-1">
                  <span className="w-4 text-xs font-semibold text-gray-600">Y</span>
                  <input className="flex-grow rounded border px-1.5 py-0.5 text-xs" placeholder="10" value={guideYInput} onChange={e=>setGuideYInput(e.target.value)}
                    onKeyDown={e=>{if(e.key==="Enter"){const raw=e.currentTarget.value.trim();const n=Number(raw.replace(/,/g,""));if(isFinite(n)&&n>0){setGuideYs(g=>Array.from(new Set([...g,n])));setGuideYLabels(m=>({...m,[n]:raw}));setGuideYInput("");}}}}/>
                  <button className="rounded bg-gray-200 px-1.5 py-0.5 text-xs" onClick={()=>{const raw=guideYInput.trim();const n=Number(raw.replace(/,/g,""));if(isFinite(n)&&n>0){setGuideYs(g=>Array.from(new Set([...g,n])));setGuideYLabels(m=>({...m,[n]:raw}));setGuideYInput("");}}}>Add</button>
                  <button className="rounded bg-gray-200 px-1.5 py-0.5 text-xs" onClick={()=>{setGuideYs([]);setGuideYLabels({});}}>Clr</button>
                  <label className="ml-auto flex items-center gap-1 text-xs"><input type="checkbox" className="h-3 w-3" checked={showCrossFromY} onChange={e=>setShowCrossFromY(e.target.checked)}/> Y</label>
                </div>
                <div className="mt-2 max-h-24 overflow-y-auto" style={{scrollbarWidth:"thin"}}>
                  {guideRows.length===0?<span className="text-xs text-gray-400">No guides</span>:(
                    <div className="flex flex-wrap gap-1.5">
                      {guideRows.map((r,i)=>(
                        <div key={i} className="flex items-center gap-1 rounded border border-gray-300 px-2 py-0.5">
                          <span className="text-[10px] text-gray-500">{r.kind}={r.guideLabel}</span>
                          <span className="text-[10px] text-gray-400">,</span>
                          <span className="text-[10px] text-gray-500">{r.series}:</span>
                          <span className="text-xs font-mono">{fmtReal(r.value)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* intersections panel */}
            {seriesIntersections.length>0&&(
              <div className="mt-2 border-t border-orange-200 pt-2">
                <div className="mb-1 flex items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-full bg-orange-500"/>
                  <span className="text-xs font-semibold text-orange-700">Line Intersections ({seriesIntersections.length})</span>
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto" style={{scrollbarWidth:"thin"}}>
                  {seriesIntersections.map((inter,i)=>{
                    const s1=currentState.series[inter.si],s2=currentState.series[inter.sj];
                    return (
                      <div key={i} className="flex items-center gap-1 rounded border border-orange-300 bg-orange-50 px-2 py-0.5">
                        <span className="text-[10px] font-bold" style={{color:s1.color}}>{s1.name}</span>
                        <span className="text-[10px] text-orange-500">x</span>
                        <span className="text-[10px] font-bold" style={{color:s2.color}}>{s2.name}</span>
                        <span className="text-[10px] text-gray-400 mx-0.5">:</span>
                        <span className="text-xs font-mono">({fmtReal(inter.x)}, {fmtReal(inter.y)})</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* I2t graph */}
          {showI2tGraph&&(
            <div className="rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
              <div className="mb-2 flex items-center justify-between h-4 text-xs font-semibold text-gray-600">
                <span>I2t Lifetime Graph</span>
                <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" className="h-3 w-3" checked={i2tFixedRange} onChange={e=>setI2tFixedRange(e.target.checked)}/> Fixed range</label>
              </div>
              <div className="overflow-hidden rounded-lg border border-gray-300">
                <canvas ref={i2tCanvasRef} width={size.w} height={size.h} className="block touch-none select-none"/>
              </div>
              <div className="mt-2 space-y-2 border-t border-gray-200 pt-2">
                <div className="flex items-center gap-3 text-xs">
                  <label className="flex items-center gap-1"><input type="radio" className="h-3 w-3" name="lifeMode2" checked={lifetimeMode==="I_mode"} onChange={()=>setLifetimeMode("I_mode")}/> I mode</label>
                  <label className="flex items-center gap-1"><input type="radio" className="h-3 w-3" name="lifeMode2" checked={lifetimeMode==="I2t_mode"} onChange={()=>setLifetimeMode("I2t_mode")}/> I2t mode</label>
                </div>
                <div className="text-xs font-semibold">N levels:</div>
                <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto" style={{scrollbarWidth:"thin"}}>
                  {lifetimeCycles.map((cycle,idx)=>(
                    <label key={idx} className="flex items-center gap-1 rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50">
                      <input type="checkbox" className="h-3 w-3" checked={selectedLifetimeCycles.has(cycle)} onChange={e=>{const s=new Set(selectedLifetimeCycles);e.target.checked?s.add(cycle):s.delete(cycle);setSelectedLifetimeCycles(s);}}/>
                      <span className="text-xs">{cycle.toLocaleString()}</span>
                    </label>
                  ))}
                </div>
                {/* 라인 설정값 - 로그인 사용자만 표시 */}
                {loggedInUser&&(
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-gray-500">라인 설정값</span>
                      <span className="text-[10px] text-green-600 font-semibold">🔓 {loggedInUser}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px]">
                      <label className="flex items-center gap-1"><input type="checkbox" className="h-3 w-3" checked={enterCurrents} onChange={e=>setEnterCurrents(e.target.checked)}/> Enter currents</label>
                      {enterCurrents&&<span className="text-gray-500">(base {(LIFE_CURRENT_BASE/1000).toFixed(2)} kA)</span>}
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto" style={{scrollbarWidth:"thin"}}>
                      {lifetimeCycles.map((cycle,idx)=>{
                        const m=currentMultipliers[idx]??1, ratio=lifetimeRatios[idx]??1;
                        return (
                          <div key={idx} className="flex items-center gap-1 rounded border border-gray-300 px-2 py-0.5">
                            <span className="text-xs text-gray-500">{cycle}:</span>
                            {lifetimeMode==="I_mode"?(
                              enterCurrents
                                ?<input type="text" className="w-20 text-xs font-mono border-0 bg-transparent focus:bg-white focus:border focus:border-blue-300 rounded px-1"
                                    value={currentInputs[idx]??(m*LIFE_CURRENT_BASE).toFixed(3)}
                                    onChange={e=>{const v=e.target.value;setCurrentInputs(s=>({...s,[idx]:v}));const n=Number(v);if(isFinite(n)&&n>0){const nm=[...currentMultipliers];nm[idx]=n/LIFE_CURRENT_BASE;setCurrentMultipliers(nm);setTick(t=>t+1);}}}/>
                                :<input type="text" className="w-16 text-xs font-mono border-0 bg-transparent focus:bg-white focus:border focus:border-blue-300 rounded px-1"
                                    value={multiplierInputs[idx]??m.toFixed(3)}
                                    onChange={e=>{const v=e.target.value;setMultiplierInputs(s=>({...s,[idx]:v}));const n=Number(v);if(isFinite(n)&&n>0){const nm=[...currentMultipliers];nm[idx]=n;setCurrentMultipliers(nm);setTick(t=>t+1);}}}/>
                            ):(
                              <input type="text" className="w-16 text-xs font-mono border-0 bg-transparent focus:bg-white focus:border focus:border-blue-300 rounded px-1"
                                value={ratio.toFixed(3)} onChange={e=>{const n=Number(e.target.value);if(isFinite(n)&&n>0){const nr=[...lifetimeRatios];nr[idx]=n;setLifetimeRatios(nr);setTick(t=>t+1);}}}/>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
              <div className="mt-2 space-y-2 border-t border-gray-200 pt-2">
                <div className="text-xs font-semibold">Lifetime satisfaction check</div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <label className="flex items-center gap-1">I(A)<input type="text" className="w-24 rounded border px-1 py-0.5 text-xs" value={lifeIInput} onChange={e=>{const v=e.target.value;setLifeIInput(v);const n=Number(v);if(isFinite(n)&&n>=0)setLifeCheckI(n);}}/></label>
                  <label className="flex items-center gap-1">t(s)<input type="text" className="w-24 rounded border px-1 py-0.5 text-xs" value={lifeTInput} onChange={e=>{const v=e.target.value;setLifeTInput(v);const n=Number(v);if(isFinite(n)&&n>=0)setLifeCheckT(n);}}/></label>
                  <span className="text-[11px] text-gray-500">I2t={(isFinite(lifeCheckI)&&isFinite(lifeCheckT)&&lifeCheckI>0&&lifeCheckT>0?(lifeCheckI*lifeCheckI*lifeCheckT).toExponential(2):"-")}</span>
                </div>
                <div className="text-xs">
                  {(()=>{
                    const s=currentState.series[activeSeries];
                    if(!s||s.points.length<2||!(lifeCheckI>0)||!(lifeCheckT>0)) return "Enter values above.";
                    const samples=s.points.map(p=>({t:p.y,i:p.x})).filter(v=>v.t>0&&v.i>0).sort((a,b)=>a.t-b.t);
                    if(samples.length<2) return "Not enough data.";
                    const base=samples.map(x=>({x:x.t,y:x.i*x.i*x.t}));
                    const interp=tx=>{for(let i=0;i<base.length-1;i++){const a=base[i],b=base[i+1];if((a.x<=tx&&tx<=b.x)||(b.x<=tx&&tx<=a.x)){const t=(tx-a.x)/((b.x-a.x)||1e-12);return a.y+t*(b.y-a.y);}}return NaN;};
                    const yb=interp(lifeCheckT); if(!isFinite(yb)) return "t out of range.";
                    const inputY=lifeCheckI*lifeCheckI*lifeCheckT;
                    const table=lifetimeCycles.map((cy,idx)=>({N:cy,enabled:selectedLifetimeCycles.has(cy),y:yb*(lifetimeMode==="I_mode"?Math.pow(currentMultipliers[idx]??1,2):(lifetimeRatios[idx]??1))})).filter(r=>r.enabled).sort((a,b)=>a.y-b.y);
                    if(table.length===0) return "No curves selected.";
                    let Nest=null;
                    if(inputY<=table[0].y)Nest=table[0].N;
                    else if(inputY>=table[table.length-1].y)Nest=table[table.length-1].N;
                    else{for(let i=0;i<table.length-1;i++){const a=table[i],b=table[i+1];if(a.y<=inputY&&inputY<=b.y){const f=(inputY-a.y)/((b.y-a.y)||1e-12);Nest=a.N+f*(b.N-a.N);break;}}}
                    return Nest!=null?"Est. lifetime: N~"+Math.round(Nest).toLocaleString():"Interpolation failed.";
                  })()}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Product Library Modal */}
      {showLibrary&&(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={e=>{if(e.target===e.currentTarget)setShowLibrary(false);}}>
          <div className="relative flex flex-col bg-white rounded-xl shadow-2xl w-[780px] max-h-[85vh]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h2 className="text-base font-bold text-gray-900">Product Library</h2>
              <button onClick={()=>setShowLibrary(false)} className="text-gray-400 hover:text-gray-700 text-xl leading-none font-bold">x</button>
            </div>
            {!serverAvail?(
              <div className="p-10 text-center text-gray-500 text-sm space-y-3">
                <div className="text-3xl">&#128274;</div>
                <p className="font-semibold text-gray-700">Server not running</p>
                <p>Run the command below in the project folder:</p>
                <code className="inline-block bg-gray-100 rounded px-3 py-1.5 font-mono text-xs text-gray-800">npm run server</code>
                <div className="pt-2"><button onClick={fetchLibrary} className="rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm hover:bg-indigo-700">Retry</button></div>
              </div>
            ):(
              <div className="flex flex-1 overflow-hidden min-h-0">
                {/* Save panel */}
                <div className="w-56 flex-shrink-0 border-r border-gray-200 p-3 flex flex-col gap-2 text-xs">
                  <p className="font-semibold text-gray-700 text-[11px] uppercase tracking-wide">Save Product</p>
                  <input className="rounded border border-gray-300 px-2 py-1.5 text-xs" placeholder="Company" value={saveFormCompany} onChange={e=>setSaveFormCompany(e.target.value)}/>
                  <input className="rounded border border-gray-300 px-2 py-1.5 text-xs" placeholder="Product name" value={saveFormName} onChange={e=>setSaveFormName(e.target.value)}/>
                  <p className="text-[10px] text-gray-400">이미지 슬롯(A–E)별로 곡선·배경이 함께 저장됩니다. 같은 회사·제품명은 슬롯마다 따로 보관됩니다.</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {Array.from({ length: MAX_SERIES }, (_, slot) => (
                      <button key={slot} onClick={()=>saveToLibrary(slot)}
                        className="rounded py-2 text-[11px] font-bold transition-opacity hover:opacity-80"
                        style={{background:SERIES_COLORS[slot]+"22",color:SERIES_COLORS[slot],border:`1.5px solid ${SERIES_COLORS[slot]}88`}}>
                        Save {SERIES_NAMES[slot]}
                      </button>
                    ))}
                  </div>
                  <div className="mt-auto border-t border-gray-200 pt-2">
                    <input className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs" placeholder="Filter company..." value={libFilter} onChange={e=>setLibFilter(e.target.value)}/>
                  </div>
                </div>
                {/* Product list */}
                <div className="flex-1 overflow-y-auto p-3 text-xs" style={{scrollbarWidth:"thin"}}>
                  {libraryItems.length===0?(
                    <div className="text-center text-gray-400 mt-12 space-y-2">
                      <div className="text-3xl">&#128230;</div>
                      <p>No products saved yet.</p>
                      <p className="text-[10px]">Save a product on the left to see it here.</p>
                    </div>
                  ):(()=>{
                    const filtered=libraryItems.filter(p=>!libFilter||p.company.toLowerCase().includes(libFilter.toLowerCase())||p.name.toLowerCase().includes(libFilter.toLowerCase()));
                    const companies=[...new Set(filtered.map(p=>p.company))].sort();
                    return companies.length===0?(
                      <p className="text-gray-400 text-center mt-8">No results</p>
                    ):companies.map(company=>(
                      <div key={company} className="mb-4">
                        <h3 className="font-bold text-gray-600 mb-1.5 text-[10px] uppercase tracking-widest border-b border-gray-100 pb-1">{company}</h3>
                        <div className="space-y-1">
                          {filtered.filter(p=>p.company===company).map(p=>(
                            <div key={p.id} className="flex items-center gap-2 p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{background:p.seriesColor??'#888'}}/>
                              <div className="flex-1 min-w-0">
                                <div className="font-semibold truncate">{p.name}</div>
                                <div className="text-[10px] text-gray-400 flex flex-wrap gap-x-2 gap-y-0.5">
                                  <span>{new Date(p.savedAt).toLocaleDateString('ko-KR')}</span>
                                  <span>{p.points?.length??0}pts</span>
                                  {p.sourceSlot!=null&&<span>슬롯 {SERIES_NAMES[p.sourceSlot]??p.sourceSlot}</span>}
                                  {p.minBreakCurrent&&<span>min-I:{p.minBreakCurrent}</span>}
                                  {p.imageData!==undefined?<span>&#128247;</span>:''}
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-1 justify-end max-w-[200px]">
                              {Array.from({ length: MAX_SERIES }, (_, slot) => (
                              <button key={slot} onClick={()=>loadFromLibrary(p.id,slot)} title={'Load to slot '+SERIES_NAMES[slot]}
                                className="rounded px-1.5 py-0.5 text-[10px] font-bold hover:opacity-90 flex-shrink-0 border"
                                style={{background:SERIES_COLORS[slot]+"22",color:SERIES_COLORS[slot],borderColor:SERIES_COLORS[slot]+"88"}}>&#8594;{SERIES_NAMES[slot]}</button>
                              ))}
                              </div>
                              <button onClick={()=>deleteFromLibrary(p.id)} title="Delete"
                                className="rounded bg-red-100 text-red-600 px-2 py-1 text-[10px] hover:bg-red-200 flex-shrink-0">Del</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 로그인 모달 */}
      {showLoginModal&&(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={e=>{if(e.target===e.currentTarget){setShowLoginModal(false);setLoginError(false);}}}>
          <div className="w-80 rounded-2xl bg-white shadow-2xl p-6 space-y-4">
            <h2 className="text-base font-bold text-gray-900 text-center">관리자 로그인</h2>
            <div className="space-y-2">
              <input
                type="text"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                placeholder="아이디"
                value={loginUserInput}
                onChange={e=>{setLoginUserInput(e.target.value);setLoginError(false);}}
                onKeyDown={e=>e.key==="Enter"&&document.getElementById("login-pw-input")?.focus()}
                autoFocus
              />
              <input
                id="login-pw-input"
                type="password"
                className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${loginError?"border-red-400 bg-red-50 focus:border-red-500":"border-gray-300 focus:border-blue-500"}`}
                placeholder="비밀번호"
                value={loginPwInput}
                onChange={e=>{setLoginPwInput(e.target.value);setLoginError(false);}}
                onKeyDown={e=>{
                  if(e.key==="Enter"){
                    if(loginUserInput==="admin"&&loginPwInput==="3150"){
                      setLoggedInUser(loginUserInput);setShowLoginModal(false);notify("로그인 성공");
                    } else { setLoginError(true); }
                  }
                }}
              />
              {loginError&&<p className="text-xs text-red-500 text-center">아이디 또는 비밀번호가 올바르지 않습니다.</p>}
            </div>
            <div className="flex gap-2">
              <button
                className="flex-1 rounded-lg bg-gray-100 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-200"
                onClick={()=>{setShowLoginModal(false);setLoginError(false);}}>취소</button>
              <button
                className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                onClick={()=>{
                  if(loginUserInput==="admin"&&loginPwInput==="3150"){
                    setLoggedInUser(loginUserInput);setShowLoginModal(false);notify("로그인 성공");
                  } else { setLoginError(true); }
                }}>로그인</button>
            </div>
          </div>
        </div>
      )}

      {toast&&<div className="fixed bottom-6 right-6 rounded-xl bg-gray-900 px-5 py-3 text-lg text-white shadow-lg">{toast.msg}</div>}
    </div>
  );
}
