/* @ts-nocheck */
import { useEffect, useRef, useState } from "react";

/**
 * Log-scale Graph Digitizer — single file
 * v4.3
 * - 이미지 커스텀 앵커 모드에서도 드래그/오프셋 정상 반영
 * - Guides: 입력 원문(라벨) 보존/표시
 * - Points: 시리즈별 정렬(A→B), 각 시리즈 내부 x 오름차순
 * - Guides 표 폭/줄바꿈 개선(table-fixed, w-*, whitespace-nowrap, overflow-x-auto)
 */

type Pt = { x: number; y: number };
type Series = { name: string; color: string; points: Pt[]; derived?: boolean };
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
  /* ==== Refs / UI ==== */
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileARef = useRef<HTMLInputElement | null>(null);
  const fileBRef = useRef<HTMLInputElement | null>(null);
  const presetFileRef = useRef<HTMLInputElement | null>(null);
  const excelFileRef = useRef<HTMLInputElement | null>(null);

  const bgRefs = useRef<[HTMLImageElement | null, HTMLImageElement | null]>([null, null]);
  const bgUrls = useRef<[string | null, string | null]>([null, null]);
  const lastRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const hoverRef = useRef<{ x: number | null; y: number | null }>({ x: null, y: null });

  const [size] = useState({ w: 960, h: 560 });
  const [pad] = useState({ left: 60, right: 20, top: 30, bottom: 46 });
  const [axesOpen, setAxesOpen] = useState(true);
  const [convertedSeries, setConvertedSeries] = useState<Series[]>([]);
  const [i2tConfig, setI2tConfig] = useState<
    { sourceIndex: number; refX: number; drops: { blue: number; green: number; red: number } }
  | null>(null);
  const [i2tSourceIndex, setI2tSourceIndex] = useState(0);
  const [i2tRefX, setI2tRefX] = useState("");
  const [i2tBlueDrop, setI2tBlueDrop] = useState(0);
  const [i2tGreenDrop, setI2tGreenDrop] = useState(20);
  const [i2tRedDrop, setI2tRedDrop] = useState(40);

  const COLOR_POOL = ["#2563EB", "#10B981", "#F97316", "#EF4444", "#8B5CF6", "#0EA5E9", "#14B8A6", "#F59E0B", "#EC4899", "#64748B"];
  const I2T_COLORS = { blue: "#1D4ED8", green: "#059669", red: "#DC2626" } as const;
  const colorForIndex = (idx: number) => COLOR_POOL[idx % COLOR_POOL.length];

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

  useEffect(() => {
    const count = currentState?.series?.length ?? 0;
    if (count === 0) return;
    if (activeSeries >= count) setActiveSeries(Math.max(0, count - 1));
    if (i2tSourceIndex >= count) setI2tSourceIndex(Math.max(0, count - 1));
  }, [currentState, activeSeries, i2tSourceIndex]);

  const baseSeries = currentState?.series ?? [];
  const allSeries = [...baseSeries, ...convertedSeries];

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

  useEffect(() => {
    if (!i2tConfig || !currentState) {
      setConvertedSeries([]);
      return;
    }
    const source = baseSeries[i2tConfig.sourceIndex];
    if (!source) {
      setConvertedSeries([]);
      return;
    }
    const computed = buildI2TSeries(source, i2tConfig.drops, i2tConfig.refX);
    setConvertedSeries(computed);
  }, [currentState, i2tConfig]);

  /* ==== 유틸 ==== */
  const notify = (msg: string, kind: "ok" | "err" = "ok") => {
    setToast({ msg, kind });
    window.clearTimeout((notify as any)._t);
    (notify as any)._t = window.setTimeout(() => setToast(null), 1500);
  };

  const sanitizeNumber = (value: any) => {
    if (typeof value === "string") {
      const cleaned = value.replace(/,/g, "").trim();
      if (cleaned === "") return null;
      value = cleaned;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  const interpolateLinear = (pts: Pt[], targetX: number) => {
    if (!pts.length || !Number.isFinite(targetX)) return null;
    const sorted = [...pts].sort((a, b) => a.x - b.x);
    if (targetX <= sorted[0].x) return sorted[0].y;
    if (targetX >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y;
    for (let i = 0; i < sorted.length - 1; i++) {
      const p1 = sorted[i], p2 = sorted[i + 1];
      if (targetX >= p1.x && targetX <= p2.x) {
        const t = (targetX - p1.x) / ((p2.x - p1.x) || EPS);
        return p1.y + t * (p2.y - p1.y);
      }
    }
    return null;
  };

  const buildI2TSeries = (
    source: Series,
    drops: { blue: number; green: number; red: number },
    refX: number
  ): Series[] => {
    const pts = (source.points || [])
      .map(p => ({ x: Number(p.x), y: Number(p.y) }))
      .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x > 0);
    if (!pts.length || !Number.isFinite(refX)) return [];

    const sorted = [...pts].sort((a, b) => a.x - b.x);
    const converted = sorted
      .map(p => ({ x: p.x, y: p.y * p.y * p.x }))
      .filter(p => Number.isFinite(p.y) && p.y > 0);
    if (!converted.length) return [];

    const refVal = interpolateLinear(converted, refX);
    if (refVal == null || !Number.isFinite(refVal) || refVal <= 0) return [];

    const combos = [
      { key: "blue", drop: drops.blue, color: I2T_COLORS.blue, label: "Blue" },
      { key: "green", drop: drops.green, color: I2T_COLORS.green, label: "Green" },
      { key: "red", drop: drops.red, color: I2T_COLORS.red, label: "Red" },
    ] as const;

    const seen = new Set<string>();
    const results: Series[] = [];
    combos.forEach((combo, index) => {
      let drop = Number(combo.drop);
      if (!Number.isFinite(drop)) drop = 0;
      const factor = 1 - drop / 100;
      if (factor <= 0) return;
      const key = factor.toFixed(6);
      if (seen.has(key)) return;
      seen.add(key);
      const scaled = converted.map(pt => ({ x: pt.x, y: pt.y * factor }));
      const dropLabel = drop === 0 ? "0%" : `${drop > 0 ? "-" : "+"}${Math.abs(drop)}%`;
      results.push({
        name: `${source.name} I²T ${combo.label} (${dropLabel})`,
        color: combo.color,
        points: scaled,
        derived: true,
      });
    });
    return results;
  };

  const parseDelimitedText = (text: string, delimiter = ",") => {
    const rows: string[][] = [];
    let field = "";
    let row: string[] = [];
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === "\"") {
          if (text[i + 1] === "\"") { field += "\""; i++; }
          else { inQuotes = false; }
        } else {
          field += ch;
        }
      } else {
        if (ch === "\"") { inQuotes = true; }
        else if (ch === delimiter) { row.push(field); field = ""; }
        else if (ch === "\r") { continue; }
        else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
        else { field += ch; }
      }
    }
    row.push(field);
    rows.push(row);
    return rows.filter(r => r.some(cell => (cell ?? "").trim() !== ""));
  };

  const parseXLSXFile = async (file: File) => {
    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    const dv = new DataView(buffer);
    const textDecoder = new TextDecoder("utf-8");

    const findEOCD = () => {
      const signature = 0x06054b50;
      for (let off = data.length - 22; off >= 0; off--) {
        if (dv.getUint32(off, true) === signature) return off;
      }
      return -1;
    };

    const eocdOffset = findEOCD();
    if (eocdOffset < 0) throw new Error("Invalid XLSX file (no EOCD)");
    const totalEntries = dv.getUint16(eocdOffset + 10, true);
    const centralDirOffset = dv.getUint32(eocdOffset + 16, true);

    const files: Record<string, { offset: number; compressedSize: number }> = {};
    let ptr = centralDirOffset;
    for (let i = 0; i < totalEntries; i++) {
      if (dv.getUint32(ptr, true) !== 0x02014b50) throw new Error("Invalid central directory entry");
      const compressedSize = dv.getUint32(ptr + 20, true);
      const fileNameLength = dv.getUint16(ptr + 28, true);
      const extraLength = dv.getUint16(ptr + 30, true);
      const commentLength = dv.getUint16(ptr + 32, true);
      const localHeaderOffset = dv.getUint32(ptr + 42, true);
      const nameBytes = data.subarray(ptr + 46, ptr + 46 + fileNameLength);
      const name = textDecoder.decode(nameBytes);
      files[name] = { offset: localHeaderOffset, compressedSize };
      ptr += 46 + fileNameLength + extraLength + commentLength;
    }

    const extractFile = async (name: string) => {
      const entry = files[name];
      if (!entry) return null;
      const { offset } = entry;
      if (dv.getUint32(offset, true) !== 0x04034b50) throw new Error("Invalid local file header");
      const compression = dv.getUint16(offset + 8, true);
      const fileNameLength = dv.getUint16(offset + 26, true);
      const extraLength = dv.getUint16(offset + 28, true);
      const compressedSize = dv.getUint32(offset + 18, true);
      const start = offset + 30 + fileNameLength + extraLength;
      const slice = data.subarray(start, start + compressedSize);
      if (compression === 0) return slice.slice();
      if (compression === 8) {
        const stream = new Blob([slice]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        const buffer = await new Response(stream).arrayBuffer();
        return new Uint8Array(buffer);
      }
      throw new Error("Unsupported XLSX compression method");
    };

    const sheetBin = await extractFile("xl/worksheets/sheet1.xml");
    if (!sheetBin) throw new Error("No sheet1.xml found");
    const sharedBin = await extractFile("xl/sharedStrings.xml");

    const parser = new DOMParser();
    const sheetDoc = parser.parseFromString(textDecoder.decode(sheetBin), "application/xml");
    if (sheetDoc.getElementsByTagName("parsererror").length) throw new Error("Cannot parse worksheet XML");

    const sharedStrings: string[] = [];
    if (sharedBin) {
      const sharedDoc = parser.parseFromString(textDecoder.decode(sharedBin), "application/xml");
      const items = Array.from(sharedDoc.getElementsByTagName("si"));
      items.forEach(si => {
        const texts = Array.from(si.getElementsByTagName("t"));
        const combined = texts.map(t => t.textContent ?? "").join("");
        sharedStrings.push(combined);
      });
    }

    const columnToIndex = (col: string) => {
      let idx = 0;
      for (let i = 0; i < col.length; i++) {
        const code = col.charCodeAt(i);
        if (code >= 65 && code <= 90) idx = idx * 26 + (code - 64);
        else if (code >= 97 && code <= 122) idx = idx * 26 + (code - 96);
      }
      return Math.max(0, idx - 1);
    };

    const rows: string[][] = [];
    const sheetData = sheetDoc.getElementsByTagName("sheetData")[0];
    if (!sheetData) return rows;
    const rowNodes = Array.from(sheetData.getElementsByTagName("row"));
    rowNodes.forEach(rowNode => {
      const cells: string[] = [];
      let lastCol = -1;
      const cellNodes = Array.from(rowNode.getElementsByTagName("c"));
      cellNodes.forEach(cell => {
        const ref = cell.getAttribute("r") || "";
        const colLetters = ref.replace(/[0-9]/g, "");
        const colIndex = colLetters ? columnToIndex(colLetters) : lastCol + 1;
        while (cells.length < colIndex) cells.push("");
        let value = "";
        const type = cell.getAttribute("t") || "";
        if (type === "inlineStr") {
          const tNode = cell.getElementsByTagName("t")[0];
          value = tNode?.textContent ?? "";
        } else {
          const vNode = cell.getElementsByTagName("v")[0];
          const raw = vNode?.textContent ?? "";
          if (type === "s") value = sharedStrings[Number(raw)] ?? "";
          else if (type === "b") value = raw === "1" ? "TRUE" : raw === "0" ? "FALSE" : raw;
          else value = raw;
        }
        cells.push(value);
        lastCol = colIndex;
      });
      rows.push(cells);
    });
    return rows;
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

  const handleExcelFile = async (file: File | null) => {
    if (!file) return;
    try {
      const name = (file.name || "").toLowerCase();
      let rows: string[][] = [];
      if (name.endsWith(".tsv")) rows = parseDelimitedText(await file.text(), "\t");
      else if (name.endsWith(".csv") || file.type.includes("csv")) rows = parseDelimitedText(await file.text(), ",");
      else if (name.endsWith(".xlsx") || file.type.includes("spreadsheetml")) rows = await parseXLSXFile(file);
      else if (name.endsWith(".txt")) rows = parseDelimitedText(await file.text(), ",");
      else {
        if (/excel|sheet|spreadsheet/i.test(file.type)) rows = await parseXLSXFile(file);
        else rows = parseDelimitedText(await file.text(), ",");
      }

      if (!rows.length) { notify("데이터를 찾을 수 없습니다.", "err"); return; }

      const headerIndex = rows.findIndex(row => row.some(cell => (cell ?? "").trim() !== ""));
      if (headerIndex < 0) { notify("헤더 행을 찾을 수 없습니다.", "err"); return; }
      const headerRow = rows[headerIndex].map(cell => (cell ?? "").trim());
      const dataRows = rows
        .slice(headerIndex + 1)
        .filter(row => row.some(cell => (cell ?? "").trim() !== ""));
      if (!dataRows.length) { notify("데이터 행이 없습니다.", "err"); return; }

      const lower = headerRow.map(h => h.toLowerCase());
      const findColumn = (names: string[]) => {
        for (let i = 0; i < lower.length; i++) {
          const normalized = lower[i].replace(/\s+/g, " ").trim();
          if (names.includes(normalized)) return i;
        }
        return -1;
      };
      const seriesCol = findColumn(["series", "series name", "name", "group"]);
      const xCol = findColumn(["x", "time", "t", "lifetime", "life", "seconds"]);
      const yCol = findColumn(["y", "current", "i", "amp", "amps", "value"]);

      const deriveName = (hx: any, hy: any, fallback: string) => {
        const clean = (val: any, axis: "x" | "y") => {
          const raw = String(val ?? "").trim();
          if (!raw) return "";
          const lower = raw.toLowerCase();
          if (lower.endsWith(axis)) return raw.slice(0, -1).trim();
          if (lower.endsWith(`(${axis})`)) return raw.slice(0, -(axis.length + 2)).trim();
          if (lower.endsWith(`_${axis}`) || lower.endsWith(`-${axis}`)) return raw.slice(0, -2).trim();
          return raw;
        };
        const candidates = [clean(hx, "x"), clean(hy, "y"), String(hx ?? "").trim(), String(hy ?? "").trim()].filter(Boolean);
        const unique = [...new Set(candidates)];
        return unique[0] || fallback;
      };

      const toPoints = (rows: string[][], xi: number, yi: number) => {
        const pts: Pt[] = [];
        rows.forEach(row => {
          const x = sanitizeNumber(row[xi]);
          const y = sanitizeNumber(row[yi]);
          if (x == null || y == null) return;
          pts.push({ x, y });
        });
        return pts;
      };

      let parsed: Series[] = [];
      if (xCol >= 0 && yCol >= 0) {
        const defaultName = deriveName(headerRow[xCol], headerRow[yCol], "Series 1");
        const seriesMap = new Map<string, Pt[]>();
        const order: string[] = [];
        dataRows.forEach(row => {
          const x = sanitizeNumber(row[xCol]);
          const y = sanitizeNumber(row[yCol]);
          if (x == null || y == null) return;
          let label = defaultName;
          if (seriesCol >= 0) {
            const raw = row[seriesCol];
            const trimmed = raw == null ? "" : String(raw).trim();
            label = trimmed || `Series ${order.length + 1}`;
          }
          if (!seriesMap.has(label)) { seriesMap.set(label, []); order.push(label); }
          seriesMap.get(label)!.push({ x, y });
        });
        parsed = order
          .map((name, idx) => ({
            name,
            color: colorForIndex(idx),
            points: (seriesMap.get(name) || []).sort((a, b) => a.x - b.x),
          }))
          .filter(s => s.points.length > 0);
      }

      if (!parsed.length) {
        const pairs: Series[] = [];
        for (let i = 0; i < headerRow.length; i += 2) {
          const xi = i;
          const yi = i + 1;
          if (yi >= headerRow.length) break;
          const pts = toPoints(dataRows, xi, yi);
          if (!pts.length) continue;
          const name = deriveName(headerRow[xi], headerRow[yi], `Series ${pairs.length + 1}`);
          pairs.push({ name, color: colorForIndex(pairs.length), points: pts.sort((a, b) => a.x - b.x) });
        }
        parsed = pairs;
      }

      if (!parsed.length) { notify("인식할 수 있는 (x, y) 데이터가 없습니다.", "err"); return; }

      const trimmed = parsed.slice(0, 10).map((s, idx) => ({
        ...s,
        color: colorForIndex(idx),
        points: [...s.points].sort((a, b) => a.x - b.x),
        derived: false,
      }));

      updateState(prev => ({
        ...prev,
        series: trimmed,
      }));
      setActiveSeries(0);
      setI2tSourceIndex(0);
      setI2tRefX("");
      setI2tConfig(null);
      notify(`Loaded ${trimmed.length} series from ${file.name}`);
    } catch (err) {
      console.error(err);
      notify("엑셀 파일을 불러오지 못했습니다.", "err");
    }
  };

  const addSeries = () => {
    if (baseSeries.length >= 10) { notify("최대 10개의 시리즈까지 추가할 수 있습니다.", "err"); return; }
    updateState(prev => ({
      ...prev,
      series: [
        ...prev.series,
        { name: `Series ${prev.series.length + 1}`, color: colorForIndex(prev.series.length), points: [] },
      ],
    }));
    setActiveSeries(baseSeries.length);
    setI2tSourceIndex(baseSeries.length);
  };

  const removeSeries = (idx: number) => {
    if (baseSeries.length <= 1) { notify("최소 한 개의 시리즈는 유지해야 합니다.", "err"); return; }
    updateState(prev => ({
      ...prev,
      series: prev.series.filter((_, i) => i !== idx),
    }));
    setSelectedPoint(null);
    setActiveSeries(prev => {
      if (prev === idx) return Math.max(0, prev - 1);
      if (prev > idx) return prev - 1;
      return prev;
    });
    setI2tSourceIndex(prev => {
      if (prev === idx) return Math.max(0, prev - 1);
      if (prev > idx) return prev - 1;
      return prev;
    });
    setI2tConfig(conf => {
      if (!conf) return conf;
      if (conf.sourceIndex === idx) return null;
      if (conf.sourceIndex > idx) return { ...conf, sourceIndex: conf.sourceIndex - 1 };
      return conf;
    });
  };

  const updateSeriesField = (idx: number, key: "name" | "color", value: string) => {
    updateState(prev => ({
      ...prev,
      series: prev.series.map((s, i) => (i === idx ? { ...s, [key]: value } : s)),
    }));
  };

  const handleGenerateI2T = () => {
    const source = baseSeries[i2tSourceIndex];
    if (!source) { notify("I²T 변환에 사용할 시리즈를 선택하세요.", "err"); return; }
    if (!source.points.length) { notify("선택한 시리즈에 데이터가 없습니다.", "err"); return; }
    const refInput = i2tRefX.trim();
    const refValue = refInput === "" ? source.points[source.points.length - 1]?.x ?? NaN : Number(refInput);
    if (!Number.isFinite(refValue)) { notify("기준 X 값이 올바르지 않습니다.", "err"); return; }
    const drops = {
      blue: Number(i2tBlueDrop) || 0,
      green: Number(i2tGreenDrop) || 0,
      red: Number(i2tRedDrop) || 0,
    };
    const computed = buildI2TSeries(source, drops, refValue);
    if (!computed.length) { notify("I²T 곡선을 생성할 수 없습니다. 데이터와 입력값을 확인하세요.", "err"); return; }
    const config = { sourceIndex: i2tSourceIndex, refX: refValue, drops };
    setI2tConfig(config);
    setConvertedSeries(computed);
    setI2tRefX(String(refValue));
    notify(`Generated ${computed.length} I²T curve${computed.length > 1 ? "s" : ""}.`);
  };

  const clearI2T = () => {
    setI2tConfig(null);
    setConvertedSeries([]);
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
        const pt = baseSeries[seriesIndex]?.points[pointIndex];
        if (!pt) return;
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
        allSeries.forEach((s) => {
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
        allSeries.forEach((s) => {
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
      for (const s of allSeries) {
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
      allSeries.forEach((s, si) => {
        ctx.fillStyle = s.color; ctx.strokeStyle = "#fff";
        s.points.forEach((p, pi) => {
          const P = dataToPixel(p.x, p.y);
          ctx.beginPath(); ctx.arc(P.px, P.py, ptRadius, 0, Math.PI * 2); ctx.fill();
          if (ptRadius >= 3) { ctx.lineWidth = 1; ctx.stroke(); }
          if (!s.derived && selectedPoint?.seriesIndex === si && selectedPoint?.pointIndex === pi) {
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
    allSeries.forEach((s, i) => {
      ctx.fillStyle = s.color; ctx.fillRect(lx, ly - box + 2, box, box);
      ctx.fillStyle = "#0f172a"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      const suffix = s.derived ? "  ⧉" : i === activeSeries ? "  ◀" : "";
      ctx.fillText(`${s.name} (${s.points.length})${suffix}`, lx + box + gap, ly + 2);
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
      for (let si = 0; si < baseSeries.length; si++) {
        const series = baseSeries[si];
        if (!series) continue;
        for (let pi = 0; pi < series.points.length; pi++) {
          const p = series.points[pi];
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
    i2t: i2tConfig,
  });

  const applyPreset = (p: any) => {
    try {
      const rawSeries = Array.isArray(p.series) ? p.series : currentState.series;
      const next: AppState = {
        xMin: p.axes?.xMin ?? 10,
        xMax: p.axes?.xMax ?? 1_000_000,
        yMin: p.axes?.yMin ?? 0.0001,
        yMax: p.axes?.yMax ?? 1_000_000,
        xLog: !!p.axes?.xLog,
        yLog: !!p.axes?.yLog,
        series: rawSeries.slice(0, 10).map((s: any, i: number) => ({
          name: s?.name ?? `Series ${i + 1}`,
          color: s?.color ?? colorForIndex(i),
          points: Array.isArray(s?.points)
            ? s.points.map((pt: any) => ({ x: Number(pt.x), y: Number(pt.y) }))
            : [],
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
      setActiveSeries(0);

      const drops = {
        blue: Number(p.i2t?.drops?.blue ?? p.i2t?.blue ?? 0) || 0,
        green: Number(p.i2t?.drops?.green ?? p.i2t?.green ?? 0) || 0,
        red: Number(p.i2t?.drops?.red ?? p.i2t?.red ?? 0) || 0,
      };
      const sourceIndexRaw = Number(p.i2t?.sourceIndex ?? 0);
      const refXRaw = Number(p.i2t?.refX ?? p.i2t?.reference ?? NaN);
      if (next.series.length && p.i2t) {
        const sourceIndex = Math.max(0, Math.min(next.series.length - 1, Number.isFinite(sourceIndexRaw) ? sourceIndexRaw : 0));
        const fallbackRef = next.series[sourceIndex].points[next.series[sourceIndex].points.length - 1]?.x ?? 0;
        const refX = Number.isFinite(refXRaw) ? refXRaw : fallbackRef;
        const config = { sourceIndex, refX, drops };
        setI2tConfig(config);
        setI2tSourceIndex(sourceIndex);
        setI2tRefX(refX ? String(refX) : "");
        setI2tBlueDrop(drops.blue);
        setI2tGreenDrop(drops.green);
        setI2tRedDrop(drops.red);
      } else {
        setI2tConfig(null);
        setConvertedSeries([]);
      }
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
    allSeries.forEach(s => s.points.forEach(p => (out += `${s.name},${p.x},${p.y}\n`)));
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
  }, [currentState, guideXs, guideYs, showCrossFromX, showCrossFromY, keepAspect, showAB, opacityAB, activeBg, i2tConfig]);

  if (!currentState) return <div className="flex h-screen items-center justify-center">Loading...</div>;

  /* ======= 좌표 패널 데이터 ======= */
  // 시리즈별 정렬(A→B), 각 시리즈 내부 x 오름차순
  const pointRows = allSeries
    .map(s => ({ name: s.name, rows: [...s.points].sort((a, b) => a.x - b.x) }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(s => s.rows.map(p => ({ series: s.name, x: p.x, y: p.y })));

  // Guides 표: 입력 라벨 그대로 노출
  const guideRows: Array<{ kind: "X" | "Y"; guide: number; guideLabel: string; series: string; value: number | null }> = [];
  for (const gx of guideXs) {
    const label = guideXLabels[gx] ?? fmtReal(gx);
    allSeries.forEach(s => guideRows.push({ kind: "X", guide: gx, guideLabel: label, series: s.name, value: yAtX(s.points, gx) }));
  }
  for (const gy of guideYs) {
    const label = guideYLabels[gy] ?? fmtReal(gy);
    allSeries.forEach(s => guideRows.push({ kind: "Y", guide: gy, guideLabel: label, series: s.name, value: xAtY(s.points, gy) }));
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
          <button onClick={() => excelFileRef.current?.click()} className="rounded-lg bg-gray-200 px-4 py-2 hover:bg-gray-300">Import Excel/CSV</button>
          <input
            ref={excelFileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0] ?? null;
              await handleExcelFile(f);
              (e.target as any).value = "";
            }}
          />
          <div className="h-6 w-px bg-gray-300" />
          <button onClick={exportCSV} className="rounded-lg bg-gray-200 px-4 py-2 hover:bg-gray-300">Export CSV</button>
          <button onClick={exportPNG} className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700">Export PNG</button>
        </div>
      </header>

      {/* Layout */}
      <main className="grid grid-cols-1 gap-8 p-8 lg:grid-cols-[480px,1fr]">
        {/* Left Panel */}
        <aside className="flex flex-col gap-6">
          {/* Axes */}
          <AccordionSection title="Axes" isOpen={axesOpen} onToggle={() => setAxesOpen(v => !v)}>
            <div className="grid grid-cols-2 gap-4">
              <label className="col-span-2 flex items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={currentState.xLog} onChange={e => updateState(p => ({ ...p, xLog: e.target.checked }))} /> X Log Scale</label>
              <label className="flex items-center gap-3">X Min <input type="number" className="w-full rounded-md border px-3 py-2" value={currentState.xMin} onChange={e => updateState(p => ({ ...p, xMin: Number(e.target.value) }))} /></label>
              <label className="flex items-center gap-3">X Max <input type="number" className="w-full rounded-md border px-3 py-2" value={currentState.xMax} onChange={e => updateState(p => ({ ...p, xMax: Number(e.target.value) }))} /></label>
              <label className="col-span-2 flex items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={currentState.yLog} onChange={e => updateState(p => ({ ...p, yLog: e.target.checked }))} /> Y Log Scale</label>
              <label className="flex items-center gap-3">Y Min <input type="number" className="w-full rounded-md border px-3 py-2" value={currentState.yMin} onChange={e => updateState(p => ({ ...p, yMin: Number(e.target.value) }))} /></label>
              <label className="flex items-center gap-3">Y Max <input type="number" className="w-full rounded-md border px-3 py-2" value={currentState.yMax} onChange={e => updateState(p => ({ ...p, yMax: Number(e.target.value) }))} /></label>
            </div>
          </AccordionSection>

          {/* Image Edit */}
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <button onClick={() => setBgEditMode(v => !v)} className="flex w-full items-center justify-between p-5 text-left">
              <h3 className="text-lg font-bold text-gray-800">Image Edit</h3>
              <span className={`rounded-full px-3 py-1 text-sm font-semibold ${bgEditMode ? "bg-orange-100 text-orange-800" : "bg-gray-200 text-gray-700"}`}>{bgEditMode ? "ON" : "OFF"}</span>
            </button>
            {bgEditMode && (
              <div className="space-y-4 p-5 pt-0 text-base">
                <div className="flex border-b border-gray-200">
                  <button onClick={() => setActiveBg(0)} className={`-mb-px border-b-2 px-4 py-2 text-lg font-semibold ${activeBg === 0 ? "border-blue-500 text-blue-600" : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"}`}>Image A</button>
                  <button onClick={() => setActiveBg(1)} className={`-mb-px border-b-2 px-4 py-2 text-lg font-semibold ${activeBg === 1 ? "border-blue-500 text-blue-600" : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"}`}>Image B</button>
                </div>

                <button onClick={() => (activeBg === 0 ? fileARef : fileBRef).current?.click()} className="w-full rounded-lg bg-gray-800 py-3 text-center font-semibold text-white hover:bg-gray-700">Load Image {activeBg === 0 ? "A" : "B"}</button>
                <input ref={fileARef} type="file" accept="image/*" hidden onChange={(e)=>{const f=e.target.files?.[0]; if(f) onFile(f,0); (e.target as any).value="";}}/>
                <input ref={fileBRef} type="file" accept="image/*" hidden onChange={(e)=>{const f=e.target.files?.[0]; if(f) onFile(f,1); (e.target as any).value="";}}/>

                <div className="grid grid-cols-2 gap-4">
                  <label className="flex items-center justify-between"><span>Show Image</span><input type="checkbox" className="h-5 w-5" checked={showAB[activeBg]} onChange={(e)=>setShowAB(cur=>{const n=[...cur] as [boolean,boolean]; n[activeBg]=e.target.checked; return n;})}/></label>
                  <label className="flex items-center gap-3"><span>Opacity</span><input type="range" min={0} max={1} step={0.05} value={opacityAB[activeBg]} onChange={(e)=>setOpacityAB(cur=>{const n=[...cur] as [number,number]; n[activeBg]=Number(e.target.value); return n;})}/></label>
                  <label className="col-span-2 flex items-center gap-2"><input type="checkbox" checked={keepAspect} onChange={(e)=>setKeepAspect(e.target.checked)}/> Keep Ratio</label>
                  <div className="col-span-2 grid grid-cols-2 gap-3">
                    <button onClick={()=>setPickAnchor(v=>!v)} className={`w-full rounded-lg px-3 py-2 font-semibold ${pickAnchor ? "bg-orange-100 text-orange-800" : "bg-gray-200 text-gray-800"}`}>{pickAnchor ? "Picking Anchor..." : "Pick Anchor"}</button>
                    <button onClick={()=>updateState(prev=>{ const n=[...prev.customAnchors] as [CustomAnchor,CustomAnchor]; n[activeBg]=null; return {...prev, customAnchors:n};})} className="w-full rounded-lg bg-gray-200 px-3 py-2 font-semibold text-gray-800">Clear Anchor</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Series & Points */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-800">Series & Points</h3>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={magnifyOn} onChange={(e)=>setMagnifyOn(e.target.checked)} />
                Magnifier
              </label>
            </div>

            <div className="space-y-5 text-base">
              <div className="flex items-center justify-between gap-3">
                <span className="text-lg font-bold">Series ({baseSeries.length}/10)</span>
                <button
                  onClick={addSeries}
                  disabled={baseSeries.length >= 10}
                  className="rounded-md bg-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Add Series
                </button>
              </div>

              <div className="space-y-3">
                {baseSeries.map((s, idx) => (
                  <div
                    key={idx}
                    className={`rounded-lg border p-3 ${activeSeries === idx ? "border-blue-400 bg-blue-50" : "border-gray-200"}`}
                  >
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 font-semibold text-gray-800">
                        <input
                          type="radio"
                          className="h-4 w-4"
                          name="active-series"
                          checked={activeSeries === idx}
                          onChange={() => { setActiveSeries(idx); setSelectedPoint(null); }}
                        />
                        {s.name || `Series ${idx + 1}`}
                      </label>
                      <span className="ml-auto text-xs text-gray-500">{s.points.length} pts</span>
                      <button
                        onClick={() => removeSeries(idx)}
                        disabled={baseSeries.length <= 1}
                        className="rounded-md bg-gray-200 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="flex flex-col gap-1 text-sm">
                        <span className="text-gray-600">Name</span>
                        <input
                          className="w-full rounded-md border px-3 py-2"
                          value={s.name}
                          onChange={(e)=>updateSeriesField(idx, "name", e.target.value)}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm">
                        <span className="text-gray-600">Color</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            className="h-10 w-12 rounded-md border"
                            value={s.color}
                            onChange={(e)=>updateSeriesField(idx, "color", e.target.value)}
                          />
                          <input
                            className="flex-1 rounded-md border px-3 py-2 font-mono text-sm"
                            value={s.color}
                            onChange={(e)=>updateSeriesField(idx, "color", e.target.value)}
                          />
                        </div>
                      </label>
                    </div>
                  </div>
                ))}
              </div>

              <div className="!mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-gray-200 pt-5">
                <label className="col-span-2 flex items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={connectLines} onChange={(e)=>setConnectLines(e.target.checked)} /> Connect points with a line</label>
                <label className="flex items-center gap-3">Width <input className="w-full rounded-md border px-3 py-2" value={lineWidth} onChange={(e)=>setLineWidth(Number(e.target.value)||1)} /></label>
                <label className="flex items-center gap-3">Alpha <input type="range" className="w-full" min={0} max={1} step={0.05} value={lineAlpha} onChange={(e)=>setLineAlpha(Number(e.target.value))} /></label>
                <label className="col-span-2 flex items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={smoothLines} onChange={(e)=>setSmoothLines(e.target.checked)} /> Smooth curve</label>
                {smoothLines && (<label className="col-span-2 flex items-center gap-3">Strength <input type="range" min={0} max={0.9} step={0.05} className="w-full" value={smoothAlpha} onChange={(e)=>setSmoothAlpha(Number(e.target.value))} /></label>)}
                <label className="col-span-2 !mt-3 flex items-center gap-3 border-t border-gray-200 pt-4"><input type="checkbox" className="h-5 w-5" checked={showPoints} onChange={(e)=>setShowPoints(e.target.checked)} /> Show points</label>
                <label className="col-span-2 flex items-center gap-3">Size <input type="range" className="w-full" min={1} max={8} step={1} value={ptRadius} onChange={(e)=>setPtRadius(Number(e.target.value))} /></label>
              </div>

              {/* Guides (Series 끝) */}
              <div className="!mt-5 space-y-3 border-t border-gray-200 pt-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-gray-600">Guides</h4>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-6 font-semibold text-gray-600">X</span>
                  <input
                    className="flex-grow rounded-md border px-3 py-2"
                    placeholder="e.g., 1,000"
                    value={guideInput}
                    onChange={(e)=>setGuideInput(e.target.value)}
                    onKeyDown={(e)=>{
                      if(e.key==="Enter"){
                        const raw = e.currentTarget.value.trim();
                        const n = Number(raw.replace(/,/g,""));
                        if(isFinite(n) && n>0){
                          setGuideXs(g=>Array.from(new Set([...g,n])));
                          setGuideXLabels(m=>({ ...m, [n]: raw })); // 라벨 보존
                          setGuideInput("");
                        }
                      }
                    }}
                  />
                  <button
                    className="rounded-md bg-gray-200 px-3 py-2 hover:bg-gray-300"
                    onClick={()=>{
                      const raw = guideInput.trim();
                      const n = Number(raw.replace(/,/g,""));
                      if(isFinite(n) && n>0){
                        setGuideXs(g=>Array.from(new Set([...g,n])));
                        setGuideXLabels(m=>({ ...m, [n]: raw }));
                        setGuideInput("");
                      }
                    }}
                  >Add</button>
                  <button className="rounded-md bg-gray-200 px-3 py-2 hover:bg-gray-300" onClick={()=>{setGuideXs([]); setGuideXLabels({});}}>Clear</button>
                  <label className="ml-auto flex items-center gap-2 pl-2"><input type="checkbox" className="h-4 w-4" checked={showCrossFromX} onChange={(e)=>setShowCrossFromX(e.target.checked)} /> Cross</label>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-6 font-semibold text-gray-600">Y</span>
                  <input
                    className="flex-grow rounded-md border px-3 py-2"
                    placeholder="e.g., 10"
                    value={guideYInput}
                    onChange={(e)=>setGuideYInput(e.target.value)}
                    onKeyDown={(e)=>{
                      if(e.key==="Enter"){
                        const raw = e.currentTarget.value.trim();
                        const n = Number(raw.replace(/,/g,""));
                        if(isFinite(n) && n>0){
                          setGuideYs(g=>Array.from(new Set([...g,n])));
                          setGuideYLabels(m=>({ ...m, [n]: raw }));
                          setGuideYInput("");
                        }
                      }
                    }}
                  />
                  <button
                    className="rounded-md bg-gray-200 px-3 py-2 hover:bg-gray-300"
                    onClick={()=>{
                      const raw = guideYInput.trim();
                      const n = Number(raw.replace(/,/g,""));
                      if(isFinite(n) && n>0){
                        setGuideYs(g=>Array.from(new Set([...g,n])));
                        setGuideYLabels(m=>({ ...m, [n]: raw }));
                        setGuideYInput("");
                      }
                    }}
                  >Add</button>
                  <button className="rounded-md bg-gray-200 px-3 py-2 hover:bg-gray-300" onClick={()=>{setGuideYs([]); setGuideYLabels({});}}>Clear</button>
                  <label className="ml-auto flex items-center gap-2 pl-2"><input type="checkbox" className="h-4 w-4" checked={showCrossFromY} onChange={(e)=>setShowCrossFromY(e.target.checked)} /> Cross</label>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-3">
              <h3 className="text-xl font-bold text-gray-800">I²T Conversion</h3>
              <p className="text-sm text-gray-600">Use an I-T curve to build I²T degradation projections with custom drop percentages.</p>
            </div>
            <div className="space-y-4 text-sm">
              <label className="flex flex-col gap-1">
                <span className="text-gray-600">Source series</span>
                <select
                  className="rounded-md border px-3 py-2"
                  value={Math.min(i2tSourceIndex, Math.max(0, baseSeries.length - 1))}
                  onChange={(e)=>setI2tSourceIndex(Number(e.target.value))}
                >
                  {baseSeries.map((s, idx) => (
                    <option key={idx} value={idx}>{s.name || `Series ${idx + 1}`}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-gray-600">Reference X (time / life)</span>
                <input
                  className="rounded-md border px-3 py-2"
                  placeholder="Auto: last X of the source"
                  value={i2tRefX}
                  onChange={(e)=>setI2tRefX(e.target.value)}
                />
              </label>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="flex flex-col gap-1">
                  <span className="font-semibold text-blue-600">Blue drop (%)</span>
                  <input type="number" className="rounded-md border px-3 py-2" value={i2tBlueDrop} onChange={(e)=>setI2tBlueDrop(Number(e.target.value))} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-semibold text-green-600">Green drop (%)</span>
                  <input type="number" className="rounded-md border px-3 py-2" value={i2tGreenDrop} onChange={(e)=>setI2tGreenDrop(Number(e.target.value))} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-semibold text-red-600">Red drop (%)</span>
                  <input type="number" className="rounded-md border px-3 py-2" value={i2tRedDrop} onChange={(e)=>setI2tRedDrop(Number(e.target.value))} />
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button onClick={handleGenerateI2T} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">Generate I²T curves</button>
                <button onClick={clearI2T} disabled={!i2tConfig} className="rounded-md bg-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-50">Clear</button>
                <span className="text-xs text-gray-500">{convertedSeries.length ? `${convertedSeries.length} curve${convertedSeries.length>1?"s":""} active` : "No generated curves yet"}</span>
              </div>
            </div>
          </div>
        </aside>

        {/* Right: Canvas + 좌표 패널 */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 h-6 text-base text-gray-600">
            {hoverRef.current.x !== null ? (
              <span className="font-mono">Cursor: X={fmtReal(hoverRef.current.x)} , Y={fmtReal(hoverRef.current.y)}</span>
            ) : <span>Hover over the graph area to see coordinates.</span>}
          </div>
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

          {/* 좌표 패널 */}
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Points Table */}
            <div className="rounded-lg border border-gray-200">
              <div className="border-b px-4 py-2 font-semibold text-gray-700">Points</div>
              <div className="max-h-64 overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left">Series</th>
                      <th className="px-3 py-2 text-right">X</th>
                      <th className="px-3 py-2 text-right">Y</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pointRows.length === 0 ? (
                      <tr><td className="px-3 py-2 text-gray-400" colSpan={3}>No points</td></tr>
                    ) : pointRows.map((r, i) => (
                      <tr key={i} className="odd:bg-white even:bg-gray-50">
                        <td className="px-3 py-1">{r.series}</td>
                        <td className="px-3 py-1 text-right font-mono whitespace-nowrap">{fmtReal(r.x)}</td>
                        <td className="px-3 py-1 text-right font-mono whitespace-nowrap">{fmtReal(r.y)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Guides Table */}
            <div className="rounded-lg border border-gray-200">
              <div className="border-b px-4 py-2 font-semibold text-gray-700">Guides</div>
              <div className="max-h-64 overflow-auto overflow-x-auto">
                <table className="min-w-full text-sm table-fixed">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left w-28">Type</th>
                      <th className="px-3 py-2 text-right w-40">Guide</th>
                      <th className="px-3 py-2 text-left w-40">Series</th>
                      <th className="px-3 py-2 text-right w-36">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {guideRows.length === 0 ? (
                      <tr><td className="px-3 py-2 text-gray-400" colSpan={4}>No guides</td></tr>
                    ) : guideRows.map((g, i) => (
                      <tr key={i} className="odd:bg-white even:bg-gray-50">
                        <td className="px-3 py-1 w-28">{g.kind === "X" ? "X-guide → y" : "Y-guide → x"}</td>
                        <td className="px-3 py-1 text-right font-mono w-40 whitespace-nowrap">
                          {g.guideLabel}   {/* 입력 원문 그대로 */}
                        </td>
                        <td className="px-3 py-1 w-40">{g.series}</td>
                        <td className="px-3 py-1 text-right font-mono w-36 whitespace-nowrap">
                          {fmtReal(g.value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </main>

      {toast && <div className="fixed bottom-6 right-6 rounded-xl bg-gray-900 px-5 py-3 text-lg text-white shadow-lg">{toast.msg}</div>}
    </div>
  );
}
