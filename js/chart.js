/**
 * Chart wrapper (v3):
 *  - Guarantees candlesticks always render (sanitizes & deduplicates timestamps,
 *    explicitly sizes the chart container, guards logical range bounds, and includes
 *    a built-in native Canvas candlestick fallback if the CDN is ever blocked).
 *  - Draws the TradingView-style BLUE & RED Position Tool (Red = Stop Loss zone,
 *    Blue = Take Profit zone with 50% TP1 + Breakeven divider) just like PDF 1 p.1, 4, 21–30.
 */
(function () {
  const T = window.CRTTime;

  const THEME = {
    bg: '#080c14',
    grid: 'rgba(148,163,184,0.07)',
    text: '#94a3b8',
    up: '#3b82f6',        // PDF 1 CRT Blue for bullish candles
    down: '#e2e8f0',      // High-contrast crisp slate/white-edge for bearish candles
    downFill: '#1e293b',
    wickUp: '#60a5fa',
    wickDown: '#94a3b8'
  };

  // Deduplicate & sort candles strictly ascending by time (required by Lightweight Charts)
  function cleanCandles(raw) {
    if (!Array.isArray(raw) || !raw.length) return [];
    const sorted = raw
      .filter(c => c && isFinite(c.time) && isFinite(c.open) && isFinite(c.high) && isFinite(c.low) && isFinite(c.close))
      .slice()
      .sort((a, b) => a.time - b.time);
    const out = [];
    for (const c of sorted) {
      const hi = Math.max(c.open, c.high, c.low, c.close);
      const lo = Math.min(c.open, c.high, c.low, c.close);
      const item = { time: c.time, open: c.open, high: hi, low: lo, close: c.close };
      if (out.length && T.toChartTime(out[out.length - 1].time) === T.toChartTime(item.time)) {
        out[out.length - 1] = item;
      } else {
        out.push(item);
      }
    }
    return out;
  }

  function roundedRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  class CRTChart {
    constructor(container, { title = '' } = {}) {
      this.container = container;
      this.data = [];
      this.ann = null;
      this.granMs = 60000;
      this.decimals = 2;
      container.innerHTML = '';
      container.style.position = 'relative';

      // Dedicated inner mount div for LightweightCharts so overlay canvas never interferes with autoSize
      this.mount = document.createElement('div');
      Object.assign(this.mount.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        zIndex: '1'
      });
      container.appendChild(this.mount);

      this.hasLWC = typeof window.LightweightCharts !== 'undefined';

      if (this.hasLWC) {
        const w = Math.max(container.clientWidth || 520, 300);
        const h = Math.max(container.clientHeight || 390, 260);
        this.chart = LightweightCharts.createChart(this.mount, {
          width: w,
          height: h,
          layout: { background: { color: THEME.bg }, textColor: THEME.text, fontFamily: 'Inter, sans-serif', fontSize: 11 },
          grid: { vertLines: { color: THEME.grid }, horzLines: { color: THEME.grid } },
          rightPriceScale: { borderColor: 'rgba(148,163,184,0.16)', scaleMargins: { top: 0.10, bottom: 0.10 } },
          timeScale: { borderColor: 'rgba(148,163,184,0.16)', timeVisible: true, secondsVisible: false, rightOffset: 10, barSpacing: 8 },
          crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
          localization: { timeFormatter: t => T.fmtCAT(T.fromChartTime(t)) + ' CAT' }
        });
        this.series = this.chart.addCandlestickSeries({
          upColor: '#2563eb',
          downColor: '#0f172a',
          borderUpColor: '#60a5fa',
          borderDownColor: '#cbd5e1',
          wickUpColor: '#60a5fa',
          wickDownColor: '#94a3b8'
        });
        this.priceLines = [];
      }

      this.canvas = document.createElement('canvas');
      Object.assign(this.canvas.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '2' });
      container.appendChild(this.canvas);

      this.titleEl = document.createElement('div');
      this.titleEl.className = 'chart-watermark';
      this.titleEl.textContent = title;
      container.appendChild(this.titleEl);

      const onResize = () => {
        if (this.chart) {
          const rw = Math.max(this.container.clientWidth, 260);
          const rh = Math.max(this.container.clientHeight, 240);
          this.chart.applyOptions({ width: rw, height: rh });
        }
        this.requestDraw();
      };

      if (this.chart) {
        this.chart.timeScale().subscribeVisibleLogicalRangeChange(() => this.requestDraw());
        this.chart.subscribeCrosshairMove(() => this.requestDraw());
      }
      new ResizeObserver(onResize).observe(container);
      container.addEventListener('wheel', () => this.requestDraw(), { passive: true });
      container.addEventListener('mouseup', () => this.requestDraw());
    }

    setTitle(t) { if (this.titleEl) this.titleEl.textContent = t; }

    setPrecision(decimals) {
      this.decimals = decimals;
      if (this.series) {
        this.series.applyOptions({ priceFormat: { type: 'price', precision: decimals, minMove: Math.pow(10, -decimals) } });
      }
    }

    setData(candles, granMs) {
      this.granMs = granMs || this.granMs || 60000;
      const cleaned = cleanCandles(candles);
      this.data = cleaned;
      if (this.series && cleaned.length) {
        try {
          const lwcData = cleaned.map(c => ({
            time: T.toChartTime(c.time),
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close
          }));
          this.series.setData(lwcData);
          this.fit(95);
        } catch (err) {
          console.warn('LWC setData fallback:', err);
        }
      }
      this.requestDraw();
    }

    update(c) {
      if (!c || !isFinite(c.time) || !isFinite(c.close)) return;
      const last = this.data[this.data.length - 1];
      if (last && T.toChartTime(c.time) < T.toChartTime(last.time)) return;
      if (last && T.toChartTime(c.time) === T.toChartTime(last.time)) {
        this.data[this.data.length - 1] = c;
      } else {
        this.data.push(c);
      }
      if (this.series) {
        try {
          this.series.update({
            time: T.toChartTime(c.time),
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close
          });
        } catch (e) {}
      }
      this.requestDraw();
    }

    fit(bars = 95) {
      const n = this.data.length;
      if (!n || !this.chart) return;
      this.chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, n - bars),
        to: n + 8
      });
      this.requestDraw();
    }

    focusTime(ms, barsBefore = 45, barsAfter = 30) {
      if (!this.chart || !this.data.length || !isFinite(ms)) {
        this.fit(90);
        return;
      }
      const idx = this.indexOf(ms);
      if (!isFinite(idx)) {
        this.fit(90);
        return;
      }
      const from = Math.max(0, idx - barsBefore);
      const to = Math.min(this.data.length + 10, Math.max(from + 20, idx + barsAfter));
      this.chart.timeScale().setVisibleLogicalRange({ from, to });
      this.requestDraw();
    }

    indexOf(ms) {
      const d = this.data;
      if (!d.length || !isFinite(ms)) return 0;
      const g = Math.max(this.granMs || 60000, 1000);
      if (ms <= d[0].time) return (ms - d[0].time) / g;
      if (ms >= d[d.length - 1].time) return d.length - 1 + (ms - d[d.length - 1].time) / g;
      let lo = 0, hi = d.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (d[mid].time <= ms) lo = mid; else hi = mid;
      }
      const span = Math.max(d[hi].time - d[lo].time, 1);
      return lo + Math.min(1, (ms - d[lo].time) / Math.min(span, g));
    }

    x(ms) {
      if (!this.chart) return null;
      return this.chart.timeScale().logicalToCoordinate(this.indexOf(ms));
    }
    y(p) {
      if (!this.series || !isFinite(p)) return null;
      return this.series.priceToCoordinate(p);
    }

    setAnnotations(ann) {
      this.ann = ann;
      if (this.series) {
        this.priceLines.forEach(pl => {
          try { this.series.removePriceLine(pl); } catch (e) {}
        });
        this.priceLines = (ann?.priceLines || []).map(p => this.series.createPriceLine({
          price: p.price,
          color: p.color,
          lineWidth: p.width || 1,
          lineStyle: p.style ?? 2,
          axisLabelVisible: true,
          title: p.title
        }));

        const snap = ms => {
          if (!this.data.length) return null;
          const i = Math.round(Math.max(0, Math.min(this.data.length - 1, this.indexOf(ms))));
          return this.data[i] ? T.toChartTime(this.data[i].time) : null;
        };
        const rawMarkers = (ann?.markers || [])
          .map(m => ({ ...m, time: snap(m.time) }))
          .filter(m => m.time != null)
          .sort((a, b) => a.time - b.time);
        // Deduplicate markers on the exact same bar timestamp if needed
        try { this.series.setMarkers(rawMarkers); } catch (e) {}
      }
      this.requestDraw();
    }

    requestDraw() {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => { this.raf = null; this.draw(); });
    }

    draw() {
      const rect = this.container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const cv = this.canvas;
      if (cv.width !== Math.round(rect.width * dpr) || cv.height !== Math.round(rect.height * dpr)) {
        cv.width = Math.round(rect.width * dpr);
        cv.height = Math.round(rect.height * dpr);
        cv.style.width = rect.width + 'px';
        cv.style.height = rect.height + 'px';
      }
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      if (!this.data.length) return;

      // Fallback native candlestick drawing if LightweightCharts CDN was blocked
      if (!this.hasLWC) {
        this.drawFallbackCandles(ctx, rect.width, rect.height);
        return;
      }
      if (!this.ann) return;

      const rightScaleW = this.chart.priceScale('right').width() || 68;
      const timeScaleH = this.chart.timeScale().height() || 26;
      const plotW = rect.width - rightScaleW;
      const plotH = rect.height - timeScaleH;

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, plotW, plotH);
      ctx.clip();

      // 1. Session bands (full height)
      for (const b of this.ann.bands || []) {
        const x1 = this.x(b.from), x2 = this.x(b.to);
        if (x1 == null || x2 == null || x2 < 0 || x1 > plotW) continue;
        ctx.fillStyle = b.fill;
        ctx.fillRect(x1, 0, x2 - x1, plotH);
        if (x2 - x1 > 46) {
          ctx.fillStyle = b.labelColor || 'rgba(148,163,184,0.55)';
          ctx.font = '600 9px Inter, sans-serif';
          ctx.fillText(b.label, Math.max(x1, 0) + 4, plotH - 6);
        }
      }

      // 2. Boxes (CRT Range, Key Levels, Inside Candles, OTE Zone)
      for (const b of this.ann.boxes || []) {
        const x1 = this.x(b.from), x2 = this.x(b.to);
        const y1 = this.y(b.top), y2 = this.y(b.bottom);
        if ([x1, x2, y1, y2].some(v => v == null)) continue;
        const h = Math.max(Math.abs(y2 - y1), 2);
        const top = Math.min(y1, y2);
        if (b.fill) { ctx.fillStyle = b.fill; ctx.fillRect(x1, top, x2 - x1, h); }
        if (b.stroke) {
          ctx.strokeStyle = b.stroke;
          ctx.lineWidth = b.lineWidth || 1.2;
          ctx.setLineDash(b.dash ? [4, 3] : []);
          ctx.strokeRect(x1 + 0.5, top + 0.5, x2 - x1, h);
          ctx.setLineDash([]);
        }
        if (b.label) {
          this.tag(ctx, b.label, Math.max(x1, 2) + 4, (b.labelPos === 'bottom' ? top + h - 10 : top + 10), b.labelColor || b.stroke || '#94a3b8', plotW);
        }
      }

      // 3. Lines (CRTH, 50% Midpoint, CRTL, Model #1 Trigger)
      for (const l of this.ann.lines || []) {
        const x1 = l.from != null ? this.x(l.from) : 0;
        const x2 = l.to != null ? this.x(l.to) : plotW;
        const y = this.y(l.price);
        if (x1 == null || x2 == null || y == null) continue;
        ctx.strokeStyle = l.color;
        ctx.lineWidth = l.width || 1.3;
        ctx.setLineDash(l.dash ? [5, 4] : []);
        ctx.beginPath();
        ctx.moveTo(x1, Math.round(y) + 0.5);
        ctx.lineTo(x2, Math.round(y) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
        if (l.label) this.tag(ctx, l.label, Math.min(Math.max(x1, 2) + 4, plotW - 110), y - 10, l.color, plotW);
      }

      // 4. Prominent TradingView-style BLUE & RED Position Tool (Entry, Stop Loss, TP1 50%, TP2 100%)
      if (this.ann.positionBox) {
        this.drawPositionBox(ctx, this.ann.positionBox, plotW, plotH);
      }

      ctx.restore();
    }

    /**
     * Draws the unmistakable BLUE & RED Entry / Stop-Loss / TP1 / TP2 Position Tool
     * (Red box = Stop Loss Risk Zone, Blue box = Profit Target Zone with 50% TP1 + BE line)
     */
    drawPositionBox(ctx, pos, plotW) {
      const x1 = this.x(pos.from);
      const x2 = Math.min(plotW - 6, Math.max((this.x(pos.to) ?? (x1 + 140)), (x1 ?? 0) + 110));
      const yEntry = this.y(pos.entry);
      const ySL = this.y(pos.sl);
      const yTP1 = this.y(pos.tp1);
      const yTP2 = this.y(pos.tp2);
      if ([x1, yEntry, ySL, yTP1, yTP2].some(v => v == null)) return;

      const boxW = Math.max(80, x2 - x1);
      const dec = this.decimals || 2;

      // A. RED BOX — Stop Loss Zone (Entry ↔ Stop Loss)
      const slTop = Math.min(yEntry, ySL);
      const slH = Math.max(Math.abs(ySL - yEntry), 6);
      const redGrad = ctx.createLinearGradient(0, slTop, 0, slTop + slH);
      redGrad.addColorStop(0, 'rgba(244, 63, 94, 0.34)');
      redGrad.addColorStop(1, 'rgba(225, 29, 72, 0.22)');
      ctx.fillStyle = redGrad;
      ctx.fillRect(x1, slTop, boxW, slH);

      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(x1 + 0.5, slTop + 0.5, boxW, slH);

      // B. BLUE BOX — Take Profit Zone (Entry ↔ TP2 100% CRT)
      const tpTop = Math.min(yEntry, yTP2);
      const tpH = Math.max(Math.abs(yTP2 - yEntry), 8);
      const blueGrad = ctx.createLinearGradient(0, tpTop, 0, tpTop + tpH);
      blueGrad.addColorStop(0, 'rgba(37, 99, 235, 0.36)');
      blueGrad.addColorStop(1, 'rgba(14, 165, 233, 0.24)');
      ctx.fillStyle = blueGrad;
      ctx.fillRect(x1, tpTop, boxW, tpH);

      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(x1 + 0.5, tpTop + 0.5, boxW, tpH);

      // C. Solid White/Cyan Entry Line separating Red & Blue boxes
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(x1, yEntry);
      ctx.lineTo(x1 + boxW, yEntry);
      ctx.stroke();

      // D. Amber Dashed 50% Rule Line (TP1 — Shave 50% & Move SL to Breakeven)
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1.7;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(x1, yTP1);
      ctx.lineTo(x1 + boxW, yTP1);
      ctx.stroke();
      ctx.setLineDash([]);

      // E. Crisp Callout Badges on the Position Box
      this.pill(ctx, `STOP LOSS ${pos.sl.toFixed(dec)} (-1R)`, x1 + 6, ySL + (pos.isBear ? -11 : 11), '#be123c', '#ffffff', plotW);
      this.pill(ctx, `${pos.dir} ENTRY ${pos.entry.toFixed(dec)}`, x1 + 6, yEntry, '#1d4ed8', '#ffffff', plotW);
      this.pill(ctx, `TP1 (50% + BE) ${pos.tp1.toFixed(dec)} (1:${pos.rr1.toFixed(2)})`, x1 + 6, yTP1, '#b45309', '#ffffff', plotW);
      this.pill(ctx, `TP2 (100% CRT) ${pos.tp2.toFixed(dec)} (1:${pos.rr2.toFixed(2)})`, x1 + 6, yTP2 + (pos.isBear ? 11 : -11), '#047857', '#ffffff', plotW);
    }

    pill(ctx, text, x, y, bg, fg, maxX) {
      ctx.save();
      ctx.font = '700 10px "JetBrains Mono", monospace';
      const w = ctx.measureText(text).width + 12;
      const h = 18;
      const xx = Math.max(4, Math.min(x, maxX - w - 4));
      const yy = y - h / 2;
      ctx.fillStyle = bg;
      roundedRect(ctx, xx, yy, w, h, 4);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = fg;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, xx + 6, y + 0.5);
      ctx.restore();
    }

    tag(ctx, text, x, y, color, maxX) {
      ctx.font = '600 10px Inter, sans-serif';
      const w = ctx.measureText(text).width + 10;
      const xx = Math.max(2, Math.min(x, maxX - w - 2));
      ctx.fillStyle = 'rgba(8, 12, 20, 0.88)';
      ctx.fillRect(xx, y - 8, w, 16);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(xx + 0.5, y - 7.5, w - 1, 15);
      ctx.fillStyle = color;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, xx + 5, y + 0.5);
      ctx.textBaseline = 'alphabetic';
    }

    drawFallbackCandles(ctx, width, height) {
      const candles = this.data.slice(-80);
      if (!candles.length) return;
      ctx.fillStyle = THEME.bg;
      ctx.fillRect(0, 0, width, height);
      const padL = 10, padR = 72, padT = 24, padB = 24;
      const pw = width - padL - padR, ph = height - padT - padB;
      let minP = Infinity, maxP = -Infinity;
      candles.forEach(c => { if (c.low < minP) minP = c.low; if (c.high > maxP) maxP = c.high; });
      const m = (maxP - minP) * 0.1 || 1;
      minP -= m; maxP += m;
      const py = p => padT + ((maxP - p) / (maxP - minP)) * ph;
      const step = pw / candles.length;
      const cw = Math.max(3, step * 0.68);
      candles.forEach((c, i) => {
        const cx = padL + (i + 0.5) * step;
        const bull = c.close >= c.open;
        ctx.strokeStyle = bull ? '#60a5fa' : '#94a3b8';
        ctx.beginPath(); ctx.moveTo(cx, py(c.high)); ctx.lineTo(cx, py(c.low)); ctx.stroke();
        const top = Math.min(py(c.open), py(c.close));
        const bh = Math.max(2, Math.abs(py(c.close) - py(c.open)));
        ctx.fillStyle = bull ? '#2563eb' : '#1e293b';
        ctx.fillRect(cx - cw / 2, top, cw, bh);
        ctx.strokeRect(cx - cw / 2, top, cw, bh);
      });
    }

    destroy() { if (this.chart) this.chart.remove(); }
  }

  /* Equity curve chart for the backtester */
  function equityChart(container) {
    container.innerHTML = '';
    if (typeof window.LightweightCharts === 'undefined') return { set() {} };
    const w = Math.max(container.clientWidth || 600, 300);
    const h = Math.max(container.clientHeight || 250, 220);
    const chart = LightweightCharts.createChart(container, {
      width: w,
      height: h,
      layout: { background: { color: THEME.bg }, textColor: THEME.text, fontFamily: 'Inter, sans-serif', fontSize: 11 },
      grid: { vertLines: { color: THEME.grid }, horzLines: { color: THEME.grid } },
      rightPriceScale: { borderColor: 'rgba(148,163,184,0.12)' },
      timeScale: { borderColor: 'rgba(148,163,184,0.12)', timeVisible: true },
      localization: { timeFormatter: t => T.fmtCAT(T.fromChartTime(t)) + ' CAT', priceFormatter: p => p.toFixed(1) + 'R' }
    });
    new ResizeObserver(() => {
      chart.applyOptions({
        width: Math.max(container.clientWidth, 260),
        height: Math.max(container.clientHeight, 200)
      });
    }).observe(container);
    const a = chart.addLineSeries({ color: '#22c55e', lineWidth: 2, title: 'With 50% rule' });
    const b = chart.addLineSeries({ color: '#f43f5e', lineWidth: 2, lineStyle: 2, title: 'Without 50% rule' });
    return {
      set(trades, with50, without50) {
        let last = 0;
        const times = trades.map(t => { let ct = T.toChartTime(t.exitTime); if (ct <= last) ct = last + 1; last = ct; return ct; });
        a.setData(times.map((t, i) => ({ time: t, value: with50.curve[i] })));
        b.setData(times.map((t, i) => ({ time: t, value: without50.curve[i] })));
        chart.timeScale().fitContent();
      }
    };
  }

  window.CRTChart = CRTChart;
  window.CRTEquityChart = equityChart;
})();
