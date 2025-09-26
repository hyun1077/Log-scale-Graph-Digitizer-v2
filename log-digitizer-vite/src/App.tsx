import React, { useEffect, useRef, useState } from "react";

// Log-scale Graph Digitizer (single-file, compact)
// - BG A/B 두 이미지를 동시에 표시하고, 각자 투명도/표시 여부 조절
// - 활성 레이어(A/B)만 드래그/휠줌/핸들 리사이즈 가능 (Edit target)
// - 앵커: center | bottom-left (좌하단 고정 리사이즈)
// - 축: 축별 log/linear, 범위 편집
// - 포인트: 캔버스 클릭 추가, 시리즈별 Undo/Clear, CSV Export
// - 선 연결: 점들을 직선으로 연결(정렬/굵기/투명도 옵션)
// - Export PNG: 현재 화면을 그대로 PNG로 저장(두 배경이 합쳐진 이미지 포함)

export default function App() {
  // ===== Refs & basic state ===============================================
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hoverRef = useRef<{ x: number | null; y: number | null }>({ x: null, y: null });

  // 캔버스 사이즈와 플롯 패딩
  const [size, setSize] = useState({ w: 900, h: 560 });
  const [pad, setPad] = useState({ left: 70, right: 20, top: 20, bottom: 50 });

  // 축 상태(로그/선형 & 범위)
  const [xMin, setXMin] = useState(1);
  const [xMax, setXMax] = useState(1000);
  const [yMin, setYMin] = useState(0.1);
  const [yMax, setYMax] = useState(100);
  const [xLog, setXLog] = useState(true);
  const [yLog, setYLog] = useState(true);

  // 배경 이미지 A/B
  type ImgMeta = { w: number; h: number };
  const [bgList, setBgList] = useState<(ImgMeta | null)[]>([null, null]);
  const bgRefs = useRef<(HTMLImageElement | null)[]>([null, null]);
  const bgUrls = useRef<(string | null)[]>([null, null]);

  // 표시/투명도: A와 B를 동시에 볼 수 있도록 분리
  const [showAB, setShowAB] = useState<[boolean, boolean]>([true, true]);
  const [opacityAB, setOpacityAB] = useState<[number, number]>([0.6, 0.6]);

  // 어떤 레이어를 편집할지 선택(드래그/리사이즈/휠줌은 이 대상에만 적용)
  const [activeBg, setActiveBg] = useState<0 | 1>(0);
  const [keepAspect, setKeepAspect] = useState(true);
  const [bgError, setBgError] = useState<string | null>(null);

  // 이미지 변환(축별 스케일 + 픽셀 오프셋)
  type BgXf = { sx: number; sy: number; offX: number; offY: number };
  const [bgXform, setBgXform] = useState<[BgXf, BgXf]>([
    { sx: 1, sy: 1, offX: 0, offY: 0 },
    { sx: 1, sy: 1, offX: 0, offY: 0 },
  ]);

  // 편집 모드 & 앵커
  const [bgEdit, setBgEdit] = useState(false);
  type Anchor = "center" | "bottom-left";
  const [anchorMode, setAnchorMode] = useState<Anchor>("bottom-left");

  // 드래그/리사이즈 상태(코너/사이드 핸들)
  const dragRef = useRef({ active: false, startX: 0, startY: 0, baseX: 0, baseY: 0 });
  const lastRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null); // 활성 레이어의 마지막 그려진 위치만 저장
  type Handle = "none" | "uniform" | "right" | "left" | "top" | "bottom";
  const [hoverHandle, setHoverHandle] = useState<Handle>("none");
  const resizeRef = useRef({ active: false, mode: "none" as Handle, baseSx: 1, baseSy: 1, ax: 0, ay: 0 });

  // 시리즈 & 포인트
  const palette = ["#2563EB", "#DC2626", "#059669", "#A855F7", "#EA580C"];
  type Pt = { x: number; y: number };
  type Series = { name: string; color: string; points: Pt[] };
  const [series, setSeries] = useState<Series[]>([
    { name: "Series A", color: palette[0], points: [] },
    { name: "Series B", color: palette[1], points: [] },
  ]);
  const [activeSeries, setActiveSeries] = useState(0);

  // 선 연결 옵션
  const [connectLines, setConnectLines] = useState(false);
  const [connectSortX, setConnectSortX] = useState(true);
  const [lineWidth, setLineWidth] = useState(1.5);
  const [lineAlpha, setLineAlpha] = useState(0.9);

  // ===== 좌표 변환/헬퍼 =====================================================
  const innerRect = () => ({ x: pad.left, y: pad.top, w: size.w - pad.left - pad.right, h: size.h - pad.top - pad.bottom });
  const tVal = (v: number, log: boolean) => (log ? Math.log10(v) : v);
  const tMinMax = () => ({ xmin: tVal(xMin, xLog), xmax: tVal(xMax, xLog), ymin: tVal(yMin, yLog), ymax: tVal(yMax, yLog) });

  // 데이터 → 픽셀(캔버스) 변환
  const dataToPixel = (x: number, y: number) => {
    const r = innerRect(); const mm = tMinMax();
    const tx = tVal(x, xLog); const ty = tVal(y, yLog);
    const px = r.x + ((tx - mm.xmin) / (mm.xmax - mm.xmin)) * r.w;
    const py = r.y + r.h - ((ty - mm.ymin) / (mm.ymax - mm.ymin)) * r.h;
    return { px, py };
  };
  // 픽셀 → 데이터 역변환
  const pixelToData = (px: number, py: number) => {
    const r = innerRect(); const mm = tMinMax();
    const tx = mm.xmin + ((px - r.x) / r.w) * (mm.xmax - mm.xmin);
    const ty = mm.ymin + ((r.y + r.h - py) / r.h) * (mm.ymax - mm.ymin);
    const fromT = (tv: number, log: boolean) => (log ? Math.pow(10, tv) : tv);
    return { x: fromT(tx, xLog), y: fromT(ty, yLog) };
  };

  // 클립보드 붙여넣기(이미지)
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = (e.clipboardData && e.clipboardData.items) || [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.type?.startsWith("image/")) { const f = it.getAsFile(); if (f) onFile(f, activeBg); }
      }
    };
    window.addEventListener("paste", onPaste as any);
    return () => window.removeEventListener("paste", onPaste as any);
  }, [activeBg]);

  // ===== 렌더링 루프 ========================================================
  useEffect(() => {
    const c = canvasRef.current; if (!c) return; const ctx = c.getContext("2d"); if (!ctx) return;
    const r = innerRect();

    // 배경 정리 및 플롯 배경
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.fillStyle = "#F9FAFB"; ctx.fillRect(0, 0, size.w, size.h);
    ctx.fillStyle = "#fff"; ctx.fillRect(r.x, r.y, r.w, r.h);

    // ---- 배경 이미지 (A → B 순서로 그려 겹침) -----------------------------
    lastRectRef.current = null; // 매 프레임 초기화 후, 활성 레이어가 그려질 때 갱신
    for (let i = 0 as 0 | 1; i <= 1; i = (i + 1) as 0 | 1) {
      const img = bgRefs.current[i];
      const hasBg = bgList[i] && img;
      const visible = showAB[i] && (opacityAB[i] > 0);
      if (!hasBg || !visible) continue;

      // (1) 플롯 영역 안에서 기본 적합(rect) 계산
      let baseW = r.w, baseH = r.h, baseX = r.x, baseY = r.y;
      if (keepAspect) {
        const s = Math.min(r.w / (img as HTMLImageElement).width, r.h / (img as HTMLImageElement).height);
        baseW = (img as HTMLImageElement).width * s;
        baseH = (img as HTMLImageElement).height * s;
        baseX = r.x + (r.w - baseW) / 2;
        baseY = r.y + (r.h - baseH) / 2;
      }
      // (2) 사용자 변환 적용 + 앵커 위치 계산
      const xf = bgXform[i];
      const clamp = (v: number) => Math.max(0.05, Math.min(10, v));
      const sx = clamp(xf.sx), sy = clamp(xf.sy);
      const dw = baseW * sx, dh = baseH * sy;
      let ax = baseX, ay = baseY;
      if (anchorMode === "center") { ax = baseX + baseW / 2 + xf.offX; ay = baseY + baseH / 2 + xf.offY; }
      else { ax = baseX + xf.offX; ay = baseY + baseH + xf.offY; } // bottom-left 기준
      const dx = anchorMode === "center" ? ax - dw / 2 : ax;
      const dy = anchorMode === "center" ? ay - dh / 2 : ay - dh; // bottom 고정

      // (3) 이미지 그리기
      ctx.globalAlpha = opacityAB[i];
      ctx.drawImage(img as CanvasImageSource, dx, dy, dw, dh);
      ctx.globalAlpha = 1;

      // 활성 레이어였다면, 핸들 피킹/드래그용 rect 저장
      if (i === activeBg) {
        lastRectRef.current = { x: dx, y: dy, w: dw, h: dh };
      }

      // (4) 활성 레이어에만 핸들 렌더
      if (bgEdit && i === activeBg && lastRectRef.current) {
        const H = 12; const lr = lastRectRef.current;
        const hs = [
          { x: lr.x + lr.w,     y: lr.y + lr.h / 2, m: "right"   as Handle },
          { x: lr.x,            y: lr.y + lr.h / 2, m: "left"    as Handle },
          { x: lr.x + lr.w / 2, y: lr.y,            m: "top"     as Handle },
          { x: lr.x + lr.w / 2, y: lr.y + lr.h,     m: "bottom"  as Handle },
          { x: lr.x + lr.w,     y: lr.y + lr.h,     m: "uniform" as Handle },
        ];
        ctx.save();
        for (const h of hs) {
          ctx.fillStyle = h.m === "uniform" ? "#111827" : "#1F2937";
          ctx.globalAlpha = hoverHandle === h.m ? 1 : 0.9;
          ctx.fillRect(h.x - H / 2, h.y - H / 2, H, H);
          ctx.fillStyle = "#fff"; ctx.globalAlpha = 1;
          ctx.fillRect(h.x - (H/2 - 2), h.y - (H/2 - 2), H - 4, H - 4);
        }
        ctx.restore();
      }
    }

    // 그리드/눈금
    drawGrid(ctx);

    // --- 점 연결 선(플롯에 클리핑) ----------------------------------------
    if (connectLines) {
      ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      for (const s of series) {
        if (s.points.length < 2) continue;
        const pts = connectSortX ? [...s.points].sort((a,b)=> a.x===b.x? (a.y-b.y) : (a.x-b.x)) : s.points;
        const first = dataToPixel(pts[0].x, pts[0].y);
        ctx.beginPath(); ctx.moveTo(first.px, first.py);
        for (let i=1;i<pts.length;i++){ const P=dataToPixel(pts[i].x, pts[i].y); ctx.lineTo(P.px, P.py); }
        ctx.strokeStyle = s.color; ctx.globalAlpha = lineAlpha; ctx.lineWidth = lineWidth; ctx.stroke(); ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    // 포인트(십자 표시)
    for (const s of series) {
      ctx.strokeStyle = s.color; ctx.fillStyle = s.color;
      for (const p of s.points) { const P = dataToPixel(p.x, p.y); drawCross(ctx, P.px, P.py, 5); }
    }

    // 범례
    ctx.save(); ctx.font = "12px ui-sans-serif, system-ui";
    let lx = r.x + 8, ly = r.y + 16;
    series.forEach((s, i) => {
      ctx.fillStyle = s.color; ctx.fillRect(lx, ly - 8, 10, 10);
      ctx.fillStyle = "#111827"; ctx.fillText(`${s.name} (${s.points.length})${i === activeSeries ? " <-" : ""}`, lx + 16, ly);
      ly += 16;
    });
    ctx.restore();

    // 호버 크로스헤어
    if (hoverRef.current.x !== null && hoverRef.current.y !== null) {
      const P = dataToPixel(hoverRef.current.x, hoverRef.current.y);
      ctx.save(); ctx.strokeStyle = "#9CA3AF"; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(P.px, r.y); ctx.lineTo(P.px, r.y + r.h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(r.x, P.py); ctx.lineTo(r.x + r.w, P.py); ctx.stroke();
      ctx.restore();
      drawCross(ctx, P.px, P.py, 6);
    }

    // 프레임 & 라벨
    ctx.strokeStyle = "#374151"; ctx.lineWidth = 1.2; ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = "#111827"; ctx.font = "14px ui-sans-serif, system-ui"; ctx.textAlign = "center";
    ctx.fillText(xLog ? "X (log10)" : "X", r.x + r.w / 2, r.y + r.h + 34);
    ctx.save(); ctx.translate(r.x - 45, r.y + r.h / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(yLog ? "Y (log10)" : "Y", 0, 0); ctx.restore();
  }, [size, pad, xMin, xMax, yMin, yMax, xLog, yLog, series, bgList, showAB, opacityAB, activeBg, keepAspect, bgXform, anchorMode, hoverHandle, connectLines, connectSortX, lineWidth, lineAlpha]);

  // ===== 유틸(마커/그리드) =================================================
  function drawCross(ctx: CanvasRenderingContext2D, x: number, y: number, r = 5) {
    const R = r; ctx.save(); ctx.strokeStyle = "#2563EB"; ctx.beginPath();
    ctx.moveTo(x - R, y); ctx.lineTo(x + R, y);
    ctx.moveTo(x, y - R); ctx.lineTo(x, y + R);
    ctx.stroke(); ctx.restore();
  }

  function drawGrid(ctx: CanvasRenderingContext2D) {
    const r = innerRect(); const mm = tMinMax();
    ctx.save(); ctx.strokeStyle = "#E5E7EB"; ctx.fillStyle = "#6B7280"; ctx.lineWidth = 1; ctx.font = "12px ui-sans-serif, system-ui";
    // X축 눈금
    if (xLog) {
      const nMin = Math.floor(mm.xmin), nMax = Math.ceil(mm.xmax);
      for (let n = nMin; n <= nMax; n++) {
        const px = dataToPixel(Math.pow(10, n), 1).px;
        ctx.beginPath(); ctx.moveTo(px, r.y); ctx.lineTo(px, r.y + r.h); ctx.stroke();
        ctx.textAlign = "center"; ctx.fillText("10^" + n, px, r.y + r.h + 18);
        for (let m = 2; m < 10; m++) {
          const val = Math.pow(10, n) * m; const lv = Math.log10(val);
          if (lv > mm.xmax) break; if (lv < mm.xmin) continue;
          const xm = dataToPixel(val, 1).px; ctx.save(); ctx.strokeStyle = "#F3F4F6";
          ctx.beginPath(); ctx.moveTo(xm, r.y); ctx.lineTo(xm, r.y + r.h); ctx.stroke(); ctx.restore();
        }
      }
    } else {
      const stepsX = 10; for (let i = 0; i <= stepsX; i++) {
        const t = i / stepsX; const px = r.x + t * r.w; const v = xMin + t * (xMax - xMin);
        ctx.beginPath(); ctx.moveTo(px, r.y); ctx.lineTo(px, r.y + r.h); ctx.stroke();
        ctx.textAlign = "center"; ctx.fillText(v.toPrecision(4), px, r.y + r.h + 18);
      }
    }
    // Y축 눈금
    if (yLog) {
      const nMin = Math.floor(mm.ymin), nMax = Math.ceil(mm.ymax);
      for (let n = nMin; n <= nMax; n++) {
        const py = dataToPixel(1, Math.pow(10, n)).py;
        ctx.beginPath(); ctx.moveTo(r.x, py); ctx.lineTo(r.x + r.w, py); ctx.stroke();
        ctx.textAlign = "right"; ctx.fillText("10^" + n, r.x - 6, py + 4);
        for (let m = 2; m < 10; m++) {
          const val = Math.pow(10, n) * m; const lv = Math.log10(val);
          if (lv > mm.ymax) break; if (lv < mm.ymin) continue;
          const ym = dataToPixel(1, val).py; ctx.save(); ctx.strokeStyle = "#F3F4F6";
          ctx.beginPath(); ctx.moveTo(r.x, ym); ctx.lineTo(r.x + r.w, ym); ctx.stroke(); ctx.restore();
        }
      }
    } else {
      const stepsY = 10; for (let i = 0; i <= stepsY; i++) {
        const t = i / stepsY; const py = r.y + (1 - t) * r.h; const v = yMin + t * (yMax - yMin);
        ctx.beginPath(); ctx.moveTo(r.x, py); ctx.lineTo(r.x + r.w, py); ctx.stroke();
        ctx.textAlign = "right"; ctx.fillText(v.toPrecision(4), r.x - 6, py + 4);
      }
    }
    ctx.restore();
  }

  // ===== 포인터 핸들러 =====================================================
  const canvasPoint = (e: { clientX: number; clientY: number }) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    const scaleX = c.width / rect.width;
    const scaleY = c.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    return { px, py };
  };

  // 플롯 영역 허용(핸들 클릭 여유 포함)
  const inPlot = (px: number, py: number) => { const r = innerRect(); const T = 14; return px >= r.x - T && px <= r.x + r.w + T && py >= r.y - T && py <= r.y + r.h + T; };

  const overImage = (px: number, py: number, pad = 14) => {
    const lr = lastRectRef.current; if (!lr) return false;
    return px >= lr.x - pad && px <= lr.x + lr.w + pad && py >= lr.y - pad && py <= lr.y + lr.h + pad;
  };

  const pickHandle = (px: number, py: number): Handle => {
    const lr = lastRectRef.current; if (!lr) return "none"; const H = 12;
    const hit = (hx: number, hy: number) => Math.abs(px - hx) <= H && Math.abs(py - hy) <= H;
    const right  = hit(lr.x + lr.w,     lr.y + lr.h / 2) ? "right"   : "none";
    const left   = hit(lr.x,            lr.y + lr.h / 2) ? "left"    : "none";
    const top    = hit(lr.x + lr.w / 2, lr.y)            ? "top"     : "none";
    const bottom = hit(lr.x + lr.w / 2, lr.y + lr.h)     ? "bottom"  : "none";
    const corner = hit(lr.x + lr.w,     lr.y + lr.h)     ? "uniform" : "none";
    return right !== "none" ? right : left !== "none" ? left : top !== "none" ? top : bottom !== "none" ? bottom : corner;
  };

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { px, py } = canvasPoint(e);

    if (bgEdit && resizeRef.current.active) {
      const lr = lastRectRef.current; if (!lr) return; const meta = bgList[activeBg]; if (!meta) return;
      const r = innerRect(); let baseW = r.w, baseH = r.h, baseX = r.x, baseY = r.y;
      if (keepAspect) { const s = Math.min(r.w / meta.w, r.h / meta.h); baseW = meta.w * s; baseH = meta.h * s; baseX = r.x + (r.w - baseW) / 2; baseY = r.y + (r.h - baseH) / 2; }
      const ax = resizeRef.current.ax, ay = resizeRef.current.ay;
      setBgXform((cur) => {
        const n = [...cur] as [BgXf, BgXf]; const xf = n[activeBg];
        const clamp = (v: number) => Math.max(0.05, Math.min(10, v));
        let { sx, sy } = xf; const m = resizeRef.current.mode;
        if (anchorMode === "bottom-left") {
          if (m === "right")  sx = clamp((px - ax) / baseW);
          if (m === "left")   sx = clamp((ax - px) / baseW);
          if (m === "top")    sy = clamp((ay - py) / baseH);
          if (m === "bottom") sy = clamp((py - ay) / baseH);
          if (m === "uniform") {
            const dist = Math.hypot(px - ax, py - ay);
            const base = Math.hypot(lr.x + lr.w - ax, lr.y + lr.h - ay);
            const f = base ? dist / base : 1;
            sx = clamp(resizeRef.current.baseSx * f);
            sy = clamp(resizeRef.current.baseSy * f);
          }
        } else {
          if (m === "right")  sx = clamp((2 * Math.max(4, px - ax)) / baseW);
          if (m === "left")   sx = clamp((2 * Math.max(4, ax - px)) / baseW);
          if (m === "top")    sy = clamp((2 * Math.max(4, ay - py)) / baseH);
          if (m === "bottom") sy = clamp((2 * Math.max(4, py - ay)) / baseH);
          if (m === "uniform") {
            const dist = Math.hypot(px - ax, py - ay);
            const base = Math.hypot(lr.x + lr.w / 2 - ax, lr.y + lr.h / 2 - ay);
            const f = base ? (2 * dist) / (2 * base) : 1;
            sx = clamp(resizeRef.current.baseSx * f);
            sy = clamp(resizeRef.current.baseSy * f);
          }
        }
        n[activeBg] = { ...xf, sx, sy }; return n;
      });
      return;
    }

    if (bgEdit && dragRef.current.active) {
      const dx = px - dragRef.current.startX; const dy = py - dragRef.current.startY;
      setBgXform((cur) => { const n = [...cur] as [BgXf, BgXf]; n[activeBg] = { ...n[activeBg], offX: dragRef.current.baseX + dx, offY: dragRef.current.baseY + dy }; return n; });
    }

    if (bgEdit) { const m = pickHandle(px, py); if (m !== hoverHandle) setHoverHandle(m); } else if (hoverHandle !== "none") setHoverHandle("none");

    const rr = innerRect(); if (px >= rr.x && px <= rr.x + rr.w && py >= rr.y && py <= rr.y + rr.h) hoverRef.current = pixelToData(px, py); else hoverRef.current = { x: null, y: null };

    setPad((p) => ({ ...p }));
  };

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { px, py } = canvasPoint(e);
    if (bgEdit) {
      const m = pickHandle(px, py);
      if (m !== "none") {
        const meta = bgList[activeBg]; if (!meta) return;
        const r = innerRect(); let baseW = r.w, baseH = r.h, baseX = r.x, baseY = r.y;
        if (keepAspect) { const s = Math.min(r.w / meta.w, r.h / meta.h); baseW = meta.w * s; baseH = meta.h * s; baseX = r.x + (r.w - baseW) / 2; baseY = r.y + (r.h - baseH) / 2; }
        const xf = bgXform[activeBg]; let ax = baseX, ay = baseY;
        if (anchorMode === "center") { ax = baseX + baseW / 2 + xf.offX; ay = baseY + baseH / 2 + xf.offY; }
        else { ax = baseX + xf.offX; ay = baseY + baseH + xf.offY; }
        resizeRef.current = { active: true, mode: m, baseSx: xf.sx, baseSy: xf.sy, ax, ay };
        return;
      }
      if (overImage(px, py)) {
        dragRef.current = { active: true, startX: px, startY: py, baseX: bgXform[activeBg].offX, baseY: bgXform[activeBg].offY };
        return;
      }
      return; // 편집 모드에서 이미지/핸들 외부 클릭은 무시
    }
    if (!inPlot(px, py)) return;
    const d = pixelToData(px, py);
    setSeries((arr) => arr.map((s, i) => (i === activeSeries ? { ...s, points: s.points.concat([{ x: d.x, y: d.y }]) } : s)));
  };

  const onMouseUp = () => { dragRef.current.active = false; resizeRef.current.active = false; };
  const onMouseLeave = () => { dragRef.current.active = false; resizeRef.current.active = false; };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!bgEdit) return; const { px, py } = canvasPoint(e);
    if (!(inPlot(px, py) || overImage(px, py))) return; e.preventDefault();
    const factor = e.deltaY < 0 ? 1.05 : 0.95;
    setBgXform((cur) => { const n = [...cur] as [BgXf, BgXf]; const xf = n[activeBg]; const clamp = (v: number) => Math.max(0.05, Math.min(10, v)); const s = clamp(xf.sx * factor); n[activeBg] = { ...xf, sx: s, sy: keepAspect ? s : clamp(xf.sy * factor) }; return n; });
  };

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (bgEdit) return; const { px, py } = canvasPoint(e);
    if (!inPlot(px, py)) return; const d = pixelToData(px, py);
    setSeries((arr) => arr.map((s, i) => (i === activeSeries ? { ...s, points: s.points.concat([{ x: d.x, y: d.y }]) } : s)));
  };

  // ===== Export ============================================================
  const toCSV = () => {
    const rows = series.map((s) => s.points.map((p, i) => `${s.name},${i + 1},${p.x},${p.y}`).join("\\n")).filter(Boolean).join("\\n");
    const blob = new Blob(["series,index,x,y\\n" + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `points_${Date.now()}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const exportPNG = () => {
    // 현재 캔버스에 렌더된 모든 내용(그리드/점/선/두 이미지 겹침 포함)을 PNG로 저장
    const c = canvasRef.current; if (!c) return;
    const url = c.toDataURL("image/png");
    const a = document.createElement("a"); a.href = url; a.download = `composite_{Date.now()}.png`.replace("{Date.now()}", String(Date.now())); a.click();
  };

  // ===== 이미지 로더(A/B) ==================================================
  const onFile = (file: File | null, idx: 0 | 1) => {
    if (!file) return; setBgError(null);
    if (bgUrls.current[idx]) { try { URL.revokeObjectURL(bgUrls.current[idx]!); } catch {} bgUrls.current[idx] = null; }
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => {
      const next = bgList.slice(); next[idx] = { w: img.width, h: img.height };
      bgRefs.current[idx] = img; setBgList(next);
      setBgXform((cur) => { const n = [...cur] as [BgXf, BgXf]; n[idx] = { sx: 1, sy: 1, offX: 0, offY: 0 }; return n; });
    };
    img.onerror = () => {
      try {
        const fr = new FileReader();
        fr.onload = () => {
          const dataUrl = String(fr.result || "");
          img.onload = () => { const next = bgList.slice(); next[idx] = { w: img.width, h: img.height }; bgRefs.current[idx] = img; setBgList(next); setBgXform((cur) => { const n = [...cur] as [BgXf, BgXf]; n[idx] = { sx: 1, sy: 1, offX: 0, offY: 0 }; return n; }); };
          img.onerror = () => setBgError("failed to decode image");
          img.src = dataUrl;
        };
        fr.onerror = () => setBgError("file read error");
        fr.readAsDataURL(file);
      } catch { setBgError("load error"); }
    };
    const url = URL.createObjectURL(file); bgUrls.current[idx] = url; img.src = url;
  };

  useEffect(() => { return () => { try { if (bgUrls.current[0]) URL.revokeObjectURL(bgUrls.current[0]!); } catch {} try { if (bgUrls.current[1]) URL.revokeObjectURL(bgUrls.current[1]!); } catch {} }; }, []);

  // ===== 숫자 인풋 렌더러 ===================================================
  const numberInput = (label: string, val: number, setVal: (v: number) => void, step?: number) => (
    <label className="flex items-center gap-2">
      <span className="w-28 text-sm text-gray-600">{label}</span>
      <input type="number" value={Number.isFinite(val) ? val : 0} step={step || 0.1} className="w-44 rounded-xl border border-gray-300 px-3 py-1 focus:outline-none focus:ring" onChange={(e)=> setVal(parseFloat(e.target.value))} />
    </label>
  );

  // ===== 자체 테스트(런타임 경고) ==========================================
  useEffect(() => {
    if (xLog && (xMin <= 0 || xMax <= 0)) console.warn("TEST FAIL: x log domain must be > 0");
    if (yLog && (yMin <= 0 || yMax <= 0)) console.warn("TEST FAIL: y log domain must be > 0");
    const eps = 1e-6; [
      { x: xMin, y: yMin },
      { x: (xMin + xMax) / 2, y: (yMin + yMax) / 2 },
      { x: xMax, y: yMax },
    ].forEach((s) => { const p = dataToPixel(s.x, s.y); const d = pixelToData(p.px, p.py); const ok = Math.abs((d.x - s.x) / (Math.abs(s.x) + eps)) < 1e-4 && Math.abs((d.y - s.y) / (Math.abs(s.y) + eps)) < 1e-4; if (!ok) console.warn("TEST FAIL: round-trip", { s, d }); });
    const p1 = dataToPixel(xMin, yMin).px, p2 = dataToPixel(xMax, yMin).px; const q1 = dataToPixel(xMin, yMin).py, q2 = dataToPixel(xMin, yMax).py; if (!(p2 > p1)) console.warn("TEST FAIL: x monotonic"); if (!(q1 > q2)) console.warn("TEST FAIL: y monotonic");
    const scTest = [-100, 0.001, 0.05, 1, 5, 12];
    const clamped = scTest.map((s) => Math.min(10, Math.max(0.05, s)));
    const okClamp = clamped[0] === 0.05 && clamped[1] === 0.05 && clamped[2] === 0.05 && clamped[3] === 1 && clamped[4] === 5 && clamped[5] === 10;
    if (!okClamp) console.warn("TEST FAIL: scale clamp logic broken", clamped);
  }, [xMin, xMax, yMin, yMax, xLog, yLog]);

  // ===== JSX ================================================================
  return (
    <div className="min-h-screen w-full bg-gray-50 p-4">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Log-scale Graph Digitizer</h1>
          <div className="text-sm text-gray-600">Click to add points • Hover to preview</div>
        </header>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-[1fr,360px]">
          {/* ==== Canvas panel ==== */}
          <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
            <canvas
              ref={canvasRef}
              width={size.w}
              height={size.h}
              onMouseMove={onMove}
              onMouseDown={onMouseDown}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseLeave}
              onWheel={onWheel}
              onClick={onClick}
              onDragOver={(e)=>{e.preventDefault();}}
              onDrop={(e)=>{e.preventDefault(); const f=e.dataTransfer.files && e.dataTransfer.files[0]; if(f) onFile(f as any, activeBg);}}
              className={"h-auto w-full rounded-xl border border-gray-200 " + (bgEdit ? (hoverHandle !== "none" ? "cursor-nwse-resize" : "cursor-move") : "cursor-crosshair")}
              style={{ aspectRatio: `${size.w}/${size.h}` }}
            />

            {/* 그래프 바로 아래 퀵바 */}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-gray-700">
              <div>
                {hoverRef.current.x !== null && hoverRef.current.y !== null ? (
                  <span>Hover: x={(xLog?hoverRef.current.x.toExponential(3):hoverRef.current.x.toPrecision(6))}, y={(yLog?hoverRef.current.y.toExponential(3):hoverRef.current.y.toPrecision(6))}</span>
                ) : (<span>Hover: -</span>)}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={()=> setSeries((arr)=> arr.map((s,i)=> i===activeSeries? { ...s, points: s.points.slice(0, Math.max(0, s.points.length-1)) } : s))} className="rounded-xl bg-gray-100 px-3 py-1 hover:bg-gray-200">Undo</button>
                <button onClick={()=> setSeries((arr)=> arr.map((s,i)=> i===activeSeries? { ...s, points: [] } : s))} className="rounded-xl bg-gray-100 px-3 py-1 hover:bg-gray-200">Clear</button>
                <button onClick={toCSV} className="rounded-xl bg-gray-100 px-3 py-1 hover:bg-gray-200">Export CSV</button>
                <button onClick={exportPNG} className="rounded-xl bg-blue-600 px-3 py-1 text-white hover:bg-blue-700">Export PNG</button>
              </div>
            </div>

            {/* BG 편집 툴바(그래프 근처) */}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={bgEdit} onChange={(e)=>setBgEdit(e.target.checked)} /> Edit background</label>
              <div className="flex items-center gap-2">
                <span className="text-gray-600">Edit target</span>
                <label className="flex items-center gap-1"><input type="radio" checked={activeBg===0} onChange={()=>setActiveBg(0)} /> A</label>
                <label className="flex items-center gap-1"><input type="radio" checked={activeBg===1} onChange={()=>setActiveBg(1)} /> B</label>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-600">Anchor</span>
                <label className="flex items-center gap-1"><input type="radio" checked={anchorMode==='center'} onChange={()=>setAnchorMode('center')} /> center</label>
                <label className="flex items-center gap-1"><input type="radio" checked={anchorMode==='bottom-left'} onChange={()=>setAnchorMode('bottom-left')} /> bottom-left</label>
              </div>
              <div className="flex items-center gap-2">
                <button className="rounded-lg bg-gray-100 px-2 py-1 hover:bg-gray-200" onClick={()=> setBgXform((cur)=>{ const n=[...cur] as [BgXf,BgXf]; n[activeBg]={...n[activeBg], offX:0, offY:0}; return n; })}>Reset pos</button>
                <button className="rounded-lg bg-gray-100 px-2 py-1 hover:bg-gray-200" onClick={()=> setBgXform((cur)=>{ const n=[...cur] as [BgXf,BgXf]; n[activeBg]={ sx:1, sy:1, offX:0, offY:0 }; return n; })}>Fit & reset</button>
              </div>
            </div>
          </div>

          {/* ==== Controls panel ==== */}
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-lg font-medium">Axes</h2>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2"><input type="checkbox" checked={xLog} onChange={(e)=>setXLog(e.target.checked)} /><span>X Log10</span></label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={yLog} onChange={(e)=>setYLog(e.target.checked)} /><span>Y Log10</span></label>
            </div>
            <div className="space-y-2">
              {numberInput("X min", xMin, setXMin, 0.1)}
              {numberInput("X max", xMax, setXMax, 0.1)}
              {numberInput("Y min", yMin, setYMin, 0.1)}
              {numberInput("Y max", yMax, setYMax, 0.1)}
            </div>

            <h2 className="mt-5 mb-2 text-lg font-medium">Series</h2>
            <div className="mb-3 space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                {series.map((s,i)=> (
                  <label key={i} className="flex items-center gap-2">
                    <input type="radio" checked={activeSeries===i} onChange={()=>setActiveSeries(i)} />
                    <span className="inline-flex items-center gap-2"><span style={{ background:s.color }} className="inline-block h-3 w-3 rounded" />{s.name}</span>
                  </label>
                ))}
                <button className="rounded-xl bg-gray-100 px-3 py-1 hover:bg-gray-200" onClick={()=> setSeries((arr)=> arr.concat([{ name: `Series ${String.fromCharCode(65+arr.length)}`, color: palette[arr.length % palette.length], points: [] }]))}>Add</button>
              </div>
              {/* 선 연결 옵션 */}
              <div className="mt-2 rounded-xl border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={connectLines} onChange={(e)=> setConnectLines(e.target.checked)} /> Connect points</label>
                  <label className="flex items-center gap-2"><input type="checkbox" disabled={!connectLines} checked={connectSortX} onChange={(e)=> setConnectSortX(e.target.checked)} /> Sort by X</label>
                  <label className="flex items-center gap-2"><span>Width</span><input type="number" min={0.5} step={0.5} value={lineWidth} disabled={!connectLines} onChange={(e)=> setLineWidth(parseFloat(e.target.value)||1.5)} className="w-20 rounded border px-2 py-1" /></label>
                  <label className="flex items-center gap-2"><span>Alpha</span><input type="range" min={0.1} max={1} step={0.05} value={lineAlpha} disabled={!connectLines} onChange={(e)=> setLineAlpha(parseFloat((e.target as HTMLInputElement).value))} className="w-36" /><span className="w-10 text-right">{lineAlpha.toFixed(2)}</span></label>
                </div>
              </div>
            </div>

            <h2 className="mt-5 mb-2 text-lg font-medium">Background</h2>
            <div className="space-y-3">
              <div className="space-y-1">
                <div className="text-sm text-gray-600">Upload BG A / BG B</div>
                <div className="flex items-center gap-2">
                  <input type="file" accept="image/*" onChange={(e)=> onFile((e.target.files && e.target.files[0]) || null, 0)} />
                  <input type="file" accept="image/*" onChange={(e)=> onFile((e.target.files && e.target.files[0]) || null, 1)} />
                </div>
                <div className="text-xs text-gray-500">A: {bgList[0]?`${bgList[0].w}x${bgList[0].h}`:"-"} · B: {bgList[1]?`${bgList[1].w}x${bgList[1].h}`:"-"}</div>
              </div>

              {/* 표시/투명도 개별 제어 */}
              <div className="rounded-xl border p-3 text-sm">
                <div className="mb-2 text-gray-700">Visibility & Opacity</div>
                <div className="grid grid-cols-1 gap-2">
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={showAB[0]} onChange={(e)=> setShowAB(([a,b])=> [e.target.checked, b])} /> Show A</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={showAB[1]} onChange={(e)=> setShowAB(([a,b])=> [a, e.target.checked])} /> Show B</label>
                  </div>
                  <label className="flex items-center gap-2"><span className="w-28 text-gray-600">Opacity A</span><input type="range" min={0} max={1} step={0.05} value={opacityAB[0]} onChange={(e)=> setOpacityAB(([oa,ob])=> [parseFloat((e.target as HTMLInputElement).value), ob])} className="w-full" /><span className="w-12 text-right">{opacityAB[0].toFixed(2)}</span></label>
                  <label className="flex items-center gap-2"><span className="w-28 text-gray-600">Opacity B</span><input type="range" min={0} max={1} step={0.05} value={opacityAB[1]} onChange={(e)=> setOpacityAB(([oa,ob])=> [oa, parseFloat((e.target as HTMLInputElement).value)])} className="w-full" /><span className="w-12 text-right">{opacityAB[1].toFixed(2)}</span></label>
                </div>
              </div>

              <label className="flex items-center gap-2"><input type="checkbox" checked={keepAspect} onChange={(e)=>setKeepAspect(e.target.checked)} /><span className="text-sm">Keep aspect ratio</span></label>

              {/* 활성 레이어 파인 튠 */}
              <div className="mt-2 rounded-xl border p-3">
                <div className="mb-2 text-sm text-gray-700">Fine tune (Edit target: {activeBg===0?"A":"B"})</div>
                <div className="space-y-2">
                  {keepAspect
                    ? numberInput("Scale", bgXform[activeBg].sx, (v)=> setBgXform((cur)=>{ const n=[...cur] as [BgXf,BgXf]; const s=Math.max(0.05,Math.min(10,v||1)); n[activeBg]={...n[activeBg], sx:s, sy:s}; return n; }), 0.01)
                    : (<>
                        {numberInput("Scale X", bgXform[activeBg].sx, (v)=> setBgXform((cur)=>{ const n=[...cur] as [BgXf,BgXf]; n[activeBg]={...n[activeBg], sx: Math.max(0.05, Math.min(10, v||1))}; return n; }), 0.01)}
                        {numberInput("Scale Y", bgXform[activeBg].sy, (v)=> setBgXform((cur)=>{ const n=[...cur] as [BgXf,BgXf]; n[activeBg]={...n[activeBg], sy: Math.max(0.05, Math.min(10, v||1))}; return n; }), 0.01)}
                      </>)}
                  {numberInput("Offset X", bgXform[activeBg].offX, (v)=> setBgXform((cur)=>{ const n=[...cur] as [BgXf,BgXf]; n[activeBg]={...n[activeBg], offX:v||0}; return n; }), 1)}
                  {numberInput("Offset Y", bgXform[activeBg].offY, (v)=> setBgXform((cur)=>{ const n=[...cur] as [BgXf,BgXf]; n[activeBg]={...n[activeBg], offY:v||0}; return n; }), 1)}
                </div>
                <div className="mt-2 text-xs text-gray-500">Side handles = 축 단방향 리사이즈, Corner = 균일 리사이즈. Edit 모드에서 마우스 휠로 줌.</div>
              </div>
            </div>

            <h2 className="mt-5 mb-2 text-lg font-medium">Canvas</h2>
            <div className="grid grid-cols-2 gap-2">
              {numberInput("Width", size.w, (v)=> setSize((s)=> ({ w:v, h:s.h })), 10)}
              {numberInput("Height", size.h, (v)=> setSize((s)=> ({ w:s.w, h:v })), 10)}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {numberInput("Pad L", pad.left, (v)=> setPad((p)=> ({...p, left:v})), 1)}
              {numberInput("Pad R", pad.right, (v)=> setPad((p)=> ({...p, right:v})), 1)}
              {numberInput("Pad T", pad.top, (v)=> setPad((p)=> ({...p, top:v})), 1)}
              {numberInput("Pad B", pad.bottom, (v)=> setPad((p)=> ({...p, bottom:v})), 1)}
            </div>

            <h2 className="mt-5 mb-2 text-lg font-medium">Points ({series[activeSeries].points.length})</h2>
            <div className="max-h-48 overflow-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50"><tr className="text-left"><th className="px-2 py-1">#</th><th className="px-2 py-1">x</th><th className="px-2 py-1">y</th><th className="px-2 py-1"></th></tr></thead>
                <tbody>
                  {series[activeSeries].points.map((p,i)=> (
                    <tr key={i} className="odd:bg-white even:bg-gray-50">
                      <td className="px-2 py-1">{i+1}</td>
                      <td className="px-2 py-1 font-mono">{xLog? p.x.toExponential(6) : p.x.toPrecision(8)}</td>
                      <td className="px-2 py-1 font-mono">{yLog? p.y.toExponential(6) : p.y.toPrecision(8)}</td>
                      <td className="px-2 py-1 text-right"><button className="rounded-lg bg-gray-100 px-2 py-0.5 hover:bg-gray-200" onClick={()=> setSeries((arr)=> arr.map((s,idx)=> idx===activeSeries? { ...s, points: s.points.filter((_,j)=> j!==i) } : s))}>remove</button></td>
                    </tr>
                  ))}
                  {series[activeSeries].points.length===0 && (
                    <tr><td className="px-2 py-2 text-sm text-gray-500" colSpan={4}>No points yet. Click on canvas to add.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {bgError && <div className="mt-3 text-sm text-red-600">Image error: {bgError}</div>}
          </div>
        </section>

        <footer className="text-xs text-gray-500">
          <div>Tips:</div>
          <ul className="list-disc pl-5">
            <li>Upload, drop, or paste images into A/B. Choose Edit target to transform that layer.</li>
            <li>Use the per-layer visibility & opacity to overlay two graphs and compare.</li>
            <li>Export PNG saves the current composite exactly as shown.</li>
          </ul>
        </footer>
      </div>
    </div>
  );
}
