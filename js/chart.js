/**
 * Chart wrapper: TradingView Lightweight Charts (v4) + an overlay canvas for
 * boxes, zones, session bands and labels. Axis displays Central African Time.
 */
(function () {
  const T = window.CRTTime;

  const THEME = {
    bg: '#0a0e15',
    grid: 'rgba(148,163,184,0.06)',
    text: '#8b97a8',
    up: '#26a69a',
    down: '#ef5350'
  };

  class CRTChart {
    constructor(container, { title = '' } = {}) {
      this.container = container;
      this.data = [];
      this.ann = null;
      this.granMs = 60000;
      container.innerHTML = '';
      container.style.position = 'relative';

      this.chart = LightweightCharts.createChart(container, {
        autoSize: true,
        layout: { background: { color: THEME.bg }, textColor: THEME.text, fontFamily: 'Inter, sans-serif', fontSize: 11 },
        grid: { vertLines: { color: THEME.grid }, horzLines: { color: THEME.grid } },
        rightPriceScale: { borderColor: 'rgba(148,163,184,0.12)', scaleMargins: { top: 0.08, bottom: 0.08 } },
        timeScale: { borderColor: 'rgba(148,163,184,0.12)', timeVisible: true, secondsVisible: false, rightOffset: 8 },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        localization: { timeFormatter: t => T.fmtCAT(T.fromChartTime(t)) + ' CAT' }
      });
      this.series = this.chart.addCandlestickSeries({
        upColor: THEME.up, downColor: THEME.down, borderUpColor: THEME.up, borderDownColor: THEME.down,
        wickUpColor: THEME.up, wickDownColor: THEME.down
      });
      this.priceLines = [];

      this.canvas = document.createElement('canvas');
      Object.assign(this.canvas.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: 2 });
      container.appendChild(this.canvas);

      if (title) {
        this.titleEl = document.createElement('div');
        this.titleEl.className = 'chart-watermark';
        this.titleEl.textContent = title;
        container.appendChild(this.titleEl);
      }

      const redraw = () => this.requestDraw();
      this.chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
      this.chart.subscribeCrosshairMove(redraw);
      new ResizeObserver(redraw).observe(container);
      container.addEventListener('wheel', redraw, { passive: true });
      container.addEventListener('mouseup', redraw);
    }

    setTitle(t) { if (this.titleEl) this.titleEl.textContent = t; }

    setPrecision(decimals) {
      this.series.applyOptions({ priceFormat: { type: 'price', precision: decimals, minMove: Math.pow(10, -decimals) } });
      this.decimals = decimals;
    }

    setData(candles, granMs) {
      this.data = candles;
      this.granMs = granMs || this.granMs;
      this.series.setData(candles.map(c => ({ time: T.toChartTime(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
      this.requestDraw();
    }

    update(c) {
      const last = this.data[this.data.length - 1];
      if (last && c.time < last.time) return;
      if (last && c.time === last.time) this.data[this.data.length - 1] = c; else this.data.push(c);
      this.series.update({ time: T.toChartTime(c.time), open: c.open, high: c.high, low: c.low, close: c.close });
      this.requestDraw();
    }

    fit(bars = 120) {
      const n = this.data.length;
      this.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - bars), to: n + 6 });
    }

    focusTime(ms, barsBefore = 60, barsAfter = 60) {
      const idx = this.indexOf(ms);
      this.chart.timeScale().setVisibleLogicalRange({ from: idx - barsBefore, to: idx + barsAfter });
    }

    // fractional bar index for an arbitrary time (extrapolates beyond the data)
    indexOf(ms) {
      const d = this.data;
      if (!d.length) return 0;
      if (ms <= d[0].time) return (ms - d[0].time) / this.granMs;
      if (ms >= d[d.length - 1].time) return d.length - 1 + (ms - d[d.length - 1].time) / this.granMs;
      let lo = 0, hi = d.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (d[mid].time <= ms) lo = mid; else hi = mid;
      }
      const span = d[hi].time - d[lo].time;
      return lo + Math.min(1, (ms - d[lo].time) / Math.min(span, this.granMs));
    }
    x(ms) { return this.chart.timeScale().logicalToCoordinate(this.indexOf(ms)); }
    y(p) { return this.series.priceToCoordinate(p); }

    /**
     * ann = { boxes:[{from,to,top,bottom,fill,stroke,label,labelColor,dash}],
     *         lines:[{from,to,price,color,dash,width,label}],
     *         bands:[{from,to,fill,label}], markers:[{time,position,color,shape,text}],
     *         priceLines:[{price,color,title,style}] }
     */
    setAnnotations(ann) {
      this.ann = ann;
      this.priceLines.forEach(pl => this.series.removePriceLine(pl));
      this.priceLines = (ann.priceLines || []).map(p => this.series.createPriceLine({
        price: p.price, color: p.color, lineWidth: 1, lineStyle: p.style ?? 2, axisLabelVisible: true, title: p.title
      }));
      const snap = ms => {
        const i = Math.round(Math.max(0, Math.min(this.data.length - 1, this.indexOf(ms))));
        return this.data[i] ? T.toChartTime(this.data[i].time) : null;
      };
      const markers = (ann.markers || [])
        .map(m => ({ ...m, time: snap(m.time) }))
        .filter(m => m.time != null)
        .sort((a, b) => a.time - b.time);
      this.series.setMarkers(markers);
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
      if (!this.ann || !this.data.length) return;

      const plotW = rect.width - this.chart.priceScale('right').width();
      const plotH = rect.height - this.chart.timeScale().height();
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, plotW, plotH);
      ctx.clip();

      // session bands (full height)
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

      for (const b of this.ann.boxes || []) {
        const x1 = this.x(b.from), x2 = this.x(b.to);
        const y1 = this.y(b.top), y2 = this.y(b.bottom);
        if ([x1, x2, y1, y2].some(v => v == null)) continue;
        const h = Math.max(Math.abs(y2 - y1), 1);
        const top = Math.min(y1, y2);
        if (b.fill) { ctx.fillStyle = b.fill; ctx.fillRect(x1, top, x2 - x1, h); }
        if (b.stroke) {
          ctx.strokeStyle = b.stroke;
          ctx.lineWidth = 1;
          ctx.setLineDash(b.dash ? [4, 3] : []);
          ctx.strokeRect(x1 + 0.5, top + 0.5, x2 - x1, h);
          ctx.setLineDash([]);
        }
        if (b.label) this.tag(ctx, b.label, Math.max(x1, 2) + 4, (b.labelPos === 'bottom' ? top + h - 9 : top + 9), b.labelColor || b.stroke || '#94a3b8', plotW);
      }

      for (const l of this.ann.lines || []) {
        const x1 = l.from != null ? this.x(l.from) : 0;
        const x2 = l.to != null ? this.x(l.to) : plotW;
        const y = this.y(l.price);
        if (x1 == null || x2 == null || y == null) continue;
        ctx.strokeStyle = l.color;
        ctx.lineWidth = l.width || 1.25;
        ctx.setLineDash(l.dash ? [5, 4] : []);
        ctx.beginPath();
        ctx.moveTo(x1, Math.round(y) + 0.5);
        ctx.lineTo(x2, Math.round(y) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
        if (l.label) this.tag(ctx, l.label, Math.min(Math.max(x1, 2) + 4, plotW - 90), y - 9, l.color, plotW);
      }
      ctx.restore();
    }

    tag(ctx, text, x, y, color, maxX) {
      ctx.font = '600 10px Inter, sans-serif';
      const w = ctx.measureText(text).width + 10;
      const xx = Math.min(x, maxX - w - 2);
      ctx.fillStyle = 'rgba(10,14,21,0.82)';
      ctx.fillRect(xx, y - 8, w, 16);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(xx + 0.5, y - 7.5, w - 1, 15);
      ctx.fillStyle = color;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, xx + 5, y + 0.5);
      ctx.textBaseline = 'alphabetic';
    }

    destroy() { this.chart.remove(); }
  }

  /* Equity curve chart for the backtester */
  function equityChart(container) {
    container.innerHTML = '';
    const chart = LightweightCharts.createChart(container, {
      autoSize: true,
      layout: { background: { color: THEME.bg }, textColor: THEME.text, fontFamily: 'Inter, sans-serif', fontSize: 11 },
      grid: { vertLines: { color: THEME.grid }, horzLines: { color: THEME.grid } },
      rightPriceScale: { borderColor: 'rgba(148,163,184,0.12)' },
      timeScale: { borderColor: 'rgba(148,163,184,0.12)', timeVisible: true },
      localization: { timeFormatter: t => T.fmtCAT(T.fromChartTime(t)) + ' CAT', priceFormatter: p => p.toFixed(1) + 'R' }
    });
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
