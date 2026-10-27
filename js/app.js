/**
 * CRT Terminal v3 — Main Application Controller
 *  - Candlestick charts guaranteed on GitHub Pages & local server
 *  - Prominent TradingView-style BLUE & RED Entry / Stop-Loss / TP1 / TP2 Position Box
 *  - Online Per-Pair Machine Learning Engine (gradually learns how each pair moves)
 *  - Dedicated "Pure Signals (A+ & ML Filtered)" section that rejects random/low-quality trades
 */
(function () {
  const T = window.CRTTime;
  const F = window.CRTFeeds;
  const E = window.CRTEngine;
  const ML = window.CRTML;
  const BT = window.CRTBacktest;

  const state = {
    marketId: 'R_75',
    pairKey: '4H_5m',
    layout: 'split',
    wlCategory: 'all',
    wlActiveOnly: false,
    entryModelView: 'model1', // 'model1' | 'ote' | 'kod'
    showPositionBox: true,
    showSessions: true,
    showOte: true,
    showKl: true,
    alertsOn: true,
    tgToken: '',
    tgChat: '',
    balance: 10000,
    riskPct: 1.0,
    engineOpts: { ...E.DEFAULTS, minRR: 1.15 },
    series: null,
    evalRes: null,
    selectedSetup: null,
    watchStates: new Map(), // marketId -> { market, price, decimals, setup, ml }
    unsubLtf: null,
    alertedIds: new Set(),
    journal: []
  };

  let htfChart, ltfChart, eqChart;

  /* ---------------- Local storage settings & journal ---------------- */
  function loadPrefs() {
    try {
      const s = JSON.parse(localStorage.getItem('crt_v2_prefs') || '{}');
      if (s.balance) state.balance = +s.balance;
      if (s.riskPct) state.riskPct = +s.riskPct;
      if (s.engineOpts) Object.assign(state.engineOpts, s.engineOpts);
      if (typeof s.alertsOn === 'boolean') state.alertsOn = s.alertsOn;
      if (s.tgToken) state.tgToken = s.tgToken;
      if (s.tgChat) state.tgChat = s.tgChat;
    } catch (e) {}
    try {
      const j = JSON.parse(localStorage.getItem('crt_v2_journal') || 'null');
      if (Array.isArray(j) && j.length) state.journal = j;
      else {
        state.journal = [
          {
            date: T.fmtCAT(Date.now() - 3600e3 * 18),
            market: 'Volatility 75 Index',
            pair: '4H → 5m',
            dir: 'SELL',
            model: 'Model #1',
            took50: 'Yes',
            r: 2.15,
            mistake: 'None — followed the plan',
            notes: 'Clean 4H CRTH sweep with 3 inside candles before TBS body close on 5m. Shaved 50% at midpoint and rode runner to CRTL.'
          },
          {
            date: T.fmtCAT(Date.now() - 3600e3 * 11),
            market: 'PainX 400',
            pair: '1H → 1m',
            dir: 'SELL',
            model: 'Model #1',
            took50: 'Yes',
            r: 1.90,
            mistake: 'None — followed the plan',
            notes: 'Weltrade SyntX PainX 400 1H CRTH purge aligned with drop direction. Closed 50% at 50% equilibrium and held runner to CRTL.'
          },
          {
            date: T.fmtCAT(Date.now() - 3600e3 * 5),
            market: 'Gold XAU/USD',
            pair: '4H → 5m',
            dir: 'BUY',
            model: 'CRT OTE',
            took50: 'Yes',
            r: 0.78,
            mistake: 'None — followed the plan',
            notes: '11:00–15:00 CAT manipulation swept 4H CRTL while Silver held its low (SMT). Hit 50% TP1 then reversed to BE.'
          }
        ];
      }
    } catch (e) { state.journal = []; }
  }

  function savePrefs() {
    try {
      localStorage.setItem('crt_v2_prefs', JSON.stringify({
        balance: state.balance,
        riskPct: state.riskPct,
        engineOpts: state.engineOpts,
        alertsOn: state.alertsOn,
        tgToken: state.tgToken,
        tgChat: state.tgChat
      }));
    } catch (e) {}
  }

  function saveJournal() {
    try { localStorage.setItem('crt_v2_journal', JSON.stringify(state.journal)); } catch (e) {}
  }

  /* ---------------- Audio, Browser & Telegram Alerts ---------------- */
  function playAlertTone() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      [587.33, 880].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.12, ctx.currentTime + idx * 0.14);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.14 + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.14);
        osc.stop(ctx.currentTime + idx * 0.14 + 0.26);
      });
    } catch (e) {}
  }

  function toast(msg) {
    const host = document.getElementById('toasts');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = msg;
    host.appendChild(el);
    setTimeout(() => el.remove(), 6500);
  }

  function sendTelegramAlert(text) {
    if (!state.tgToken || !state.tgChat) return;
    fetch(`https://api.telegram.org/bot${state.tgToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: state.tgChat, text, parse_mode: 'HTML' })
    }).catch(() => {});
  }

  function maybeAlert(market, setup, mlPred, dec) {
    if (!state.alertsOn || !setup || !mlPred?.isPure) return;
    if (setup.state !== 'IN_TRADE' && setup.state !== 'WAIT_TRIGGER') return;
    const key = `${setup.id}|${setup.state}`;
    if (state.alertedIds.has(key)) return;
    state.alertedIds.add(key);

    const f = p => p != null ? p.toFixed(dec) : '—';
    const title = `🟢 PURE SIGNAL: ${market.name} — ${setup.dir} (${setup.grade} · ML ${mlPred.probTP1}%)`;
    const body = `Entry ${f(setup.entry)} · SL ${f(setup.sl)} · TP1 (50%) ${f(setup.tp1)} · TP2 ${f(setup.tp2)}`;

    playAlertTone();
    toast(`<b>${title}</b><div class="small muted" style="margin-top:3px;">${body}</div>`);
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
    sendTelegramAlert(`<b>${title}</b>\n${body}\nTime: ${T.fmtCAT(Date.now())} CAT`);
  }

  /* ---------------- Active Entry Model Level Resolver ---------------- */
  function resolveActiveEntryLevels(setup, series) {
    if (!setup) return null;
    const ltf = series?.ltf || [];

    // If setup hasn't triggered entry yet but has TBS / Model #1, project anticipated entry & SL so the Blue/Red box still shows!
    if (setup.entry == null && setup.tbsIdx != null && ltf[setup.tbsIdx]) {
      const refIdx = setup.model1Idx != null && setup.model1Idx >= 0 ? setup.model1Idx : setup.tbsIdx;
      const refC = ltf[refIdx] || ltf[setup.tbsIdx];
      const entry = setup.isBear ? refC.low : refC.high;
      const a = E.atr(ltf, refIdx, 14) || Math.abs(setup.crth - setup.crtl) * 0.08;
      const ext = setup.extreme != null ? setup.extreme : (setup.isBear ? refC.high : refC.low);
      const sl = setup.isBear ? ext + a * 0.2 : ext - a * 0.2;
      const tp1 = setup.mid;
      const tp2 = setup.isBear ? setup.crtl : setup.crth;
      const risk = Math.max(Math.abs(entry - sl), 1e-8);
      return {
        label: 'Projected Model #1 Trigger',
        projected: true,
        entry, sl, tp1, tp2, risk,
        rr1: Math.abs(entry - tp1) / risk,
        rr2: Math.abs(entry - tp2) / risk,
        entryIdx: refIdx
      };
    }

    if (setup.entry == null) return null;

    if (state.entryModelView === 'ote' && setup.ote) {
      const entry = (setup.ote.from + setup.ote.to) / 2;
      const sl = setup.sl;
      const tp1 = setup.tp1;
      const tp2 = setup.tp2;
      const risk = Math.max(Math.abs(entry - sl), 1e-8);
      return {
        label: 'Model #2 · CRT OTE (64% Fib)',
        entry, sl, tp1, tp2, risk,
        rr1: Math.abs(entry - tp1) / risk,
        rr2: Math.abs(entry - tp2) / risk,
        entryIdx: setup.ote.startIdx
      };
    }
    if (state.entryModelView === 'kod' && setup.kod) {
      const entry = setup.kod.price;
      const sl = setup.tp1;
      const tp1 = (entry + setup.tp2) / 2;
      const tp2 = setup.tp2;
      const risk = Math.max(Math.abs(entry - sl), 1e-8);
      return {
        label: 'Model #3 · Kiss of Death (KOD)',
        entry, sl, tp1, tp2, risk,
        rr1: Math.abs(entry - tp1) / risk,
        rr2: Math.abs(entry - tp2) / risk,
        entryIdx: setup.kod.idx
      };
    }
    return {
      label: 'Model #1 · TBS + Thick Candle Close',
      entry: setup.entry,
      sl: setup.sl,
      tp1: setup.tp1,
      tp2: setup.tp2,
      risk: setup.risk,
      rr1: setup.rr1,
      rr2: setup.rr2,
      entryIdx: setup.entryIdx
    };
  }

  /* ---------------- Top Clock (CAT) & DST Banner ---------------- */
  function startClock() {
    const timeEl = document.getElementById('clockTime');
    const phaseEl = document.getElementById('clockPhase');
    const leftEl = document.getElementById('clockLeft');
    const dstNote = document.getElementById('dstNote');

    const tick = () => {
      const now = Date.now();
      const amd = T.amdNow(now);
      if (timeEl) timeEl.textContent = T.fmtCAT(now, 'seconds');
      if (phaseEl) phaseEl.textContent = amd.label;
      if (leftEl) {
        const mins = Math.max(0, Math.round(amd.remainingMs / 60000));
        const h = Math.floor(mins / 60), m = mins % 60;
        leftEl.textContent = `${h}h ${m}m`;
      }
    };
    tick();
    setInterval(tick, 1000);

    const nextChange = T.nextUsClockChange();
    if (dstNote && nextChange) {
      const days = Math.max(0, Math.ceil((nextChange - Date.now()) / T.DAY));
      const dstNow = T.isNYDst(Date.now());
      dstNote.textContent = `NY is on ${dstNow ? 'EDT (UTC-4)' : 'EST (UTC-5)'} · US clock shift in ${days}d (${T.fmtCAT(nextChange)} CAT) — auto-adjusted`;
    }
  }

  /* ---------------- Watchlist Sidebar ---------------- */
  function renderWatchlist() {
    const body = document.getElementById('wlBody');
    const q = (document.getElementById('wlSearch')?.value || '').trim().toLowerCase();
    if (!body) return;

    const groups = new Map();
    let totalShown = 0;
    for (const m of F.markets.values()) {
      if (state.wlCategory !== 'all' && m.cat !== state.wlCategory) continue;
      if (q && !m.name.toLowerCase().includes(q) && !m.id.toLowerCase().includes(q) && !m.group.toLowerCase().includes(q)) continue;
      const ws = state.watchStates.get(m.id);
      const s = ws?.setup;
      const ml = ws?.ml;
      if (state.wlActiveOnly && (!s || (!ml?.isPure && !E.ACTIVE.has(s.state)))) continue;
      if (!groups.has(m.group)) groups.set(m.group, []);
      groups.get(m.group).push(m);
      totalShown++;
    }

    let html = '';
    for (const [grp, list] of groups) {
      html += `<div class="wl-group">${grp} (${list.length})</div>`;
      for (const m of list) {
        const ws = state.watchStates.get(m.id);
        const s = ws?.setup;
        const ml = ws?.ml;
        const info = s ? (E.STATE_INFO[s.state] || { label: s.state, tone: 'muted' }) : { label: 'Ready', tone: 'muted' };
        const priceTxt = ws?.price != null ? ws.price.toFixed(ws.decimals || 2) : '…';
        const dirTxt = s?.dir
          ? `${s.dir} · ${s.grade || ''} ${ml ? `· ML ${ml.probTP1}%` : ''}`
          : m.profile;
        html += `
          <div class="wl-item ${m.id === state.marketId ? 'active' : ''}" data-mid="${m.id}">
            <div>
              <div class="wl-sym">${m.name} ${ml?.isPure ? '<span style="color:#10b981;" title="Pure Signal">★</span>' : ''}</div>
              <div class="wl-sub">${dirTxt}</div>
            </div>
            <div class="wl-right">
              <span class="mono small">${priceTxt}</span>
              <span class="st-pill st-${info.tone}">${info.label}</span>
            </div>
          </div>
        `;
      }
    }
    if (!totalShown) {
      html = `<div style="padding:16px 12px; color:var(--text-mute); font-size:11.5px;">No markets match this filter yet. Uncheck "Only Pure / Active Setups" or wait for the scanner.</div>`;
    }
    body.innerHTML = html;
    body.querySelectorAll('.wl-item').forEach(el => {
      el.addEventListener('click', () => selectMarket(el.dataset.mid));
    });

    const foot = document.getElementById('wlFoot');
    if (foot) {
      foot.innerHTML = `Showing <b>${totalShown}</b> / <b>${F.markets.size}</b> Deriv, Weltrade SyntX, Forex &amp; Crypto pairs.`;
    }
    renderPureSignalsPage();
  }

  /* ---------------- Build Chart Markings (HTF & LTF) ---------------- */
  function buildHTFAnnotations(series, setup) {
    const { htf, market, pair } = series;
    const htfMs = F.HTF_SECONDS[pair.htf] * 1000;
    const boxes = [], lines = [], bands = [], markers = [], priceLines = [];

    if (state.showSessions && market.profile !== 'synthetic' && (pair.htf === '1h' || pair.htf === '4h') && htf.length > 2) {
      const rawBands = T.sessionBands(htf[Math.max(0, htf.length - 80)].time, htf[htf.length - 1].time + htfMs * 2);
      const colors = {
        acc: 'rgba(148, 163, 184, 0.04)',
        man: 'rgba(245, 158, 11, 0.07)',
        dis: 'rgba(16, 185, 129, 0.06)'
      };
      for (const b of rawBands) {
        bands.push({ from: b.from, to: b.to, fill: colors[b.key], label: b.label });
      }
    }

    if (!setup) return { boxes, lines, bands, markers, priceLines };

    const c1 = setup.c1;
    const endIdx = Math.min(htf.length - 1, (setup.manipIdx || setup.c1Idx) + 4);
    const boxTo = htf[endIdx].time + htfMs * 3;

    if (state.showKl && setup.keyLevels && setup.keyLevels.length) {
      for (const kl of setup.keyLevels) {
        if (kl.top !== kl.bottom) {
          boxes.push({
            from: kl.time,
            to: boxTo,
            top: kl.top,
            bottom: kl.bottom,
            fill: setup.isBear ? 'rgba(244, 63, 94, 0.14)' : 'rgba(16, 185, 129, 0.14)',
            stroke: setup.isBear ? 'rgba(244, 63, 94, 0.6)' : 'rgba(16, 185, 129, 0.6)',
            label: `Keylevel: ${kl.type}`,
            dash: true
          });
        } else {
          lines.push({
            from: kl.time,
            to: boxTo,
            price: kl.price,
            color: setup.isBear ? '#f43f5e' : '#10b981',
            dash: true,
            width: 1.5,
            label: `${kl.type} (${kl.name})`
          });
        }
      }
    }

    boxes.push({
      from: c1.time,
      to: boxTo,
      top: setup.crth,
      bottom: setup.crtl,
      fill: 'rgba(59, 130, 246, 0.09)',
      stroke: '#3b82f6',
      label: `CRT Range (${setup.crtType ? setup.crtType.name : 'C1'})`
    });
    lines.push({ from: c1.time, to: boxTo, price: setup.crth, color: '#3b82f6', width: 1.6, label: 'CRTH' });
    lines.push({ from: c1.time, to: boxTo, price: setup.mid, color: '#f59e0b', dash: true, width: 1.5, label: '50% Equilibrium (TP1)' });
    lines.push({ from: c1.time, to: boxTo, price: setup.crtl, color: '#3b82f6', width: 1.6, label: 'CRTL' });

    priceLines.push(
      { price: setup.crth, color: '#3b82f6', title: 'CRTH' },
      { price: setup.mid, color: '#f59e0b', title: '50% TP1' },
      { price: setup.crtl, color: '#3b82f6', title: 'CRTL' }
    );

    markers.push({
      time: c1.time,
      position: 'belowBar',
      color: '#3b82f6',
      shape: 'square',
      text: 'C1 CRT'
    });
    if (setup.manipIdx != null && htf[setup.manipIdx]) {
      markers.push({
        time: htf[setup.manipIdx].time,
        position: setup.isBear ? 'aboveBar' : 'belowBar',
        color: '#f59e0b',
        shape: setup.isBear ? 'arrowDown' : 'arrowUp',
        text: 'C2 Sweep'
      });
      if (htf[setup.manipIdx + 1]) {
        markers.push({
          time: htf[setup.manipIdx + 1].time,
          position: setup.isBear ? 'aboveBar' : 'belowBar',
          color: '#10b981',
          shape: 'circle',
          text: 'C3 Dist'
        });
      }
    }

    return { boxes, lines, bands, markers, priceLines };
  }

  function buildLTFAnnotations(series, setup) {
    const { ltf, market, pair } = series;
    const ltfMs = pair.ltf * 1000;
    const boxes = [], lines = [], bands = [], markers = [], priceLines = [];
    let positionBox = null;

    if (state.showSessions && market.profile !== 'synthetic' && pair.ltf <= 3600 && ltf.length > 2) {
      const rawBands = T.sessionBands(ltf[Math.max(0, ltf.length - 300)].time, ltf[ltf.length - 1].time + ltfMs * 10);
      const colors = {
        acc: 'rgba(148, 163, 184, 0.035)',
        man: 'rgba(245, 158, 11, 0.065)',
        dis: 'rgba(16, 185, 129, 0.055)'
      };
      for (const b of rawBands) bands.push({ from: b.from, to: b.to, fill: colors[b.key], label: b.label });
    }

    if (!setup) return { boxes, lines, bands, markers, priceLines, positionBox };

    const startT = setup.c1.time;
    const endT = ltf[ltf.length - 1].time + ltfMs * 8;

    lines.push({ from: startT, to: endT, price: setup.crth, color: '#3b82f6', width: 1.4, label: 'HTF CRTH' });
    lines.push({ from: startT, to: endT, price: setup.mid, color: '#f59e0b', dash: true, width: 1.3, label: '50% CRT (TP1 + BE)' });
    lines.push({ from: startT, to: endT, price: setup.crtl, color: '#3b82f6', width: 1.4, label: 'HTF CRTL' });

    if (setup.insideLTF >= 2 && setup.motherIdx >= 0 && ltf[setup.motherIdx]) {
      const m = ltf[setup.motherIdx];
      const preTbs = ltf[setup.tbsIdx - 1];
      boxes.push({
        from: m.time,
        to: preTbs.time + ltfMs * 0.5,
        top: m.high,
        bottom: m.low,
        fill: 'rgba(16, 185, 129, 0.12)',
        stroke: '#10b981',
        dash: true,
        label: `A+ TBS (${setup.insideLTF} Inside Candles)`
      });
    }

    if (setup.tbsIdx != null && ltf[setup.tbsIdx]) {
      markers.push({
        time: ltf[setup.tbsIdx].time,
        position: setup.isBear ? 'aboveBar' : 'belowBar',
        color: '#f59e0b',
        shape: 'square',
        text: setup.insideLTF >= 2 ? `TBS (A+ ${setup.insideLTF}i)` : 'TBS Body Close'
      });
    }

    if (setup.model1Idx != null && setup.model1Idx >= 0 && ltf[setup.model1Idx]) {
      const refC = ltf[setup.model1Idx];
      const trigPrice = setup.isBear ? refC.low : refC.high;
      const trigEndIdx = setup.entryIdx != null ? setup.entryIdx + 2 : Math.min(ltf.length - 1, setup.model1Idx + 12);
      lines.push({
        from: refC.time,
        to: ltf[Math.min(ltf.length - 1, trigEndIdx)].time,
        price: trigPrice,
        color: '#f43f5e',
        width: 1.6,
        label: 'Model #1 Trigger'
      });
      markers.push({
        time: refC.time,
        position: setup.isBear ? 'aboveBar' : 'belowBar',
        color: '#f43f5e',
        shape: 'circle',
        text: 'Model #1'
      });
    }

    // Prominent BLUE & RED Entry / Stop-Loss Position Tool
    const activeLvls = resolveActiveEntryLevels(setup, series);
    if (activeLvls && ltf[activeLvls.entryIdx]) {
      const entryT = ltf[activeLvls.entryIdx].time;
      const boxEndIdx = setup.exitIdx != null && setup.exitIdx >= 0
        ? setup.exitIdx
        : ltf.length - 1;
      const boxEndT = ltf[Math.max(activeLvls.entryIdx, boxEndIdx)].time + ltfMs * 10;

      if (state.showPositionBox) {
        positionBox = {
          from: entryT,
          to: boxEndT,
          entry: activeLvls.entry,
          sl: activeLvls.sl,
          tp1: activeLvls.tp1,
          tp2: activeLvls.tp2,
          rr1: activeLvls.rr1,
          rr2: activeLvls.rr2,
          dir: setup.dir || (setup.isBear ? 'SELL' : 'BUY'),
          isBear: setup.isBear
        };
      }

      markers.push({
        time: entryT,
        position: setup.isBear ? 'aboveBar' : 'belowBar',
        color: '#3b82f6',
        shape: setup.isBear ? 'arrowDown' : 'arrowUp',
        text: `${setup.dir || 'TRADE'} ENTRY`
      });

      priceLines.push(
        { price: activeLvls.entry, color: '#3b82f6', title: `${setup.dir} ENTRY`, style: 0, width: 2 },
        { price: activeLvls.sl, color: '#f43f5e', title: 'STOP LOSS', style: 0, width: 2 },
        { price: activeLvls.tp1, color: '#f59e0b', title: 'TP1 (50% + BE)', style: 2, width: 1 },
        { price: activeLvls.tp2, color: '#10b981', title: 'TP2 (100%)', style: 0, width: 2 }
      );
    }

    if (state.showOte && setup.ote && ltf[setup.ote.startIdx]) {
      const oteStart = ltf[setup.ote.startIdx].time;
      const oteEnd = ltf[Math.min(ltf.length - 1, setup.ote.startIdx + 20)].time + ltfMs * 4;
      boxes.push({
        from: oteStart,
        to: oteEnd,
        top: Math.max(setup.ote.from, setup.ote.to),
        bottom: Math.min(setup.ote.from, setup.ote.to),
        fill: 'rgba(168, 85, 247, 0.15)',
        stroke: '#a855f7',
        dash: true,
        label: 'CRT OTE (50–79% Fib)'
      });
    }

    if (setup.kod && ltf[setup.kod.idx]) {
      markers.push({
        time: ltf[setup.kod.idx].time,
        position: setup.isBear ? 'aboveBar' : 'belowBar',
        color: '#06b6d4',
        shape: setup.isBear ? 'arrowDown' : 'arrowUp',
        text: 'KOD Turtle Soup'
      });
    }

    return { boxes, lines, bands, markers, priceLines, positionBox };
  }

  /* ---------------- Build Visual Blue/Red Block HTML ---------------- */
  function renderBlueRedHtml(setup, activeLvls, dec) {
    if (!activeLvls) return '';
    const f = v => v != null && isFinite(v) ? v.toFixed(dec) : '—';
    return `
      <div class="pv-sl">
        <span>🟥 STOP LOSS (-1R Risk)</span>
        <b>${f(activeLvls.sl)}</b>
      </div>
      <div class="pv-entry">
        <span>⚪ ${setup.dir || 'TRADE'} ENTRY (${activeLvls.label})</span>
        <b>${f(activeLvls.entry)}</b>
      </div>
      <div class="pv-tp1">
        <span>🟦 TP1 · 50% CRT (Shave 50% + Move SL→BE)</span>
        <b>${f(activeLvls.tp1)} (1:${activeLvls.rr1.toFixed(2)})</b>
      </div>
      <div class="pv-tp2">
        <span>🟦 TP2 · 100% Opposing CRT Target</span>
        <b>${f(activeLvls.tp2)} (1:${activeLvls.rr2.toFixed(2)})</b>
      </div>
    `;
  }

  /* ---------------- Render Ticket, ML Intelligence, Audit & Setups Table ---------------- */
  function renderTicketAndTable() {
    if (!state.series || !state.evalRes) return;
    const { market, pair, ltf } = state.series;
    const dec = F.decimalsFor(ltf);
    const f = v => v != null && isFinite(v) ? v.toFixed(dec) : '—';
    const setup = state.selectedSetup || state.evalRes.primary;
    const mlPred = ML.predict(state.series, setup);

    const lastPrice = ltf.length ? ltf[ltf.length - 1].close : null;
    document.getElementById('mhName').textContent = market.name;
    const profEl = document.getElementById('mhProfile');
    profEl.textContent = market.profile === 'synthetic' ? 'Synthetic Mode (24/7)' : `${market.profile.toUpperCase()} (AMD + SMT)`;
    profEl.className = `badge ${market.profile}`;
    document.getElementById('mhPrice').textContent = lastPrice != null ? lastPrice.toFixed(dec) : '—';
    document.getElementById('mhFeed').textContent = `${market.group} · ${pair.label}`;

    document.getElementById('htfPill').textContent = pair.htfLabel;
    document.getElementById('ltfPill').textContent = pair.ltfLabel;

    // Render ML Pair Learner Box
    const mlBox = document.getElementById('tkMlBox');
    if (mlBox) {
      const driversHtml = (mlPred.topDrivers || []).map(d =>
        `<span class="st-pill ${d.weight >= 0 ? 'st-good' : 'st-bad'}">${d.name} ${d.weight >= 0 ? '+' : ''}${d.weight.toFixed(2)}</span>`
      ).join(' ');
      mlBox.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span><b>ML TP1 Confidence:</b> <span class="mono" style="color:${mlPred.probTP1 >= 66 ? '#34d399' : '#fbbf24'}; font-weight:800;">${mlPred.probTP1}%</span> (TP2: ${mlPred.probTP2}%)</span>
          <span class="st-pill ${mlPred.isPure ? 'st-live' : 'st-muted'}">${mlPred.isPure ? '★ PURE SIGNAL' : 'FILTERED OUT'}</span>
        </div>
        <div class="ml-meter"><i style="width:${mlPred.probTP1}%;"></i></div>
        <div class="small muted" style="display:grid; grid-template-columns:1fr 1fr; gap:4px; margin-top:2px;">
          <div>Learned Setups: <b class="mono">${mlPred.samples}</b> ${mlPred.empiricalWinRate != null ? `(${mlPred.empiricalWinRate}% win)` : ''}</div>
          <div>Avg Sweep Depth: <b class="mono">${mlPred.avgSweepATR} ATR</b></div>
          <div>Avg Speed to TP1: <b class="mono">~${mlPred.avgBarsToTP1} bars</b></div>
          <div>Best Keylevel: <b class="mono">${mlPred.bestKeyLevel}</b></div>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:3px;">${driversHtml}</div>
      `;
    }

    if (!setup) {
      document.getElementById('tkGrade').textContent = '—';
      document.getElementById('tkState').textContent = 'No thick-bodied HTF CRT candle in recent window';
      document.getElementById('tkPosVis').innerHTML = '';
      document.getElementById('tkLevels').innerHTML = '';
      document.getElementById('tkSizing').innerHTML = '';
      document.getElementById('tkChecks').innerHTML = '';
      return;
    }

    document.getElementById('htfSub').textContent = `C1 ${T.fmtCAT(setup.c1.time)} CAT · CRTH ${f(setup.crth)} · 50% ${f(setup.mid)} · CRTL ${f(setup.crtl)}`;
    document.getElementById('ltfSub').textContent = setup.tbsIdx != null && ltf[setup.tbsIdx]
      ? `TBS @ ${T.fmtCAT(ltf[setup.tbsIdx].time)} CAT · ${setup.insideLTF} inside candles · ML ${mlPred.probTP1}%`
      : `Waiting for LTF body close beyond ${f(setup.crth)} or ${f(setup.crtl)}`;

    const gradeEl = document.getElementById('tkGrade');
    gradeEl.textContent = `Grade ${setup.grade || '—'} · ML ${mlPred.probTP1}%`;
    gradeEl.className = `grade g-${(setup.grade || 'C').replace('+', 'plus')}`;

    const stInfo = E.STATE_INFO[setup.state] || { label: setup.state, tone: 'muted', step: 1 };
    const stBanner = document.getElementById('tkState');
    stBanner.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span class="st-pill st-${stInfo.tone}">${stInfo.label}</span>
        <span class="mono">${setup.dir ? setup.dir + ' BIAS' : 'NEUTRAL'}</span>
      </div>
      ${setup.invalidReason ? `<div class="small muted" style="margin-top:4px;">${setup.invalidReason}</div>` : ''}
    `;

    const steps = document.querySelectorAll('#tkStepper li');
    steps.forEach((li, idx) => {
      li.className = idx + 1 < stInfo.step ? 'done' : idx + 1 === stInfo.step ? 'current' : '';
    });

    const activeLvls = resolveActiveEntryLevels(setup, state.series);
    const posVisEl = document.getElementById('tkPosVis');
    const lvlsEl = document.getElementById('tkLevels');

    if (activeLvls) {
      posVisEl.innerHTML = renderBlueRedHtml(setup, activeLvls, dec);
      lvlsEl.innerHTML = `
        ${setup.ote ? `<div class="lvl"><span>Backup: Model #2 CRT OTE (50–79%)</span><span>${f(setup.ote.from)} – ${f(setup.ote.to)}</span></div>` : ''}
        ${setup.kod ? `<div class="lvl"><span>Add-on: Model #3 KOD Sweep</span><span>${f(setup.kod.price)}</span></div>` : ''}
      `;

      const riskUsd = state.balance * (state.riskPct / 100);
      const units = activeLvls.risk > 0 ? riskUsd / activeLvls.risk : 0;
      const tp1Usd = 0.5 * riskUsd * activeLvls.rr1;
      const tp2Usd = tp1Usd + 0.5 * riskUsd * activeLvls.rr2;
      document.getElementById('tkSizing').innerHTML = `
        <div><b>Position Size:</b> <span class="mono">${units.toFixed(2)} units</span> (1R = $${riskUsd.toFixed(2)} @ ${state.riskPct}%)</div>
        <div><b>At TP1 (50% rule + BE):</b> <span class="mono" style="color:#fbbf24;">+$${tp1Usd.toFixed(2)}</span> locked in</div>
        <div><b>At TP2 (full CRT delivery):</b> <span class="mono" style="color:#34d399;">+$${tp2Usd.toFixed(2)} (+${(0.5 * activeLvls.rr1 + 0.5 * activeLvls.rr2).toFixed(2)}R)</span></div>
      `;
    } else {
      posVisEl.innerHTML = '';
      lvlsEl.innerHTML = `
        <div class="lvl"><span>HTF CRTH (Bearish Sweep Target)</span><span>${f(setup.crth)}</span></div>
        <div class="lvl tp1"><span>HTF 50% Equilibrium (TP1)</span><span>${f(setup.mid)}</span></div>
        <div class="lvl"><span>HTF CRTL (Bullish Sweep Target)</span><span>${f(setup.crtl)}</span></div>
      `;
      document.getElementById('tkSizing').innerHTML = `<div>Blue & Red Entry/Stop-Loss box appears automatically as soon as TBS sweeps the CRT extreme.</div>`;
    }

    document.getElementById('tkScore').textContent = `${setup.passes || 0}/${setup.total || 0} passed`;
    const iconMap = { pass: '✔', warn: '▲', fail: '✖', na: '—' };
    document.getElementById('tkChecks').innerHTML = (setup.checks || []).map(c => `
      <div class="chk">
        <span class="chk-ic ${c.status}">${iconMap[c.status] || '•'}</span>
        <div style="flex:1;">
          <div style="display:flex; justify-content:space-between; font-weight:600;">
            <span>${c.title}</span>
            <span class="small muted mono">${c.src}</span>
          </div>
          <div class="small muted">${c.text}</div>
        </div>
      </div>
    `).join('');

    const setups = state.evalRes.setups || [];
    document.getElementById('setupsSummary').textContent = `${setups.length} recent CRT candle(s) evaluated — click any row to inspect Blue & Red Entry/SL on chart`;
    const tbody = document.querySelector('#setupsTable tbody');
    tbody.innerHTML = setups.map((s, idx) => {
      const inf = E.STATE_INFO[s.state] || { label: s.state, tone: 'muted' };
      const sp = ML.predict(state.series, s);
      const rTxt = s.r50 != null ? `${s.r50 >= 0 ? '+' : ''}${s.r50.toFixed(2)}R` : '—';
      return `
        <tr data-sidx="${idx}" class="${s.id === setup.id ? 'active-row' : ''}">
          <td>${T.fmtCAT(s.c1.time)}</td>
          <td>${s.dir || '—'}</td>
          <td><span class="st-pill st-${inf.tone}">${inf.label}</span></td>
          <td><span class="st-pill ${sp.isPure ? 'st-live' : 'st-muted'}">${sp.isPure ? '★ PURE' : 'Filtered'}</span></td>
          <td><b>${sp.probTP1}%</b></td>
          <td>${s.keyLevels && s.keyLevels[0] ? s.keyLevels[0].type : 'None'}</td>
          <td>${s.insideLTF >= 2 ? `Yes (${s.insideLTF})` : 'No'}</td>
          <td>${f(s.entry)}</td>
          <td style="color:#fb7185;">${f(s.sl)}</td>
          <td>${f(s.tp1)} / ${f(s.tp2)}</td>
          <td><b>${s.grade || '—'}</b></td>
          <td style="color:${s.r50 > 0 ? '#34d399' : s.r50 < 0 ? '#fb7185' : 'inherit'};">${rTxt}</td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('tr').forEach(tr => {
      tr.addEventListener('click', () => {
        const picked = setups[+tr.dataset.sidx];
        if (picked) {
          state.selectedSetup = picked;
          applyChartAnnotations(true);
          renderTicketAndTable();
        }
      });
    });
  }

  /* ---------------- Render Dedicated "Pure Signals (A+ & ML Filtered)" Tab ---------------- */
  function renderPureSignalsPage() {
    const grid = document.getElementById('pureSignalsGrid');
    const countBadge = document.getElementById('pureSigCount');
    if (!grid) return;

    const pureList = [];
    for (const [mid, ws] of state.watchStates.entries()) {
      if (ws?.setup && ws?.ml?.isPure) {
        pureList.push({ mid, ...ws });
      }
    }
    pureList.sort((a, b) => (b.ml.probTP1 - a.ml.probTP1));

    if (countBadge) countBadge.textContent = String(pureList.length);

    if (!pureList.length) {
      grid.innerHTML = `
        <div class="card" style="grid-column: 1 / -1; text-align:center; padding:28px;">
          <h3 style="font-size:14px; margin-bottom:6px;">Scanning 75+ Deriv &amp; Weltrade SyntX Pairs for Pure Setups…</h3>
          <p class="muted small">Our 6-Gate Anti-Random Filter rejects mediocre setups. Click <b>"↻ Scan All Pairs &amp; Train ML"</b> above or wait a few seconds as pairs stream in.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = pureList.map(item => {
      const { market, setup, ml, decimals } = item;
      const f = v => v != null && isFinite(v) ? v.toFixed(decimals || 2) : '—';
      const stInfo = E.STATE_INFO[setup.state] || { label: setup.state, tone: 'good' };
      const kl = setup.keyLevels && setup.keyLevels[0] ? `${setup.keyLevels[0].type} (${setup.keyLevels[0].name})` : 'Verified';
      const lvls = {
        label: 'Model #1 Close',
        entry: setup.entry,
        sl: setup.sl,
        tp1: setup.tp1,
        tp2: setup.tp2,
        rr1: setup.rr1,
        rr2: setup.rr2
      };

      return `
        <div class="sig-card pure-aplus">
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div>
              <div style="font-weight:800; font-size:14px; color:#fff;">${market.name}</div>
              <div class="small muted">${market.group} · ${F.TF_PAIRS[state.pairKey].label}</div>
            </div>
            <div style="text-align:right;">
              <span class="st-pill st-${stInfo.tone}">${stInfo.label}</span>
              <div class="mono small" style="color:#34d399; font-weight:700; margin-top:3px;">Grade ${setup.grade} · ML ${ml.probTP1}%</div>
            </div>
          </div>

          <div class="pos-visualizer" style="margin-bottom:0;">
            ${renderBlueRedHtml(setup, lvls, decimals || 2)}
          </div>

          <div class="small muted" style="display:grid; grid-template-columns:1fr 1fr; gap:4px;">
            <div>Keylevel: <b style="color:var(--text);">${kl}</b></div>
            <div>A+ Inside: <b style="color:var(--text);">${setup.insideLTF || 0} bars</b></div>
            <div>ML Learned Setups: <b class="mono">${ml.samples}</b></div>
            <div>Avg Speed to TP1: <b class="mono">~${ml.avgBarsToTP1} bars</b></div>
          </div>

          <button class="btn primary block" data-opensig="${market.id}">
            ⌖ Open Live Chart &amp; Blue/Red Box
          </button>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('[data-opensig]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mid = btn.dataset.opensig;
        document.querySelector('[data-view="terminal"]').click();
        selectMarket(mid);
      });
    });
  }

  function applyChartAnnotations(focusOnSetup = false) {
    if (!state.series || !state.evalRes) return;
    const setup = state.selectedSetup || state.evalRes.primary;
    htfChart.setAnnotations(buildHTFAnnotations(state.series, setup));
    ltfChart.setAnnotations(buildLTFAnnotations(state.series, setup));

    if (focusOnSetup && setup) {
      htfChart.focusTime(setup.c1.time, 35, 18);
      const ltfFocusT = setup.entryIdx != null && state.series.ltf[setup.entryIdx]
        ? state.series.ltf[setup.entryIdx].time
        : setup.tbsIdx != null && state.series.ltf[setup.tbsIdx]
          ? state.series.ltf[setup.tbsIdx].time
          : setup.c1.time;
      ltfChart.focusTime(ltfFocusT, 55, 35);
    }
  }

  /* ---------------- Load Active Market + Train ML + Live Stream ---------------- */
  async function loadActiveMarket(fitCharts = true) {
    const market = F.markets.get(state.marketId);
    if (!market) return;
    const loading = document.getElementById('loading');
    const loadingText = document.getElementById('loadingText');
    if (loading) loading.hidden = false;
    if (loadingText) loadingText.textContent = `Loading live ${market.name} (${F.TF_PAIRS[state.pairKey].label})…`;

    if (state.unsubLtf) { state.unsubLtf(); state.unsubLtf = null; }

    try {
      const series = await F.loadSeries(market, state.pairKey);
      const allSetups = E.findAllSetups(series, state.engineOpts);
      ML.trainOnSetups(series, allSetups);

      const evalRes = E.evaluateLive(series, state.engineOpts);
      // Prefer a pure signal as primary if available in recent setups
      const pureRecent = evalRes.setups.find(s => ML.predict(series, s).isPure);
      if (pureRecent && (!evalRes.primary || !E.ACTIVE.has(evalRes.primary.state))) {
        evalRes.primary = pureRecent;
      }

      state.series = series;
      state.evalRes = evalRes;
      state.selectedSetup = evalRes.primary;

      const dec = F.decimalsFor(series.ltf);
      const mlPred = ML.predict(series, evalRes.primary);
      state.watchStates.set(market.id, {
        market,
        price: series.ltf.length ? series.ltf[series.ltf.length - 1].close : null,
        decimals: dec,
        setup: evalRes.primary,
        ml: mlPred
      });

      htfChart.setPrecision(dec);
      ltfChart.setPrecision(dec);
      htfChart.setTitle(`${market.name} · ${series.pair.htfLabel}`);
      ltfChart.setTitle(`${market.name} · ${series.pair.ltfLabel}`);
      htfChart.setData(series.htf, F.HTF_SECONDS[series.pair.htf] * 1000);
      ltfChart.setData(series.ltf, series.pair.ltf * 1000);

      applyChartAnnotations(fitCharts);
      renderTicketAndTable();
      renderWatchlist();
      maybeAlert(market, evalRes.primary, mlPred, dec);

      state.unsubLtf = F.subscribe(market, series.pair.ltf, c => {
        if (!state.series || state.series.market.id !== market.id) return;
        const ltf = state.series.ltf;
        const prevLast = ltf[ltf.length - 1];
        const barClosed = prevLast && c.time > prevLast.time;
        ltfChart.update(c);

        const bTime = state.series.bucketFn(c.time);
        const htf = state.series.htf;
        const hLast = htf[htf.length - 1];
        if (hLast && hLast.time === bTime) {
          htfChart.update({
            time: bTime,
            open: hLast.open,
            high: Math.max(hLast.high, c.high),
            low: Math.min(hLast.low, c.low),
            close: c.close
          });
        }

        document.getElementById('mhPrice').textContent = c.close.toFixed(dec);
        const ws = state.watchStates.get(market.id);
        if (ws) ws.price = c.close;

        if (barClosed) {
          const allS = E.findAllSetups(state.series, state.engineOpts);
          ML.trainOnSetups(state.series, allS);
          state.evalRes = E.evaluateLive(state.series, state.engineOpts);
          state.selectedSetup = state.evalRes.primary;
          const newMl = ML.predict(state.series, state.evalRes.primary);
          if (ws) { ws.setup = state.evalRes.primary; ws.ml = newMl; }
          applyChartAnnotations(false);
          renderTicketAndTable();
          renderWatchlist();
          maybeAlert(market, state.evalRes.primary, newMl, dec);
        }
      });
    } catch (err) {
      toast(`<b>Data notice (${market.name}):</b> ${err.message}`);
    } finally {
      if (loading) loading.hidden = true;
    }
  }

  function selectMarket(id) {
    if (!F.markets.has(id)) return;
    state.marketId = id;
    loadActiveMarket(true);
  }

  /* ---------------- Deep ML Training on Active Pair ---------------- */
  async function deepTrainActivePair() {
    if (!state.series) return;
    const market = state.series.market;
    const btn = document.getElementById('trainMlBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Training…'; }
    try {
      const deepSeries = await F.loadSeries(market, state.pairKey, { htfCount: 450, ltfCount: 2400 });
      const allSetups = E.findAllSetups(deepSeries, state.engineOpts);
      const m = ML.trainOnSetups(deepSeries, allSetups, 0.09);
      renderTicketAndTable();
      toast(`🧠 <b>ML Model Updated (${market.name}):</b> Learned from <b>${m.samples}</b> setups · Recommended SL Buffer: <b>${(m.avgSweepATR * 0.35).toFixed(2)} ATR</b>.`);
    } catch (e) {} finally {
      if (btn) { btn.disabled = false; btn.textContent = '+ Deep Train'; }
    }
  }

  /* ---------------- Polite Background Watchlist Scanner + ML Trainer ---------------- */
  let scanning = false;
  async function scanWatchlistOnce() {
    if (scanning) return;
    scanning = true;
    try {
      await Promise.all([
        F.mt5.refreshSymbols(),
        F.deriv.discoverSymbols()
      ]);
      renderWatchlist();
      populateBacktestMarkets();

      for (const m of F.markets.values()) {
        if (m.id === state.marketId) continue;
        try {
          const s = await F.loadSeries(m, state.pairKey, { htfCount: 110, ltfCount: 320 });
          const allS = E.findAllSetups(s, state.engineOpts);
          ML.trainOnSetups(s, allS);
          const ev = E.evaluateLive(s, state.engineOpts);
          const pureMatch = ev.setups.find(x => ML.predict(s, x).isPure);
          const chosen = pureMatch || ev.primary;
          const mlPred = ML.predict(s, chosen);
          const dec = F.decimalsFor(s.ltf);
          state.watchStates.set(m.id, {
            market: m,
            price: s.ltf.length ? s.ltf[s.ltf.length - 1].close : null,
            decimals: dec,
            setup: chosen,
            ml: mlPred
          });
          renderWatchlist();
          maybeAlert(m, chosen, mlPred, dec);
          // Polite pause so Deriv WebSocket is never flooded
          if (m.feed === 'deriv') await new Promise(r => setTimeout(r, 180));
        } catch (e) {}
      }
    } finally {
      scanning = false;
    }
  }

  /* ---------------- Backtester UI ---------------- */
  function populateBacktestMarkets() {
    const mSel = document.getElementById('btMarket');
    if (!mSel) return;
    const cur = mSel.value || state.marketId;
    mSel.innerHTML = Array.from(F.markets.values())
      .map(m => `<option value="${m.id}" ${m.id === cur ? 'selected' : ''}>${m.name} (${m.group})</option>`)
      .join('');
  }

  function initBacktestUI() {
    populateBacktestMarkets();
    const pSel = document.getElementById('btPair');
    if (pSel) {
      pSel.innerHTML = Object.values(F.TF_PAIRS)
        .map(p => `<option value="${p.key}" ${p.key === state.pairKey ? 'selected' : ''}>${p.label} (${p.style})</option>`)
        .join('');
    }
    document.getElementById('btRun')?.addEventListener('click', runBacktestNow);
  }

  async function runBacktestNow() {
    const mId = document.getElementById('btMarket').value;
    const pairKey = document.getElementById('btPair').value;
    const ltfBars = +document.getElementById('btBars').value;
    const filters = {
      ltfBars,
      requireKeyLevel: document.getElementById('btKl').checked,
      requireTime: document.getElementById('btTime').checked,
      requireSMT: document.getElementById('btSmt').checked,
      requireAPlus: document.getElementById('btAplus').checked
    };
    const prog = document.getElementById('btProgress');
    const btn = document.getElementById('btRun');
    btn.disabled = true;

    try {
      const market = F.markets.get(mId);
      const res = await BT.run(market, pairKey, state.engineOpts, filters, msg => {
        if (prog) prog.textContent = msg;
      });
      // Feed all replayed setups into the pair's Machine Learning model!
      ML.trainOnSetups(res.data, res.trades.map(t => t.setup), 0.08);
      renderTicketAndTable();

      if (prog) prog.textContent = `Done — replayed ${res.span.bars.toLocaleString()} real ${F.TF_PAIRS[pairKey].ltfLabel} candles & updated ML weights.`;

      const w = res.with50, wo = res.without50;
      const saved = res.trades.filter(t => t.outcome === 'BE').length;
      document.getElementById('btKpis').innerHTML = `
        <div class="kpi"><div class="kpi-lbl">Trades Executed</div><div class="kpi-val">${w.n}</div></div>
        <div class="kpi"><div class="kpi-lbl">Win Rate (50% Rule)</div><div class="kpi-val" style="color:#34d399;">${w.winRate.toFixed(1)}%</div></div>
        <div class="kpi"><div class="kpi-lbl">Win Rate (No 50% Rule)</div><div class="kpi-val" style="color:#fb7185;">${wo.winRate.toFixed(1)}%</div></div>
        <div class="kpi"><div class="kpi-lbl">Total R (With 50% Rule)</div><div class="kpi-val" style="color:${w.totalR >= 0 ? '#34d399' : '#fb7185'};">${w.totalR >= 0 ? '+' : ''}${w.totalR.toFixed(2)}R</div></div>
        <div class="kpi"><div class="kpi-lbl">Total R (No 50% Rule)</div><div class="kpi-val" style="color:${wo.totalR >= 0 ? '#34d399' : '#fb7185'};">${wo.totalR >= 0 ? '+' : ''}${wo.totalR.toFixed(2)}R</div></div>
        <div class="kpi"><div class="kpi-lbl">Profit Factor (50% Rule)</div><div class="kpi-val">${isFinite(w.pf) ? w.pf.toFixed(2) : '∞'}</div></div>
        <div class="kpi"><div class="kpi-lbl">Max Drawdown</div><div class="kpi-val">-${w.maxDD.toFixed(2)}R</div></div>
        <div class="kpi"><div class="kpi-lbl">Saved by 50% Rule (TP1→BE)</div><div class="kpi-val" style="color:#fbbf24;">${saved}</div></div>
      `;

      document.getElementById('btSpan').textContent = `${T.fmtCAT(res.span.from)} → ${T.fmtCAT(res.span.to)} CAT`;
      document.getElementById('btFunnel').textContent = `HTF C1s: ${res.funnel.c1} → TBS sweeps: ${res.funnel.tbs} → Model #1 triggered: ${res.funnel.triggered} (Skipped low RR: ${res.funnel.lowRR})`;

      if (!eqChart) eqChart = window.CRTEquityChart(document.getElementById('btEquity'));
      eqChart.set(res.trades, w, wo);

      const tbody = document.querySelector('#btTable tbody');
      tbody.innerHTML = res.trades.map((t, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${T.fmtCAT(t.time)}</td>
          <td>${t.dir}</td>
          <td><b>${t.grade}</b></td>
          <td>${t.type}</td>
          <td>${t.kl}</td>
          <td>${t.inside}</td>
          <td>${t.time_.toUpperCase()}</td>
          <td>${t.smt.toUpperCase()}</td>
          <td>1:${t.rr1.toFixed(2)} / 1:${t.rr2.toFixed(2)}</td>
          <td>${t.outcome}</td>
          <td style="color:${t.r50 >= 0 ? '#34d399' : '#fb7185'}; font-weight:700;">${t.r50 >= 0 ? '+' : ''}${t.r50.toFixed(2)}R</td>
          <td style="color:${t.rNo >= 0 ? '#94a3b8' : '#fb7185'};">${t.rNo >= 0 ? '+' : ''}${t.rNo.toFixed(2)}R</td>
        </tr>
      `).join('');
    } catch (err) {
      if (prog) prog.textContent = `Backtest failed: ${err.message}`;
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------------- Journal UI ---------------- */
  function renderJournal() {
    const list = state.journal;
    const total = list.length;
    const totalR = list.reduce((a, b) => a + (+b.r || 0), 0);
    const clean = list.filter(x => (x.mistake || '').startsWith('None')).length;

    const kpis = document.getElementById('jKpis');
    if (kpis) {
      kpis.innerHTML = `
        <div class="kpi"><div class="kpi-lbl">Logged Trades</div><div class="kpi-val">${total}</div></div>
        <div class="kpi"><div class="kpi-lbl">Net Result</div><div class="kpi-val" style="color:${totalR >= 0 ? '#34d399' : '#fb7185'};">${totalR >= 0 ? '+' : ''}${totalR.toFixed(2)}R</div></div>
        <div class="kpi"><div class="kpi-lbl">Plan Discipline</div><div class="kpi-val">${total ? Math.round((clean / total) * 100) : 100}% (${clean}/${total})</div></div>
      `;
    }

    const tbody = document.querySelector('#jTable tbody');
    if (!tbody) return;
    tbody.innerHTML = list.map((j, i) => `
      <tr>
        <td>${j.date}</td>
        <td><b>${j.market}</b></td>
        <td>${j.pair}</td>
        <td>${j.dir}</td>
        <td>${j.model}</td>
        <td>${j.took50}</td>
        <td style="color:${+j.r >= 0 ? '#34d399' : '#fb7185'}; font-weight:700;">${+j.r >= 0 ? '+' : ''}${(+j.r).toFixed(2)}R</td>
        <td>${j.mistake}</td>
        <td style="font-family:var(--font-sans); color:var(--text-dim); max-width:260px;">${j.notes || ''}</td>
        <td><button class="btn ghost small" data-jdel="${i}">✕</button></td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-jdel]').forEach(b => {
      b.addEventListener('click', () => {
        state.journal.splice(+b.dataset.jdel, 1);
        saveJournal();
        renderJournal();
      });
    });
  }

  /* ---------------- Playbook & CAT Time Table ---------------- */
  function renderPlaybook() {
    const tbl = T.amdTableCAT();
    document.getElementById('pbDst').textContent = `NY currently on ${tbl.isDst ? 'EDT (UTC-4) → CAT = NY + 6h' : 'EST (UTC-5) → CAT = NY + 7h'}`;
    document.querySelector('#pbTable tbody').innerHTML = tbl.rows.map(r => `
      <tr>
        <td>${r.cycle}</td>
        <td><b>${r.candle}</b></td>
        <td>${r.phase}</td>
        <td>${r.ny} NY</td>
        <td style="color:#34d399; font-weight:700;">${r.cat} CAT</td>
      </tr>
    `).join('');

    const nextChange = T.nextUsClockChange();
    if (nextChange) {
      const afterTbl = T.amdTableCAT(nextChange + 3600e3);
      document.getElementById('pbNext').textContent =
        `Note: On ${T.fmtCAT(nextChange)} CAT, US clocks shift so CAT becomes NY + ${afterTbl.offset}h (e.g. 4H C2 Manipulation moves to ${afterTbl.rows[1].cat} CAT). This terminal adjusts automatically.`;
    }
  }

  /* ---------------- Init & Event Wiring ---------------- */
  document.addEventListener('DOMContentLoaded', async () => {
    loadPrefs();
    startClock();

    const tfSeg = document.getElementById('tfSeg');
    tfSeg.innerHTML = Object.values(F.TF_PAIRS).map(p =>
      `<button data-pair="${p.key}" class="${p.key === state.pairKey ? 'active' : ''}" title="${p.style}">${p.label}</button>`
    ).join('');
    tfSeg.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        state.pairKey = b.dataset.pair;
        tfSeg.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
        loadActiveMarket(true);
      });
    });

    document.querySelectorAll('#wlCats button').forEach(b => {
      b.addEventListener('click', () => {
        state.wlCategory = b.dataset.cat;
        document.querySelectorAll('#wlCats button').forEach(x => x.classList.toggle('active', x === b));
        renderWatchlist();
      });
    });
    document.getElementById('wlActiveOnly')?.addEventListener('change', e => {
      state.wlActiveOnly = e.target.checked;
      renderWatchlist();
    });

    document.querySelectorAll('#entryModelSeg button').forEach(b => {
      b.addEventListener('click', () => {
        state.entryModelView = b.dataset.emodel;
        document.querySelectorAll('#entryModelSeg button').forEach(x => x.classList.toggle('active', x === b));
        applyChartAnnotations(false);
        renderTicketAndTable();
      });
    });

    F.onStatus(st => {
      document.querySelectorAll('#feedStatus .feed').forEach(el => {
        const s = st[el.dataset.feed] || 'idle';
        el.className = `feed ${s}`;
      });
    });

    htfChart = new window.CRTChart(document.getElementById('htfChart'));
    ltfChart = new window.CRTChart(document.getElementById('ltfChart'));

    document.querySelectorAll('#layoutSeg button').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('#layoutSeg button').forEach(x => x.classList.toggle('active', x === b));
        document.getElementById('charts').dataset.layout = b.dataset.layout;
        setTimeout(() => { htfChart.requestDraw(); ltfChart.requestDraw(); }, 50);
      });
    });

    document.getElementById('togPositionBox')?.addEventListener('change', e => { state.showPositionBox = e.target.checked; applyChartAnnotations(false); });
    document.getElementById('togSessions').addEventListener('change', e => { state.showSessions = e.target.checked; applyChartAnnotations(false); });
    document.getElementById('togOte').addEventListener('change', e => { state.showOte = e.target.checked; applyChartAnnotations(false); });
    document.getElementById('togKl').addEventListener('change', e => { state.showKl = e.target.checked; applyChartAnnotations(false); });
    document.getElementById('jumpBtn').addEventListener('click', () => applyChartAnnotations(true));
    document.getElementById('reloadBtn').addEventListener('click', () => loadActiveMarket(true));
    document.getElementById('trainMlBtn')?.addEventListener('click', deepTrainActivePair);
    document.getElementById('scanPureSignalsBtn')?.addEventListener('click', () => {
      toast('Scanning all pairs & updating ML models…');
      scanWatchlistOnce();
    });
    document.getElementById('wlSearch').addEventListener('input', renderWatchlist);

    document.querySelectorAll('.vt').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.vt').forEach(x => x.classList.toggle('active', x === b));
        document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${b.dataset.view}`));
        if (b.dataset.view === 'terminal') setTimeout(() => { htfChart.requestDraw(); ltfChart.requestDraw(); }, 40);
        if (b.dataset.view === 'signals') renderPureSignalsPage();
      });
    });

    const alertBtn = document.getElementById('alertBtn');
    alertBtn.classList.toggle('active', state.alertsOn);
    alertBtn.addEventListener('click', () => {
      state.alertsOn = !state.alertsOn;
      alertBtn.classList.toggle('active', state.alertsOn);
      if (state.alertsOn && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
      savePrefs();
      toast(state.alertsOn ? '🔔 Live audio, browser & Telegram alerts enabled.' : '🔕 Alerts muted.');
    });

    const modal = document.getElementById('settingsModal');
    document.getElementById('settingsBtn').addEventListener('click', () => {
      document.getElementById('sBalance').value = state.balance;
      document.getElementById('sRisk').value = state.riskPct;
      document.getElementById('sMinRR').value = state.engineOpts.minRR;
      document.getElementById('sMaxWait').value = state.engineOpts.maxWait;
      document.getElementById('sBuf').value = state.engineOpts.slBufferATR;
      document.getElementById('sSpike').value = state.engineOpts.spikeBufferATR;
      document.getElementById('sModel1').value = state.engineOpts.model1;
      document.getElementById('sBody').value = state.engineOpts.minBodyRatio;
      document.getElementById('sTgToken').value = state.tgToken || '';
      document.getElementById('sTgChat').value = state.tgChat || '';
      modal.hidden = false;
    });
    document.getElementById('settingsClose').addEventListener('click', () => { modal.hidden = true; });
    document.getElementById('settingsSave').addEventListener('click', () => {
      state.balance = +document.getElementById('sBalance').value || 10000;
      state.riskPct = +document.getElementById('sRisk').value || 1;
      state.engineOpts.minRR = +document.getElementById('sMinRR').value || 1.15;
      state.engineOpts.maxWait = +document.getElementById('sMaxWait').value || 6;
      state.engineOpts.slBufferATR = +document.getElementById('sBuf').value || 0.1;
      state.engineOpts.spikeBufferATR = +document.getElementById('sSpike').value || 1.0;
      state.engineOpts.model1 = document.getElementById('sModel1').value;
      state.engineOpts.minBodyRatio = +document.getElementById('sBody').value || 0.5;
      state.tgToken = document.getElementById('sTgToken').value.trim();
      state.tgChat = document.getElementById('sTgChat').value.trim();
      savePrefs();
      modal.hidden = true;
      loadActiveMarket(false);
    });

    document.getElementById('tkLog').addEventListener('click', () => {
      const s = state.selectedSetup || state.evalRes?.primary;
      if (!s || !state.series) return;
      document.getElementById('jMarket').value = state.series.market.name;
      document.getElementById('jPair').value = state.series.pair.label;
      document.getElementById('jDir').value = s.dir || 'SELL';
      document.getElementById('jR').value = s.r50 != null ? s.r50.toFixed(2) : '0';
      document.querySelector('[data-view="journal"]').click();
    });

    document.getElementById('tkCopy').addEventListener('click', () => {
      const s = state.selectedSetup || state.evalRes?.primary;
      if (!s || !state.series) return;
      const dec = F.decimalsFor(state.series.ltf);
      const f = v => v != null ? v.toFixed(dec) : '—';
      const activeLvls = resolveActiveEntryLevels(s, state.series) || s;
      const txt = `${state.series.market.name} (${state.series.pair.label}) ${s.dir || ''}\nEntry: ${f(activeLvls.entry)} | SL: ${f(activeLvls.sl)} | TP1 (50%): ${f(activeLvls.tp1)} | TP2 (100%): ${f(activeLvls.tp2)}`;
      navigator.clipboard?.writeText(txt);
      toast('Copied trade signal to clipboard.');
    });

    document.getElementById('jForm').addEventListener('submit', e => {
      e.preventDefault();
      state.journal.unshift({
        date: T.fmtCAT(Date.now()),
        market: document.getElementById('jMarket').value,
        pair: document.getElementById('jPair').value,
        dir: document.getElementById('jDir').value,
        model: document.getElementById('jModel').value,
        took50: document.getElementById('j50').value,
        r: +document.getElementById('jR').value || 0,
        mistake: document.getElementById('jMistake').value,
        notes: document.getElementById('jNotes').value
      });
      saveJournal();
      renderJournal();
      e.target.reset();
    });

    renderWatchlist();
    initBacktestUI();
    renderJournal();
    renderPlaybook();

    await loadActiveMarket(true);
    scanWatchlistOnce();
    setInterval(scanWatchlistOnce, 90000);
  });
})();
