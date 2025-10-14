// @ts-nocheck
import { useEffect, useRef, useState } from "react";

/**
 * Log‑scale Graph Digitizer — single file (< 650 lines)
 * 핵심: A/B 배경 이미지(업로드·붙여넣기·DnD), 투명도/표시, BG 편집 토글(이동·리사이즈·휠줌),
 * 앵커(중앙/좌하/커스텀 픽), 축 log/linear+범위, 클릭으로 점 찍기, 선 연결, CSV/PNG, 프리셋(파일/Local/URL)
 */

/* ==== Types ==== */
type Pt = { x: number; y: number };
type Series = { name: string; color: string; points: Pt[] };
type Handle = "none" | "left" | "right" | "top" | "bottom" | "uniform";
type BgXf = { sx: number; sy: number; offX: number; offY: number };
type AnchorMode = "center" | "custom";
type CustomAnchor = { ax: number; ay: number; fx: number; fy: number } | null;

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

  const [size, setSize] = useState({ w: 960, h: 560 });
  const [pad, setPad] = useState({ left: 60, right: 20, top: 30, bottom: 46 });

  // 기본 축값: X 10~1e6, Y 1e-4~1e6, 로그스케일
  const [xMin, setXMin] = useState(10), [xMax, setXMax] = useState(1_000_000);
  const [yMin, setYMin] = useState(0.0001), [yMax, setYMax] = useState(1_000_000);
  const [xLog, setXLog] = useState(true), [yLog, setYLog] = useState(true);

  const [series, setSeries] = useState<Series[]>([
    { name: "A", color: "#2563EB", points: [] },
    { name: "B", color: "#10B981", points: [] },
  ]);
  const [activeSeries, setActiveSeries] = useState(0);
  const [connectLines, setConnectLines] = useState(true);
  const [lineWidth, setLineWidth] = useState(1.6);
  const [lineAlpha, setLineAlpha] = useState(0.9);
  const [smoothLines, setSmoothLines] = useState(true);
  const [ptRadius, setPtRadius] = useState(5);
  const [magnifyOn, setMagnifyOn] = useState(false);
  const [magnifyFactor, setMagnifyFactor] = useState(3);

  const [bgList, setBgList] = useState<Array<{ w: number; h: number } | null>>([null, null]);
  const [bgXform, setBgXform] = useState<[BgXf, BgXf]>([
    { sx: 1, sy: 1, offX: 0, offY: 0 },
    { sx: 1, sy: 1, offX: 0, offY: 0 },
  ]);
  const [keepAspect, setKeepAspect] = useState(false); // 기본 해제
  const [showAB, setShowAB] = useState<[boolean, boolean]>([true, true]);
  const [opacityAB, setOpacityAB] = useState<[number, number]>([1, 0.6]);
  const [activeBg, setActiveBg] = useState<0 | 1>(0);

  const [anchorMode, setAnchorMode] = useState<AnchorMode>("center");
  const [customAnchors, setCustomAnchors] = useState<[CustomAnchor, CustomAnchor]>([null, null]);
  const [pickAnchor, setPickAnchor] = useState(false);

  const [bgEditMode, setBgEditMode] = useState(true);
  const [hoverHandle, setHoverHandle] = useState<Handle>("none");
  const [loadError, setLoadError] = useState<[string | null, string | null]>([null, null]);

  const dragRef = useRef({ active: false, startX: 0, startY: 0, baseX: 0, baseY: 0 });
  const resizeRef = useRef({ active: false, mode: "none" as Handle, ax: 0, ay: 0, fx: 0.5, fy: 0.5, baseW: 1, baseH: 1 });

  const [toast, setToast] = useState<{ msg: string; kind?: "ok" | "err" } | null>(null);
  const notify = (msg: string, kind: "ok" | "err" = "ok") => {
    setToast({ msg, kind });
    window.clearTimeout((notify as any)._t);
    (notify as any)._t = window.setTimeout(() => setToast(null), 1600);
  };

  /* ==== Math / Util ==== */
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
    let ax = base.x + base.w / 2 + xf.offX, ay = base.y + base.h / 2 + xf.offY, fx = 0.5, fy = 0.5;
    
    if (anchorMode === "custom" && CA) ax = CA.ax, ay = CA.ay, (fx = CA.fx), (fy = CA.fy);
    const dx = ax - fx * dw, dy = ay - fy * dh;
    return { dx, dy, dw, dh, ax, ay, fx, fy, baseW: base.w, baseH: base.h };
  };

  /* ==== Image Load ==== */
  const setImgError = (idx: 0 | 1, msg: string) => setLoadError((e) => { const n = [...e] as [string|null,string|null]; n[idx] = msg; return n; });
  const onFile = (file: File, idx: 0 | 1) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) { setImgError(idx, "이미지 파일만 지원합니다."); alert("이미지 파일만 지원합니다."); return; }
    setImgError(idx, null as any);
    const img = new Image(); img.crossOrigin = "anonymous";
    const finalize = (src: string) => {
      img.onload = () => {
        bgRefs.current[idx] = img; bgUrls.current[idx] = src;
        setBgList((cur) => { const n = [...cur]; n[idx] = { w: img.width, h: img.height }; return n; });
        setBgXform((cur) => { const n = [...cur] as [BgXf,BgXf]; n[idx] = { sx: 1, sy: 1, offX: 0, offY: 0 }; return n; });
      };
      img.onerror = () => { setImgError(idx, "이미지를 열 수 없습니다."); alert("이미지를 열 수 없습니다."); };
      img.src = src;
    };
    try {
      const fr = new FileReader();
      fr.onload = () => finalize(String(fr.result || ""));
      fr.onerror = () => { try { finalize(URL.createObjectURL(file)); } catch { setImgError(idx, "이미지를 열 수 없습니다."); } };
      fr.readAsDataURL(file);
    } catch { try { finalize(URL.createObjectURL(file)); } catch { setImgError(idx, "이미지를 열 수 없습니다."); } }
  };
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = (e.clipboardData && e.clipboardData.items) || [];
      for (let i = 0; i < items.length; i++) if (items[i].type?.startsWith("image/")) { const f = items[i].getAsFile(); if (f) onFile(f, activeBg); }
    };
    window.addEventListener("paste", onPaste as any);
    return () => window.removeEventListener("paste", onPaste as any);
  }, [activeBg]);

  /* ==== Key / Mode ==== */
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setPickAnchor(false); } }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, []);
  useEffect(() => { if (!bgEditMode) { dragRef.current.active = false; resizeRef.current.active = false; setHoverHandle("none"); setPickAnchor(false); } }, [bgEditMode]);

  /* ==== Canvas Render ==== */
  useEffect(() => {
    try {
      const c = canvasRef.current; if (!c) return; const ctx = c.getContext("2d"); if (!ctx) return;
      const r = innerRect();
      ctx.clearRect(0, 0, size.w, size.h);
      ctx.fillStyle = "#F9FAFB"; ctx.fillRect(0, 0, size.w, size.h);
      ctx.fillStyle = "#fff"; ctx.fillRect(r.x, r.y, r.w, r.h);
      lastRectRef.current = null;

      for (let i = 0 as 0 | 1; i <= 1; i = ((i + 1) as 0 | 1)) {
        const img = bgRefs.current[i], meta = bgList[i];
        if (!img || !meta || !showAB[i] || opacityAB[i] <= 0) continue;
        const { dx, dy, dw, dh, ax, ay } = drawRectAndAnchor(i);
        ctx.globalAlpha = opacityAB[i]; ctx.drawImage(img as any, dx, dy, dw, dh); ctx.globalAlpha = 1;
        if (i === activeBg) lastRectRef.current = { x: dx, y: dy, w: dw, h: dh };
        if (i === activeBg && pickAnchor) {
          ctx.save(); ctx.strokeStyle = "#F59E0B"; ctx.fillStyle = "#F59E0B";
          ctx.beginPath(); ctx.arc(ax, ay, 6, 0, Math.PI * 2); ctx.globalAlpha = 0.15; ctx.fill(); ctx.globalAlpha = 1;
          ctx.beginPath(); ctx.moveTo(ax - 8, ay); ctx.lineTo(ax + 8, ay); ctx.moveTo(ax, ay - 8); ctx.lineTo(ax, ay + 8); ctx.stroke(); ctx.restore();
        }
        if (i === activeBg) {
          const lr = lastRectRef.current!, H = 12; ctx.save();
          const hs = [
            { x: lr.x + lr.w, y: lr.y + lr.h / 2, m: "right" as Handle },
            { x: lr.x, y: lr.y + lr.h / 2, m: "left" as Handle },
            { x: lr.x + lr.w / 2, y: lr.y, m: "top" as Handle },
            { x: lr.x + lr.w / 2, y: lr.y + lr.h, m: "bottom" as Handle },
            { x: lr.x + lr.w, y: lr.y + lr.h, m: "uniform" as Handle },
          ];
          for (const h of hs) { ctx.fillStyle = h.m === "uniform" ? "#111827" : "#1F2937"; ctx.globalAlpha = hoverHandle === h.m ? 1 : 0.9; ctx.fillRect(h.x - H/2, h.y - H/2, H, H); ctx.fillStyle = "#fff"; ctx.globalAlpha = 1; ctx.fillRect(h.x - (H/2-2), h.y - (H/2-2), H-4, H-4); }
          ctx.restore();
        }
      }

      drawGrid(ctx);

      if (connectLines) {
        const rr = innerRect(); ctx.save(); ctx.beginPath(); ctx.rect(rr.x, rr.y, rr.w, rr.h); ctx.clip();
        ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.globalAlpha = lineAlpha; ctx.lineWidth = lineWidth;
        for (const s of series) {
          if (s.points.length < 2) continue; const pts = [...s.points].sort((a,b)=> a.x===b.x? a.y-b.y : a.x-b.x);
          const pxPts = pts.map(p=> dataToPixel(p.x,p.y));
          ctx.strokeStyle = s.color; ctx.beginPath();
          if (smoothLines && pxPts.length>=2) {
            catmullRomPath(ctx, pxPts, 0.5);
          } else {
            ctx.moveTo(pxPts[0].px, pxPts[0].py);
            for (let i=1;i<pxPts.length;i++){ ctx.lineTo(pxPts[i].px, pxPts[i].py); }
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1; ctx.restore();
      }

      for (const s of series) { ctx.fillStyle = s.color; ctx.strokeStyle = "#fff"; for (const p of s.points) { const P = dataToPixel(p.x, p.y); ctx.beginPath(); ctx.arc(P.px, P.py, ptRadius, 0, Math.PI*2); ctx.fill(); if(ptRadius>=3){ ctx.lineWidth=1; ctx.stroke(); } } }

      if (hoverRef.current.x !== null && hoverRef.current.y !== null) {
        const P = dataToPixel(hoverRef.current.x, hoverRef.current.y), rr = innerRect();
        ctx.save(); ctx.strokeStyle = "#9CA3AF"; ctx.setLineDash([4,3]);
        ctx.beginPath(); ctx.moveTo(P.px, rr.y); ctx.lineTo(P.px, rr.y + rr.h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(rr.x, P.py); ctx.lineTo(rr.x + rr.w, P.py); ctx.stroke(); ctx.restore(); drawCross(ctx, P.px, P.py, 6);
      }

      ctx.strokeStyle = "#374151"; ctx.lineWidth = 1.2; ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = "#111827"; ctx.font = "14px ui-sans-serif, system-ui"; ctx.textAlign = "center"; ctx.fillText(xLog?"X (10^n)":"X", r.x + r.w/2, r.y + r.h + 34);
      ctx.save(); ctx.translate(r.x-45, r.y + r.h/2); ctx.rotate(-Math.PI/2); ctx.fillText(yLog?"Y (10^n)":"Y", 0, 0); ctx.restore();

      // Magnifier (loupe) overlay
      if (magnifyOn && hoverRef.current.x!==null && hoverRef.current.y!==null){
        const hp = dataToPixel(hoverRef.current.x!, hoverRef.current.y!);
        const sz=90, f=magnifyFactor; const sx=Math.max(0, Math.min(size.w-sz/f, hp.px - sz/(2*f))), sy=Math.max(0, Math.min(size.h-sz/f, hp.py - sz/(2*f)));
        ctx.save(); ctx.imageSmoothingEnabled = false;
        ctx.drawImage(c, sx, sy, sz/f, sz/f, size.w - sz - 16, 16, sz, sz);
        ctx.strokeStyle="#111827"; ctx.lineWidth=2; ctx.strokeRect(size.w - sz - 16, 16, sz, sz);
        ctx.beginPath(); ctx.moveTo(size.w - sz - 16 + sz/2, 16); ctx.lineTo(size.w - sz - 16 + sz/2, 16+sz); ctx.moveTo(size.w - sz - 16, 16+sz/2); ctx.lineTo(size.w - 16, 16+sz/2); ctx.stroke(); ctx.restore();
      }

      ctx.save(); ctx.font = "12px ui-sans-serif, system-ui"; let lx = r.x + 8, ly = r.y + 16; series.forEach((s,i)=>{ ctx.fillStyle = s.color; ctx.fillRect(lx, ly-8, 10, 10); ctx.fillStyle = "#111827"; ctx.fillText(`${s.name} (${s.points.length})${i===activeSeries?" <-":""}`, lx+16, ly); ly += 16; }); ctx.restore();
    } catch (err) {
      console.error("draw error", err); setToast({ msg: "Render error. Axes reset.", kind: "err" });
      setXMin(10); setXMax(1_000_000); setYMin(0.0001); setYMax(1_000_000);
    }
  }, [size,pad,xMin,xMax,yMin,yMax,xLog,yLog,series,bgList,showAB,opacityAB,activeBg,keepAspect,bgXform,anchorMode,customAnchors,hoverHandle,connectLines,lineWidth,lineAlpha]);

  function drawCross(ctx: CanvasRenderingContext2D, x: number, y: number, r = 5) { ctx.save(); ctx.strokeStyle = "#2563EB"; ctx.beginPath(); ctx.moveTo(x-r,y); ctx.lineTo(x+r,y); ctx.moveTo(x,y-r); ctx.lineTo(x,y+r); ctx.stroke(); ctx.restore(); }
  function catmullRomPath(ctx: CanvasRenderingContext2D, pts: {px:number;py:number}[], alpha=0.5){
    if(pts.length<2){ const p=pts[0]; ctx.moveTo(p.px,p.py); return; }
    const p0={...pts[0]}, p1={...pts[0]};
    const pEnd={...pts[pts.length-1]}, pBeforeEnd={...pts[pts.length-1]};
    const P=[p1,...pts.slice(1,-1),pBeforeEnd]; // guard
    ctx.moveTo(pts[0].px, pts[0].py);
    for(let i=0;i<pts.length-1;i++){
      const p0= i===0? pts[0] : pts[i-1];
      const p1= pts[i];
      const p2= pts[i+1];
      const p3= i+2<pts.length? pts[i+2] : pts[pts.length-1];
      const c1x = p1.px + (p2.px - p0.px)/6*(1-alpha);
      const c1y = p1.py + (p2.py - p0.py)/6*(1-alpha);
      const c2x = p2.px - (p3.px - p1.px)/6*(1-alpha);
      const c2y = p2.py - (p3.py - p1.py)/6*(1-alpha);
      ctx.bezierCurveTo(c1x,c1y,c2x,c2y,p2.px,p2.py);
    }
  }
  function numFmt(v:number, step?:number){ if(!isFinite(v)) return ""; const abs=Math.abs(v); if(abs===0) return "0"; const d = step!==undefined? Math.max(0, Math.min(6, -Math.floor(Math.log10(Math.max(1e-12, step))))) : Math.max(0, Math.min(6, 3 - Math.floor(Math.log10(Math.max(1e-12, abs))))); if(abs>=1e5||abs<1e-3) return v.toExponential(2); return v.toFixed(d); }

  // pretty label: 10^n with Unicode superscripts
  const SUPMAP: Record<string,string> = {"0":"⁰","1":"¹","2":"²","3":"³","4":"⁴","5":"⁵","6":"⁶","7":"⁷","8":"⁸","9":"⁹","-":"⁻","+":"⁺",".":"."};
  function supify(exp:number|string){ const s=String(exp); return s.split("").map(ch=> SUPMAP[ch] ?? ch).join(""); }
  function pow10LabelInt(n:number){ return `10${supify(n)}`; }

  function drawGrid(ctx: CanvasRenderingContext2D) {
    const r = innerRect(), mm = tMinMax(); if(!isFinite(mm.xmin)||!isFinite(mm.xmax)||!isFinite(mm.ymin)||!isFinite(mm.ymax)||mm.xmax<=mm.xmin||mm.ymax<=mm.ymin){ ctx.save(); ctx.fillStyle="#9CA3AF"; ctx.font="12px ui-sans-serif, system-ui"; ctx.fillText("Invalid axis range", r.x + r.w/2, r.y + r.h/2); ctx.restore(); return; } ctx.save(); ctx.strokeStyle = "#E5E7EB"; ctx.fillStyle = "#6B7280"; ctx.lineWidth = 1; ctx.font = "12px ui-sans-serif, system-ui";
    if (xLog) { const n0=Math.floor(mm.xmin), n1=Math.ceil(mm.xmax); for (let n=n0;n<=n1;n++){ const px = dataToPixel(Math.pow(10,n),1).px; ctx.beginPath(); ctx.moveTo(px,r.y); ctx.lineTo(px,r.y+r.h); ctx.stroke(); ctx.textAlign="center"; ctx.fillText(pow10LabelInt(n), px, r.y+r.h+18); for(let m=2;m<10;m++){ const v=Math.pow(10,n)*m, lv=Math.log10(v); if(lv>mm.xmax)break; if(lv<mm.xmin)continue; const xm=dataToPixel(v,1).px; ctx.save(); ctx.strokeStyle="#F3F4F6"; ctx.beginPath(); ctx.moveTo(xm,r.y); ctx.lineTo(xm,r.y+r.h); ctx.stroke(); ctx.restore(); } } } else { const steps=10; for(let i=0;i<=steps;i++){ const t=i/steps, px=r.x+t*r.w; ctx.beginPath(); ctx.moveTo(px,r.y); ctx.lineTo(px,r.y+r.h); ctx.stroke(); ctx.textAlign="center"; ctx.fillText(numFmt(xMin+t*(xMax-xMin), (xMax-xMin)/10), px, r.y+r.h+18); } }
    if (yLog) { const n0=Math.floor(mm.ymin), n1=Math.ceil(mm.ymax); for (let n=n0;n<=n1;n++){ const py = dataToPixel(1,Math.pow(10,n)).py; ctx.beginPath(); ctx.moveTo(r.x,py); ctx.lineTo(r.x+r.w,py); ctx.stroke(); ctx.textAlign="right"; ctx.fillText(pow10LabelInt(n), r.x-6, py+4); for(let m=2;m<10;m++){ const v=Math.pow(10,n)*m, lv=Math.log10(v); if(lv>mm.ymax)break; if(lv<mm.ymin)continue; const ym=dataToPixel(1,v).py; ctx.save(); ctx.strokeStyle="#F3F4F6"; ctx.beginPath(); ctx.moveTo(r.x,ym); ctx.lineTo(r.x+r.w,ym); ctx.stroke(); ctx.restore(); } } } else { const steps=10; for(let i=0;i<=steps;i++){ const t=i/steps, py=r.y+(1-t)*r.h, val=yMin+t*(yMax-yMin); ctx.beginPath(); ctx.moveTo(r.x,py); ctx.lineTo(r.x+r.w,py); ctx.stroke(); ctx.textAlign="right"; ctx.fillText(numFmt(val, (yMax-yMin)/10), r.x-6, py+4); } }
    ctx.restore();
  }

  /* ==== Pointer ==== */
  const canvasPoint = (e: { clientX: number; clientY: number }) => { const c = canvasRef.current!, rc = c.getBoundingClientRect(); const sx=c.width/rc.width, sy=c.height/rc.height; return { px:(e.clientX-rc.left)*sx, py:(e.clientY-rc.top)*sy }; };
  const inPlot = (px: number, py: number) => { const r=innerRect(), T=14; return px>=r.x-T && px<=r.x+r.w+T && py>=r.y-T && py<=r.y+r.h+T; };
  const overImage = (px: number, py: number, p=14) => { const lr=lastRectRef.current; if(!lr) return false; return px>=lr.x-p && px<=lr.x+lr.w+p && py>=lr.y-p && py<=lr.y+lr.h+p; };
  const pickHandle = (px: number, py: number): Handle => { const lr=lastRectRef.current; if(!lr) return "none"; const H=12, hit=(hx:number,hy:number)=> Math.abs(px-hx)<=H && Math.abs(py-hy)<=H; const right=hit(lr.x+lr.w, lr.y+lr.h/2)?"right":"none", left=hit(lr.x, lr.y+lr.h/2)?"left":"none", top=hit(lr.x+lr.w/2, lr.y)?"top":"none", bottom=hit(lr.x+lr.w/2, lr.y+lr.h)?"bottom":"none", corner=hit(lr.x+lr.w, lr.y+lr.h)?"uniform":"none"; return right!="none"?right: left!="none"?left: top!="none"?top: bottom!="none"?bottom: corner; };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { px, py } = canvasPoint(e); const rr = innerRect();
    hoverRef.current = px>=rr.x && px<=rr.x+rr.w && py>=rr.y && py<=rr.y+rr.h ? pixelToData(px,py) : { x:null, y:null };
    if (pickAnchor) { setHoverHandle("none"); return; }
    if (resizeRef.current.active && bgEditMode) {
      const { fx, fy, ax, ay, baseW, baseH, mode } = resizeRef.current;
      let { dw, dh } = drawRectAndAnchor(activeBg); const safe=(v:number)=> Math.abs(v)<1e-6? 1e-6: v;
      if (mode === "right") dw = (px - ax) / safe(1 - fx); else if (mode === "left") dw = (ax - px) / safe(fx);
      else if (mode === "bottom") dh = (py - ay) / safe(1 - fy); else if (mode === "top") dh = (ay - py) / safe(fy);
      else if (mode === "uniform") { const dwX = px>=ax? (px-ax)/safe(1-fx): (ax-px)/safe(fx); const dhY = py>=ay? (py-ay)/safe(1-fy): (ay-py)/safe(fy); if (keepAspect) { const s=Math.max(dwX/baseW, dhY/baseH); dw = baseW*s; dh = baseH*s; } else { dw = dwX; dh = dhY; } }
      const nsx = clampS(dw/baseW), nsy = clampS(dh/baseH);
      setBgXform((cur)=>{ const n=[...cur] as [BgXf,BgXf]; const xf=n[activeBg]; n[activeBg] = { ...xf, sx: keepAspect? nsx: nsx, sy: keepAspect? nsx: nsy }; return n; });
      return;
    }
    if (dragRef.current.active && bgEditMode) {
      setBgXform((cur)=>{ const n=[...cur] as [BgXf,BgXf]; const xf=n[activeBg]; n[activeBg] = { ...xf, offX: dragRef.current.baseX + (px-dragRef.current.startX), offY: dragRef.current.baseY + (py-dragRef.current.startY) }; return n; });
      return;
    }
    setHoverHandle(bgEditMode ? pickHandle(px,py) : "none");
  };
  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { px, py } = canvasPoint(e);
    if (e.button === 2) { setPickAnchor(false); return; }
    if (pickAnchor && overImage(px,py)) {
      const lr=lastRectRef.current; if(!lr) return; const fx=(px-lr.x)/lr.w, fy=(py-lr.y)/lr.h;
      setCustomAnchors((cur)=>{ const n=[...cur] as [CustomAnchor,CustomAnchor]; n[activeBg]={ ax:px, ay:py, fx:Math.max(0,Math.min(1,fx)), fy:Math.max(0,Math.min(1,fy)) }; return n; });
      setAnchorMode("custom"); setPickAnchor(false); return;
    }
    
    if (bgEditMode) {
      const h = pickHandle(px,py);
      if (h !== "none") { const d = drawRectAndAnchor(activeBg); resizeRef.current = { active:true, mode:h, ax:d.ax, ay:d.ay, fx:d.fx, fy:d.fy, baseW:d.baseW, baseH:d.baseH }; return; }
      if (overImage(px,py)) { dragRef.current = { active:true, startX:px, startY:py, baseX:bgXform[activeBg].offX, baseY:bgXform[activeBg].offY }; return; }
      return;
    }
    if (inPlot(px,py)) {
      const d = pixelToData(px,py);
      setSeries((arr)=> arr.map((s,i)=> i===activeSeries? { ...s, points:[...s.points,{x:d.x,y:d.y}] }: s ));
    }
  };

  // onMouseDown 바로 아래에 추가
const onMouseUp = (_e: React.MouseEvent<HTMLCanvasElement>) => {
  if (dragRef.current.active || resizeRef.current.active) {
    dragRef.current.active = false;
    resizeRef.current.active = false;
  }
};

const onMouseLeave = (_e: React.MouseEvent<HTMLCanvasElement>) => {
  hoverRef.current = { x: null, y: null };
  setHoverHandle("none");
  dragRef.current.active = false;
  resizeRef.current.active = false;
};

const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
  if (!bgEditMode) return;           // 점찍기 모드에선 무시
  e.preventDefault();
  const k = e.deltaY < 0 ? 1.05 : 0.95; // 위=확대, 아래=축소
  setBgXform((cur) => {
    const n = [...cur] as [BgXf, BgXf];
    const xf = n[activeBg];
    const nsx = clampS(xf.sx * k);
    const nsy = clampS(xf.sy * (keepAspect ? k : k));
    n[activeBg] = { ...xf, sx: nsx, sy: keepAspect ? nsx : nsy };
    return n;
  });
};

  const serialize = ():PresetV1 => ({ v:1, size, pad, axes:{xMin,xMax,yMin,yMax,xLog,yLog}, series, ui:{activeSeries}, connect:{connectLines, lineWidth, lineAlpha}, bg:{ keepAspect, anchorMode, customAnchors, activeBg, showAB, opacityAB, xform:bgXform }, images: bgUrls.current });
  const applyPreset = (p:any) => { try { if(!p) return; p.size&&setSize(p.size); p.pad&&setPad(p.pad); if(p.axes){ setXMin(p.axes.xMin); setXMax(p.axes.xMax); setYMin(p.axes.yMin); setYMax(p.axes.yMax); setXLog(!!p.axes.xLog); setYLog(!!p.axes.yLog); } Array.isArray(p.series)&&setSeries(p.series); p.ui&&setActiveSeries(p.ui.activeSeries??0); if(p.connect){ setConnectLines(!!p.connect.connectLines); setLineWidth(p.connect.lineWidth??1.6); setLineAlpha(p.connect.lineAlpha??0.9);} if(p.bg){ setKeepAspect(!!p.bg.keepAspect); p.bg.anchorMode&&setAnchorMode(p.bg.anchorMode); Array.isArray(p.bg.customAnchors)&&setCustomAnchors(p.bg.customAnchors); typeof p.bg.activeBg!="undefined"&&setActiveBg(p.bg.activeBg); Array.isArray(p.bg.showAB)&&setShowAB(p.bg.showAB); Array.isArray(p.bg.opacityAB)&&setOpacityAB(p.bg.opacityAB); Array.isArray(p.bg.xform)&&setBgXform(p.bg.xform);} if(Array.isArray(p.images)){ p.images.forEach((src:string|null,idx:number)=>{ if(!src) return; const i = new Image(); i.crossOrigin = "anonymous"; i.onload = ()=>{ bgRefs.current[idx]=i; bgUrls.current[idx]=src; setBgList(cur=>{ const n=[...cur]; n[idx]={w:i.width,h:i.height}; return n; }); }; i.src = src; }); } } catch(e){ console.warn("preset apply fail", e);} };
  const savePresetFile = async () => {
    const data = JSON.stringify(serialize(), null, 2);
    try { if (typeof (window as any).showSaveFilePicker === "function") { const handle = await (window as any).showSaveFilePicker({ suggestedName:`digitizer_preset_${Date.now()}.json`, types:[{description:"JSON", accept:{"application/json":[".json"]}}] }); const w = await handle.createWritable(); await w.write(new Blob([data],{type:"application/json"})); await w.close(); notify("Preset saved as file."); return; } } catch(err){ console.warn("picker fail; fallback", err); }
    try { const blob = new Blob([data],{type:"application/json"}); const url = URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=`digitizer_preset_${Date.now()}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),0); notify("Download started."); } catch { notify("Download blocked", "err"); }
  };
  const loadPresetFromFile = (file: File | null) => { if(!file) return; const fr = new FileReader(); fr.onload = () => { try { applyPreset(JSON.parse(String(fr.result||"{}"))); notify("Preset loaded."); } catch { notify("Invalid preset", "err"); } }; fr.readAsText(file); };
  const copyShareURL = () => { try { const enc = btoa(unescape(encodeURIComponent(JSON.stringify(serialize())))); const url = `${location.origin}${location.pathname}#s=${enc}`; navigator.clipboard?.writeText(url); notify("Share URL copied!"); } catch { notify("Copy failed", "err"); } };
  const savePresetLocal = () => { try { localStorage.setItem("digitizer:preset:manual", JSON.stringify(serialize())); notify("Saved to LocalStorage."); } catch { notify("LocalStorage save failed", "err"); } };
  const loadPresetLocal = () => { try { const raw = localStorage.getItem("digitizer:preset:manual"); if(!raw){ notify("No Local preset", "err"); return;} applyPreset(JSON.parse(raw)); notify("Loaded from LocalStorage."); } catch { notify("LocalStorage load failed", "err"); } };
  const toCSV = () => { let out = "series,x,y\n"; series.forEach(s=> s.points.forEach(p=> out += `${s.name},${p.x},${p.y}\n`)); const url = URL.createObjectURL(new Blob([out],{type:"text/csv"})); const a=document.createElement("a"); a.href=url; a.download=`points_${Date.now()}.csv`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),0); };
  const exportPNG = () => { const c = canvasRef.current; if(!c) return; const url=c.toDataURL("image/png"); const a=document.createElement("a"); a.href=url; a.download=`digitizer_${Date.now()}.png`; a.click(); };

  useEffect(()=>{ try { localStorage.setItem("digitizer:auto", JSON.stringify(serialize())); } catch {} }, [size,pad,xMin,xMax,yMin,yMax,xLog,yLog,series,activeSeries,connectLines,lineWidth,lineAlpha,keepAspect,anchorMode,customAnchors,activeBg,showAB,opacityAB,bgXform]);
  useEffect(()=>{ const h=location.hash||""; if(h.startsWith("#s=")){ try{ applyPreset(JSON.parse(decodeURIComponent(escape(atob(h.slice(3)))))); return; }catch{} } try{ const raw=localStorage.getItem("digitizer:auto"); if(raw) applyPreset(JSON.parse(raw)); }catch{} }, []);

  /* ==== Simple internal tests ==== */
  useEffect(()=>{ const ok=[clampS(0),clampS(0.05),clampS(0.5),clampS(1),clampS(5),clampS(100)]; if(!(ok[0]===0.05&&ok[1]===0.05&&ok[2]===0.5&&ok[3]===1&&ok[4]===5&&ok[5]===50)) console.warn("TEST FAIL clamp"); const r=innerRect(), mid={x:r.x+r.w/2,y:r.y+r.h/2}, back=pixelToData(mid.x,mid.y), fwd=dataToPixel(back.x,back.y), err=Math.hypot(fwd.px-mid.x,fwd.py-mid.y); if(err>1) console.warn("TEST WARN round-trip",err); }, [xLog,yLog,xMin,xMax,yMin,yMax,size,pad]);

  /* ==== UI ==== */
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white p-6 text-gray-900">
      <h1 className="mb-3 text-3xl font-semibold tracking-tight">Log‑scale Graph Digitizer</h1>

      <div className="inline-block rounded-2xl border border-gray-200 bg-white p-3 shadow-lg">
        <canvas
          ref={canvasRef}
          width={size.w}
          height={size.h}
          className="touch-none select-none"
          style={{ cursor: pickAnchor ? "crosshair" : (bgEditMode ? (hoverHandle !== "none" ? "nwse-resize" : "move") : "crosshair") }}diff
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

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-gray-700">
        <div>
          {hoverRef.current.x !== null && hoverRef.current.y !== null ? (
            <span>Hover: x={xLog ? hoverRef.current.x!.toExponential(3) : hoverRef.current.x!.toPrecision(6)}, y={yLog ? hoverRef.current.y!.toExponential(3) : hoverRef.current.y!.toPrecision(6)}</span>
          ) : (
            <span>Hover: -</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={()=> setSeries(arr=> arr.map((s,i)=> i===activeSeries? { ...s, points:s.points.slice(0,Math.max(0,s.points.length-1)) }: s))} className="rounded-xl bg-gray-100 px-3 py-1 hover:bg-gray-200">Undo</button>
          <button onClick={()=> setSeries(arr=> arr.map((s,i)=> i===activeSeries? { ...s, points:[] }: s))} className="rounded-xl bg-gray-100 px-3 py-1 hover:bg-gray-200">Clear</button>
          <button onClick={toCSV} className="rounded-xl bg-gray-100 px-3 py-1 hover:bg-gray-200">Export CSV</button>
          <button onClick={exportPNG} className="rounded-xl bg-blue-600 px-3 py-1 text-white hover:bg-blue-700">Export PNG</button>
          <span className="mx-1 h-5 w-px bg-gray-200" />
          <button onClick={savePresetFile} className="rounded-xl bg-gray-100 px-3 py-1 hover:bg-gray-200">Save preset (JSON)</button>
          <button onClick={()=> presetFileRef.current?.click()} className="rounded-xl bg-gray-100 px-3 py-1 hover:bg-gray-200">Load preset (file)</button>
          <input ref={presetFileRef} type="file" accept="application/json" className="hidden" onChange={(e)=>{ const f=e.target.files&&e.target.files[0]; if(f) loadPresetFromFile(f); (e.target as any).value=""; }} />
          <button onClick={savePresetLocal} className="rounded-xl bg-gray-100 px-3 py-1 hover:bg-gray-200">Save to Local</button>
          <button onClick={loadPresetLocal} className="rounded-xl bg-gray-100 px-3 py-1 hover:bg-gray-200">Load from Local</button>
          <button onClick={copyShareURL} className="rounded-xl bg-gray-100 px-3 py-1 hover:bg-gray-200">Copy URL</button>
          <button onClick={()=>{ setXMin(10); setXMax(1_000_000); setYMin(0.0001); setYMax(1_000_000); setXLog(true); setYLog(true); notify("Axes reset"); }} className="rounded-xl bg-gray-100 px-3 py-1 hover:bg-gray-200">Reset Axes</button>
          <button onClick={()=>{ try{ localStorage.removeItem("digitizer:auto"); localStorage.removeItem("digitizer:preset:manual"); location.hash=""; notify("Hard reset done"); }catch{} }} className="rounded-xl bg-gray-100 px-3 py-1 hover:bg-gray-200">Hard Reset</button>
        </div>
      </div>

      <div className="mt-4 grid gap-5 rounded-2xl border border-gray-200 bg-white p-4 shadow-lg md:grid-cols-2">
        <section>
          <h2 className="mb-2 font-semibold">Axes</h2>
          <div className="mb-1 flex items-center gap-3 text-sm">
            <label className="flex items-center gap-1"><input type="checkbox" checked={xLog} onChange={(e)=>setXLog(e.target.checked)} /> X Log10</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={yLog} onChange={(e)=>setYLog(e.target.checked)} /> Y Log10</label>
          </div>
          <div className="grid grid-cols-4 gap-2 text-sm">
            <label className="col-span-2 flex items-center gap-1">X min <input className="w-full rounded border px-2 py-1" value={xMin} onChange={(e)=>setXMin(Number(e.target.value))} /></label>
            <label className="col-span-2 flex items-center gap-1">X max <input className="w-full rounded border px-2 py-1" value={xMax} onChange={(e)=>setXMax(Number(e.target.value))} /></label>
            <label className="col-span-2 flex items-center gap-1">Y min <input className="w-full rounded border px-2 py-1" value={yMin} onChange={(e)=>setYMin(Number(e.target.value))} /></label>
            <label className="col-span-2 flex items-center gap-1">Y max <input className="w-full rounded border px-2 py-1" value={yMax} onChange={(e)=>setYMax(Number(e.target.value))} /></label>
          </div>
        </section>

        <section>
          <h2 className="mb-2 font-semibold">Series</h2>
          <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-1"><input type="radio" name="series" checked={activeSeries===0} onChange={()=>setActiveSeries(0)} /> Series A</label>
            <label className="flex items-center gap-1"><input type="radio" name="series" checked={activeSeries===1} onChange={()=>setActiveSeries(1)} /> Series B</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={connectLines} onChange={(e)=>setConnectLines(e.target.checked)} /> Connect (default on)</label>
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <label className="flex items-center gap-1">Width <input className="w-full rounded border px-2 py-1" value={lineWidth} onChange={(e)=>setLineWidth(Number(e.target.value)||1)} /></label>
            <label className="col-span-2 flex items-center gap-2">Alpha <input type="range" min={0} max={1} step={0.05} value={lineAlpha} onChange={(e)=>setLineAlpha(Number(e.target.value))} className="w-full" /> <span>{lineAlpha.toFixed(2)}</span></label>
            <label className="flex items-center gap-2 col-span-3"><input type="checkbox" checked={smoothLines} onChange={(e)=>setSmoothLines(e.target.checked)} /> Smooth curve (Catmull‑Rom)</label>
            <label className="flex items-center gap-2 col-span-3">Point size <input type="range" min={1} max={8} step={1} value={ptRadius} onChange={(e)=>setPtRadius(Number(e.target.value))} className="w-full" /> <span>{ptRadius}px</span></label>
          </div>
        </section>

        <section>
          <h2 className="mb-2 font-semibold">Background A/B</h2>
          <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={magnifyOn} onChange={(e)=>setMagnifyOn(e.target.checked)} /> Magnifier</label>
            <label className="flex items-center gap-2">Zoom <input type="range" min={2} max={6} step={1} value={magnifyFactor} onChange={(e)=>setMagnifyFactor(Number(e.target.value))} /></label>
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-1"><input type="radio" name="activebg" checked={activeBg===0} onChange={()=>setActiveBg(0)} /> Edit A</label>
            <label className="flex items-center gap-1"><input type="radio" name="activebg" checked={activeBg===1} onChange={()=>setActiveBg(1)} /> Edit B</label>
            <span className="mx-1 h-4 w-px bg-gray-200" />
            <label className="flex items-center gap-1"><input type="checkbox" checked={showAB[0]} onChange={(e)=>setShowAB(([a,b])=>[e.target.checked,b])} /> Show A</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={showAB[1]} onChange={(e)=>setShowAB(([a,b])=>[a,e.target.checked])} /> Show B</label>
            <label className="flex items-center gap-1">A α <input type="range" min={0} max={1} step={0.05} value={opacityAB[0]} onChange={(e)=> setOpacityAB(([a,b])=>[Number(e.target.value), b])} /></label>
            <label className="flex items-center gap-1">B α <input type="range" min={0} max={1} step={0.05} value={opacityAB[1]} onChange={(e)=> setOpacityAB(([a,b])=>[a, Number(e.target.value)])} /></label>
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <button onClick={()=> fileARef.current?.click()} className="rounded-lg border px-2 py-1">Load A</button>
            <button onClick={()=> fileBRef.current?.click()} className="rounded-lg border px-2 py-1">Load B</button>
            <input ref={fileARef} type="file" accept="image/*" className="hidden" onChange={(e)=>{ const f=e.target.files&&e.target.files[0]; if(f) onFile(f,0); (e.target as any).value=""; }} />
            <input ref={fileBRef} type="file" accept="image/*" className="hidden" onChange={(e)=>{ const f=e.target.files&&e.target.files[0]; if(f) onFile(f,1); (e.target as any).value=""; }} />
            <span className="mx-1 h-4 w-px bg-gray-200" />
            <button onClick={()=> setBgEditMode(v=>!v)} className={`rounded-lg px-2 py-1 ${bgEditMode?"bg-amber-100 border border-amber-300":"border"}`}>{bgEditMode?"BG Edit ON":"BG Edit OFF"}</button>
            <label className="flex items-center gap-1"><input type="checkbox" checked={keepAspect} onChange={(e)=>setKeepAspect(e.target.checked)} /> Keep ratio</label>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="anchor" checked={anchorMode==="center"} onChange={()=>setAnchorMode("center")} /> Center</label>
            <label className="flex items-center gap-2"><input type="radio" name="anchor" checked={anchorMode==="custom"} onChange={()=>setAnchorMode("custom")} /> Custom</label>
            <button onClick={()=>{ setPickAnchor(v=>!v); }} className={`rounded-lg px-2 py-1 ${pickAnchor?"bg-amber-100 border border-amber-300":"border"}`}>Pick Anchor</button>
            <button onClick={()=>{ setCustomAnchors(cur=>{ const n=[...cur] as [CustomAnchor,CustomAnchor]; n[activeBg]=null; return n; }); setAnchorMode("center"); }} className="rounded-lg border px-2 py-1">Clear Anchor</button>
          </div>
          {loadError[activeBg] && <p className="mt-2 text-sm text-red-600">{loadError[activeBg]}</p>}
        </section>
      </div>

      {toast && (
        <div className={`fixed bottom-4 right-4 rounded-xl px-3 py-2 text-sm shadow-lg ${toast.kind==="err"?"bg-red-600 text-white":"bg-gray-900 text-white"}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
