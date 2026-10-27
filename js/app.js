/**
 * CRT Desk — Main Application Controller
 *  - Real-time Deriv WebSocket, Binance WebSocket & MT5 live market feeds
 *  - Live chart always anchored to the current market price at the right edge
 *  - TradingView-style Blue & Red Long/Short Position Tool on current setups
 *  - Per-pair online logistic regression quant filter
 */
(function () {
  const T = window.CRTTime;
  const F = window.CRTFeeds;
  const E = window.CRTEngine;
  const ML = window.CRTML;
  const BT = window.CRTBacktest;

  const state = {
    marketId: '1HZ75V',
    pairKey: '4H_5m',
    layout: 'split',
    wlCategory: 'all',
    wlActiveOnly: false,
    entryModelView: 'model1',
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
    watchStates: new Map(),
    unsubLtf: null,
    lastPrice: null,
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
            market: 'Volatility 75 (1s) Index',
            pair: '4H → 5m',
            dir: 'SELL',
            model: 'Model #1',
            took50: 'Yes',
            r: 2.15,
            mistake: 'None — followed rules',
            notes: '4H CRTH purge with 3 inside bars prior to 5m TBS close. Closed 50% at equilibrium and held runner to CRTL.'
          },
          {
            date: T.fmtCAT(Date.now() - 3600e3 * 11),
            market: 'PainX 400',
            pair: '1H → 1m',
            dir: 'SELL',
            model: 'Model #1',
            took50: 'Yes',
            r: 1.90,
            mistake: 'None — followed rules',
            notes: '1H CRTH sweep aligned with impulse direction. Banked 50% at midpoint and trailed stop to breakeven.'
          },
          {
            date: T.fmtCAT(Date.now() - 3600e3 * 5),
            market: 'XAU/USD (Gold)',
            pair: '4H → 5m',
            dir: 'BUY',
            model: 'CRT OTE',
            took50: 'Yes',
            r: 0.78,
            mistake: 'None — followed rules',
            notes: '11:00–15:00 CAT manipulation swept 4H CRTL while XAG held low. Reached 50% TP1 then stopped at BE.'
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
        gain.gain.setValueAtTime(0.10, ctx.currentTime + idx * 0.14);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.14 + 0.24);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.14);
        osc.stop(ctx.currentTime + idx * 0.14 + 0.25);
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
    setTimeout(() => el.remove(), 5500);
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
    const title = `SIGNAL: ${market.name} — ${setup.dir} (${setup.grade} · ${mlPred.probTP1}%)`;
    const body = `Entry ${f(setup.entry)} · SL ${f(setup.sl)} · TP1 ${f(setup.tp1)} · TP2 ${f(setup.tp2)}`;

    playAlertTone();
    toast(`<b>${title}</b><div class="small muted" style="margin-top:3px;">${body}</div>`);
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
    sendTelegramAlert(`<b>${title}</b>\n${body}\nTime: ${T.fmtCAT(Date.now())} CAT`);
  }

  /* ---------------- Live Quote Header Updater ---------------- */
  function updateQuoteHeader(market, pair, ltf, dec) {
    if (!ltf || !ltf.length) return;
    const last = ltf[ltf.length - 1];
    const price = last.close;
    const refIdx = Math.max(0, ltf.length - 60);
    const openRef = ltf[refIdx].open || last.open;
    const chg = price - openRef;
    const pct = openRef ? (chg / openRef) * 100 : 0;

    let hi = -Infinity, lo = Infinity;
    const recentSlice = ltf.slice(-60);
    for (const c of recentSlice) {
      if (c.high > hi) hi = c.high;
      if (c.low < lo) lo = c.low;
    }

    const nameEl = document.getElementById('mhName');
    const profEl = document.getElementById('mhProfile');
    const priceEl = document.getElementById('mhPrice');
    const chgEl = document.getElementById('mhChange');
    const hlEl = document.getElementById('mhHighLow');
    const feedEl = document.getElementById('mhFeed');

    if (nameEl) nameEl.textContent = market.name;
    if (profEl) {
      profEl.textContent = market.profile === 'synthetic' ? 'SYNTHETIC 24/7' : market.profile.toUpperCase();
      profEl.className = `badge ${market.profile}`;
    }
    if (priceEl) {
      priceEl.textContent = price.toFixed(dec);
      if (state.lastPrice != null && price !== state.lastPrice) {
        priceEl.classList.remove('tick-up', 'tick-down');
        priceEl.classList.add(price > state.lastPrice ? 'tick-up' : 'tick-down');
      }
      state.lastPrice = price;
    }
    if (chgEl) {
      const sign = chg >= 0 ? '+' : '';
      chgEl.textContent = `${sign}${chg.toFixed(dec)} (${sign}${pct.toFixed(2)}%)`;
      chgEl.style.color = chg >= 0 ? '#089981' : '#f23645';
    }
    if (hlEl && isFinite(hi) && isFinite(lo)) {
      hlEl.textContent = `H ${hi.toFixed(dec)}  L ${lo.toFixed(dec)}`;
    }
    if (feedEl) {
      const src = market.liveSource || (market.feed === 'deriv' ? 'DERIV WS LIVE' : market.feed === 'binance' ? 'BINANCE WS LIVE' : 'MT5 FEED');
      feedEl.textContent = `${src} · ${pair.label}`;
    }
  }

  /* ---------------- Active Entry Model Level Resolver ---------------- */
  function resolveActiveEntryLevels(setup, series) {
    if (!setup) return null;
    const ltf = series?.ltf || [];

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
        label: 'Model #1 Trigger (Pending Close)',
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
        label: 'Model #2 · OTE (64%)',
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
        label: 'Model #3 · KOD Sweep',
        entry, sl, tp1, tp2, risk,
        rr1: Math.abs(entry - tp1) / risk,
        rr2: Math.abs(entry - tp2) / risk,
        entryIdx: setup.kod.idx
      };
    }
    return {
      label: 'Model #1 · TBS Close',
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
      dstNote.textContent = `NY ${dstNow ? 'EDT (UTC-4)' : 'EST (UTC-5)'} · Shift in ${days}d`;
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
        const info = s ? (E.STATE_INFO[s.state] || { label: s.state, tone: 'muted' }) : { label: 'Live', tone: 'muted' };
        const rawPrice = ws?.price ?? m.spot;
        const priceTxt = rawPrice != null ? Number(rawPrice).toFixed(ws?.decimals || 2) : '—';
        const dirTxt = s?.dir
          ? `${s.dir} · ${s.grade || ''} ${ml ? `· ${ml.probTP1}%` : ''}`
          : m.id.replace('mt5:', '');
        html += `
          <div class="wl-item ${m.id === state.marketId ? 'active' : ''}" data-mid="${m.id}">
            <div>
              <div class="wl-sym">${m.name}</div>
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
      html = `<div style="padding:16px 12px; color:var(--text-mute); font-size:11px;">No symbols match current filter.</div>`;
    }
    body.innerHTML = html;
    body.querySelectorAll('.wl-item').forEach(el => {
      el.addEventListener('click', () => selectMarket(el.dataset.mid));
    });

    const foot = document.getElementById('wlFoot');
    if (foot) {
      foot.innerHTML = `${totalShown} / ${F.markets.size} instruments`;
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
        acc: 'rgba(134, 137, 147, 0.04)',
        man: 'rgba(245, 158, 11, 0.06)',
        dis: 'rgba(8, 153, 129, 0.05)'
      };
      for (const b of rawBands) {
        bands.push({ from: b.from, to: b.to, fill: colors[b.key], label: b.label });
      }
    }

    if (!setup) return { boxes, lines, bands, markers, priceLines };

    const c1 = setup.c1;
    const endIdx = Math.min(htf.length - 1, Math.max(setup.manipIdx || setup.c1Idx, htf.length - 1));
    const boxTo = htf[endIdx].time + htfMs * 2;

    if (state.showKl && setup.keyLevels && setup.keyLevels.length) {
      for (const kl of setup.keyLevels) {
        if (kl.top !== kl.bottom) {
          boxes.push({
            from: kl.time,
            to: boxTo,
            top: kl.top,
            bottom: kl.bottom,
            fill: setup.isBear ? 'rgba(242, 54, 69, 0.12)' : 'rgba(8, 153, 129, 0.12)',
            stroke: setup.isBear ? 'rgba(242, 54, 69, 0.55)' : 'rgba(8, 153, 129, 0.55)',
            label: `HTF ${kl.type}`,
            dash: true
          });
        } else {
          lines.push({
            from: kl.time,
            to: boxTo,
            price: kl.price,
            color: setup.isBear ? '#f23645' : '#089981',
            dash: true,
            width: 1.2,
            label: `${kl.type}`
          });
        }
      }
    }

    boxes.push({
      from: c1.time,
      to: boxTo,
      top: setup.crth,
      bottom: setup.crtl,
      fill: 'rgba(41, 98, 255, 0.08)',
      stroke: '#2962ff',
      label: `CRT Range`
    });
    lines.push({ from: c1.time, to: boxTo, price: setup.crth, color: '#2962ff', width: 1.4, label: 'CRTH' });
    lines.push({ from: c1.time, to: boxTo, price: setup.mid, color: '#f59e0b', dash: true, width: 1.2, label: '50% EQ' });
    lines.push({ from: c1.time, to: boxTo, price: setup.crtl, color: '#2962ff', width: 1.4, label: 'CRTL' });

    markers.push({
      time: c1.time,
      position: 'belowBar',
      color: '#2962ff',
      shape: 'square',
      text: 'C1'
    });
    if (setup.manipIdx != null && htf[setup.manipIdx]) {
      markers.push({
        time: htf[setup.manipIdx].time,
        position: setup.isBear ? 'aboveBar' : 'belowBar',
        color: '#f59e0b',
        shape: setup.isBear ? 'arrowDown' : 'arrowUp',
        text: 'C2 Purge'
      });
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
        acc: 'rgba(134, 137, 147, 0.03)',
        man: 'rgba(245, 158, 11, 0.055)',
        dis: 'rgba(8, 153, 129, 0.045)'
      };
      for (const b of rawBands) bands.push({ from: b.from, to: b.to, fill: colors[b.key], label: b.label });
    }

    if (!setup) return { boxes, lines, bands, markers, priceLines, positionBox };

    const startT = Math.max(setup.c1.time, ltf[Math.max(0, ltf.length - 120)]?.time || setup.c1.time);
    const endT = ltf[ltf.length - 1].time + ltfMs * 6;

    lines.push({ from: startT, to: endT, price: setup.crth, color: '#2962ff', width: 1.3, label: 'HTF CRTH' });
    lines.push({ from: startT, to: endT, price: setup.mid, color: '#f59e0b', dash: true, width: 1.2, label: '50% EQ (TP1)' });
    lines.push({ from: startT, to: endT, price: setup.crtl, color: '#2962ff', width: 1.3, label: 'HTF CRTL' });

    if (setup.insideLTF >= 2 && setup.motherIdx >= 0 && ltf[setup.motherIdx] && ltf[setup.tbsIdx - 1]) {
      const m = ltf[setup.motherIdx];
      const preTbs = ltf[setup.tbsIdx - 1];
      boxes.push({
        from: m.time,
        to: preTbs.time + ltfMs * 0.5,
        top: m.high,
        bottom: m.low,
        fill: 'rgba(8, 153, 129, 0.10)',
        stroke: '#089981',
        dash: true,
        label: `${setup.insideLTF} Inside Bars`
      });
    }

    if (setup.tbsIdx != null && ltf[setup.tbsIdx]) {
      markers.push({
        time: ltf[setup.tbsIdx].time,
        position: setup.isBear ? 'aboveBar' : 'belowBar',
        color: '#f59e0b',
        shape: 'square',
        text: 'TBS'
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
        color: '#f23645',
        width: 1.4,
        label: 'M1 Trigger'
      });
    }

    const activeLvls = resolveActiveEntryLevels(setup, series);
    if (activeLvls && ltf[activeLvls.entryIdx]) {
      const entryT = ltf[activeLvls.entryIdx].time;
      const boxEndIdx = setup.exitIdx != null && setup.exitIdx >= 0
        ? Math.min(ltf.length - 1, setup.exitIdx + 4)
        : ltf.length - 1;
      const boxEndT = ltf[Math.max(activeLvls.entryIdx, boxEndIdx)].time + ltfMs * 8;

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
        color: '#2962ff',
        shape: setup.isBear ? 'arrowDown' : 'arrowUp',
        text: `${setup.dir || 'ENTRY'}`
      });
    }

    if (state.showOte && setup.ote && ltf[setup.ote.startIdx]) {
      const oteStart = ltf[setup.ote.startIdx].time;
      const oteEnd = ltf[Math.min(ltf.length - 1, setup.ote.startIdx + 20)].time + ltfMs * 4;
      boxes.push({
        from: oteStart,
        to: oteEnd,
        top: Math.max(setup.ote.from, setup.ote.to),
        bottom: Math.min(setup.ote.from, setup.ote.to),
        fill: 'rgba(126, 87, 194, 0.14)',
        stroke: '#7e57c2',
        dash: true,
        label: 'OTE (50–79%)'
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
        <span>STOP LOSS (-1.0R)</span>
        <b>${f(activeLvls.sl)}</b>
      </div>
      <div class="pv-entry">
        <span>${setup.dir || 'ORDER'} ENTRY · ${activeLvls.label}</span>
        <b>${f(activeLvls.entry)}</b>
      </div>
      <div class="pv-tp1">
        <span>TP1 · 50% EQ (Partial + BE)</span>
        <b>${f(activeLvls.tp1)} (${activeLvls.rr1.toFixed(2)}R)</b>
      </div>
      <div class="pv-tp2">
        <span>TP2 · 100% Range Target</span>
        <b>${f(activeLvls.tp2)} (${activeLvls.rr2.toFixed(2)}R)</b>
      </div>
    `;
  }

  /* ---------------- Render Ticket, Quant Model, Checklist & Setups Table ---------------- */
  function renderTicketAndTable() {
    if (!state.series || !state.evalRes) return;
    const { market, pair, ltf } = state.series;
    const dec = F.decimalsFor(ltf);
    const f = v => v != null && isFinite(v) ? v.toFixed(dec) : '—';
    const setup = state.selectedSetup || state.evalRes.primary;
    const mlPred = ML.predict(state.series, setup);

    updateQuoteHeader(market, pair, ltf, dec);

    document.getElementById('htfPill').textContent = pair.htfLabel;
    document.getElementById('ltfPill').textContent = pair.ltfLabel;

    const mlBox = document.getElementById('tkMlBox');
    if (mlBox) {
      const driversHtml = (mlPred.topDrivers || []).map(d =>
        `<span class="st-pill ${d.weight >= 0 ? 'st-good' : 'st-bad'}">${d.name} ${d.weight >= 0 ? '+' : ''}${d.weight.toFixed(2)}</span>`
      ).join(' ');
      mlBox.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span><b>TP1 Probability:</b> <span class="mono" style="color:${mlPred.probTP1 >= 66 ? '#26a69a' : '#fbbf24'}; font-weight:700;">${mlPred.probTP1}%</span> (TP2: ${mlPred.probTP2}%)</span>
          <span class="st-pill ${mlPred.isPure ? 'st-live' : 'st-muted'}">${mlPred.isPure ? 'QUALIFIED' : 'STANDBY'}</span>
        </div>
        <div class="ml-meter"><i style="width:${mlPred.probTP1}%;"></i></div>
        <div class="small muted" style="display:grid; grid-template-columns:1fr 1fr; gap:4px; margin-top:2px;">
          <div>Sample Size: <b class="mono">${mlPred.samples}</b> ${mlPred.empiricalWinRate != null ? `(${mlPred.empiricalWinRate}% WR)` : ''}</div>
          <div>Avg Sweep: <b class="mono">${mlPred.avgSweepATR} ATR</b></div>
          <div>Bars to TP1: <b class="mono">~${mlPred.avgBarsToTP1}</b></div>
          <div>Top Level: <b class="mono">${mlPred.bestKeyLevel}</b></div>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:3px;">${driversHtml}</div>
      `;
    }

    if (!setup) {
      document.getElementById('tkGrade').textContent = '—';
      document.getElementById('tkState').textContent = 'Awaiting closed HTF CRT range candle';
      document.getElementById('tkPosVis').innerHTML = '';
      document.getElementById('tkLevels').innerHTML = '';
      document.getElementById('tkSizing').innerHTML = '';
      document.getElementById('tkChecks').innerHTML = '';
      return;
    }

    document.getElementById('htfSub').textContent = `C1 ${T.fmtCAT(setup.c1.time)} CAT · H ${f(setup.crth)} · 50% ${f(setup.mid)} · L ${f(setup.crtl)}`;
    document.getElementById('ltfSub').textContent = setup.tbsIdx != null && ltf[setup.tbsIdx]
      ? `TBS ${T.fmtCAT(ltf[setup.tbsIdx].time)} CAT · ${setup.insideLTF} inside · Prob ${mlPred.probTP1}%`
      : `Monitoring ${f(setup.crth)} / ${f(setup.crtl)} liquidity`;

    const gradeEl = document.getElementById('tkGrade');
    gradeEl.textContent = `${setup.grade || '—'} · ${mlPred.probTP1}%`;
    gradeEl.className = `grade g-${(setup.grade || 'C').replace('+', 'plus')}`;

    const stInfo = E.STATE_INFO[setup.state] || { label: setup.state, tone: 'muted', step: 1 };
    const stBanner = document.getElementById('tkState');
    stBanner.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span class="st-pill st-${stInfo.tone}">${stInfo.label}</span>
        <span class="mono">${setup.dir ? setup.dir + ' BIAS' : 'RANGE'}</span>
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
        ${setup.ote ? `<div class="lvl"><span>Alt: OTE Zone (50–79%)</span><span>${f(setup.ote.from)} – ${f(setup.ote.to)}</span></div>` : ''}
        ${setup.kod ? `<div class="lvl"><span>Add-on: KOD Level</span><span>${f(setup.kod.price)}</span></div>` : ''}
      `;

      const riskUsd = state.balance * (state.riskPct / 100);
      const units = activeLvls.risk > 0 ? riskUsd / activeLvls.risk : 0;
      const tp1Usd = 0.5 * riskUsd * activeLvls.rr1;
      const tp2Usd = tp1Usd + 0.5 * riskUsd * activeLvls.rr2;
      document.getElementById('tkSizing').innerHTML = `
        <div><b>Size:</b> <span class="mono">${units.toFixed(2)} units</span> (1R = $${riskUsd.toFixed(2)} @ ${state.riskPct}%)</div>
        <div><b>TP1 (50% + BE):</b> <span class="mono" style="color:#fbbf24;">+$${tp1Usd.toFixed(2)}</span></div>
        <div><b>TP2 (Full Target):</b> <span class="mono" style="color:#26a69a;">+$${tp2Usd.toFixed(2)} (+${(0.5 * activeLvls.rr1 + 0.5 * activeLvls.rr2).toFixed(2)}R)</span></div>
      `;
    } else {
      posVisEl.innerHTML = '';
      lvlsEl.innerHTML = `
        <div class="lvl"><span>HTF CRTH (Upper Liquidity)</span><span>${f(setup.crth)}</span></div>
        <div class="lvl tp1"><span>HTF 50% Equilibrium (TP1)</span><span>${f(setup.mid)}</span></div>
        <div class="lvl"><span>HTF CRTL (Lower Liquidity)</span><span>${f(setup.crtl)}</span></div>
      `;
      document.getElementById('tkSizing').innerHTML = `<div>Position tool activates automatically once LTF price purges CRTH or CRTL.</div>`;
    }

    document.getElementById('tkScore').textContent = `${setup.passes || 0}/${setup.total || 0}`;
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
    document.getElementById('setupsSummary').textContent = `${setups.length} evaluated — click row to inspect setup`;
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
          <td><span class="st-pill ${sp.isPure ? 'st-live' : 'st-muted'}">${sp.isPure ? 'QUALIFIED' : 'Filtered'}</span></td>
          <td><b>${sp.probTP1}%</b></td>
          <td>${s.keyLevels && s.keyLevels[0] ? s.keyLevels[0].type : 'None'}</td>
          <td>${s.insideLTF >= 2 ? `${s.insideLTF}i` : '—'}</td>
          <td>${f(s.entry)}</td>
          <td style="color:#f23645;">${f(s.sl)}</td>
          <td>${f(s.tp1)} / ${f(s.tp2)}</td>
          <td><b>${s.grade || '—'}</b></td>
          <td style="color:${s.r50 > 0 ? '#26a69a' : s.r50 < 0 ? '#f23645' : 'inherit'};">${rTxt}</td>
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

  /* ---------------- Render Filtered Signals View ---------------- */
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
        <div class="card" style="grid-column: 1 / -1; text-align:center; padding:26px;">
          <h3 style="font-size:13px; margin-bottom:5px; color:#fff;">Scanning Watchlist for High-Confluence Setups</h3>
          <p class="muted small">Setups appear here only when all 6 structural and probability criteria are met.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = pureList.map(item => {
      const { market, setup, ml, decimals, price } = item;
      const f = v => v != null && isFinite(v) ? v.toFixed(decimals || 2) : '—';
      const stInfo = E.STATE_INFO[setup.state] || { label: setup.state, tone: 'good' };
      const kl = setup.keyLevels && setup.keyLevels[0] ? `${setup.keyLevels[0].type}` : 'Confirmed';
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
              <div style="font-weight:700; font-size:13px; color:#fff;">${market.name}</div>
              <div class="small muted">${market.group} · ${F.TF_PAIRS[state.pairKey].label} · Spot ${f(price)}</div>
            </div>
            <div style="text-align:right;">
              <span class="st-pill st-${stInfo.tone}">${stInfo.label}</span>
              <div class="mono small" style="color:#26a69a; font-weight:600; margin-top:2px;">Grade ${setup.grade} · ${ml.probTP1}%</div>
            </div>
          </div>

          <div class="pos-visualizer" style="margin-bottom:0;">
            ${renderBlueRedHtml(setup, lvls, decimals || 2)}
          </div>

          <div class="small muted" style="display:grid; grid-template-columns:1fr 1fr; gap:4px;">
            <div>Key Level: <b style="color:var(--text);">${kl}</b></div>
            <div>Compression: <b style="color:var(--text);">${setup.insideLTF || 0} inside bars</b></div>
            <div>Sample Size: <b class="mono">${ml.samples}</b></div>
            <div>Est. Speed: <b class="mono">~${ml.avgBarsToTP1} bars</b></div>
          </div>

          <button class="btn primary block" data-opensig="${market.id}">
            Open Chart
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
      ltfChart.focusTime(ltfFocusT, 55, 25);
    }
  }

  /* ---------------- Load Active Market (Always Anchored to Live Price) ---------------- */
  async function loadActiveMarket() {
    const market = F.markets.get(state.marketId);
    if (!market) return;
    const loading = document.getElementById('loading');
    const loadingText = document.getElementById('loadingText');
    if (loading) loading.hidden = false;
    if (loadingText) loadingText.textContent = `Streaming ${market.name} (${F.TF_PAIRS[state.pairKey].label})…`;

    if (state.unsubLtf) { state.unsubLtf(); state.unsubLtf = null; }

    try {
      const series = await F.loadSeries(market, state.pairKey);
      const allSetups = E.findAllSetups(series, state.engineOpts);
      ML.trainOnSetups(series, allSetups);

      const evalRes = E.evaluateLive(series, state.engineOpts);
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

      // Keep both charts anchored to the live current market edge (do not pan back to old history)
      applyChartAnnotations(false);
      htfChart.fit(75);
      ltfChart.fit(85);

      renderTicketAndTable();
      renderWatchlist();
      maybeAlert(market, evalRes.primary, mlPred, dec);

      state.unsubLtf = F.subscribe(market, series.pair.ltf, c => {
        if (!state.series || state.series.market.id !== market.id) return;
        const ltf = state.series.ltf;
        const prevLast = ltf[ltf.length - 1];
        const barClosed = prevLast && c.time > prevLast.time;

        // Keep state.series.ltf synchronized with live incoming tick/candle
        if (prevLast && c.time === prevLast.time) {
          ltf[ltf.length - 1] = c;
        } else if (!prevLast || c.time > prevLast.time) {
          ltf.push(c);
        }
        ltfChart.update(c);

        const bTime = state.series.bucketFn(c.time);
        const htf = state.series.htf;
        const hLast = htf[htf.length - 1];
        if (hLast && hLast.time === bTime) {
          const updatedHtf = {
            time: bTime,
            open: hLast.open,
            high: Math.max(hLast.high, c.high),
            low: Math.min(hLast.low, c.low),
            close: c.close
          };
          htf[htf.length - 1] = updatedHtf;
          htfChart.update(updatedHtf);
        } else if (hLast && bTime > hLast.time) {
          const newHtf = { time: bTime, open: c.open, high: c.high, low: c.low, close: c.close };
          htf.push(newHtf);
          htfChart.update(newHtf);
        }

        updateQuoteHeader(market, state.series.pair, ltf, dec);
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
      toast(`<b>Feed notice (${market.name}):</b> ${err.message}`);
    } finally {
      if (loading) loading.hidden = true;
    }
  }

  function selectMarket(id) {
    if (!F.markets.has(id)) return;
    state.marketId = id;
    state.lastPrice = null;
    loadActiveMarket();
  }

  /* ---------------- Deep Quant Model Calibration ---------------- */
  async function deepTrainActivePair() {
    if (!state.series) return;
    const market = state.series.market;
    const btn = document.getElementById('trainMlBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Calibrating…'; }
    try {
      const deepSeries = await F.loadSeries(market, state.pairKey, { htfCount: 450, ltfCount: 2400 });
      const allSetups = E.findAllSetups(deepSeries, state.engineOpts);
      const m = ML.trainOnSetups(deepSeries, allSetups, 0.09);
      renderTicketAndTable();
      toast(`<b>Model Calibrated (${market.name}):</b> ${m.samples} historical setups analyzed · Avg sweep ${m.avgSweepATR.toFixed(2)} ATR.`);
    } catch (e) {} finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Calibrate'; }
    }
  }

  /* ---------------- Background Watchlist Scanner ---------------- */
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
          const s = await F.loadSeries(m, state.pairKey, { htfCount: 110, ltfCount: 300 });
          const allS = E.findAllSetups(s, state.engineOpts);
          ML.trainOnSetups(s, allS);
          const ev = E.evaluateLive(s, state.engineOpts);
          const chosen = ev.primary;
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
          if (m.feed === 'deriv') await new Promise(r => setTimeout(r, 220));
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
      ML.trainOnSetups(res.data, res.trades.map(t => t.setup), 0.08);
      renderTicketAndTable();

      if (prog) prog.textContent = `Completed — ${res.span.bars.toLocaleString()} ${F.TF_PAIRS[pairKey].ltfLabel} bars evaluated.`;

      const w = res.with50, wo = res.without50;
      const saved = res.trades.filter(t => t.outcome === 'BE').length;
      document.getElementById('btKpis').innerHTML = `
        <div class="kpi"><div class="kpi-lbl">Trades</div><div class="kpi-val">${w.n}</div></div>
        <div class="kpi"><div class="kpi-lbl">Win Rate (50% Rule)</div><div class="kpi-val" style="color:#26a69a;">${w.winRate.toFixed(1)}%</div></div>
        <div class="kpi"><div class="kpi-lbl">Win Rate (Full Hold)</div><div class="kpi-val" style="color:#f23645;">${wo.winRate.toFixed(1)}%</div></div>
        <div class="kpi"><div class="kpi-lbl">Net R (50% Rule)</div><div class="kpi-val" style="color:${w.totalR >= 0 ? '#26a69a' : '#f23645'};">${w.totalR >= 0 ? '+' : ''}${w.totalR.toFixed(2)}R</div></div>
        <div class="kpi"><div class="kpi-lbl">Net R (Full Hold)</div><div class="kpi-val" style="color:${wo.totalR >= 0 ? '#26a69a' : '#f23645'};">${wo.totalR >= 0 ? '+' : ''}${wo.totalR.toFixed(2)}R</div></div>
        <div class="kpi"><div class="kpi-lbl">Profit Factor</div><div class="kpi-val">${isFinite(w.pf) ? w.pf.toFixed(2) : '∞'}</div></div>
        <div class="kpi"><div class="kpi-lbl">Max Drawdown</div><div class="kpi-val">-${w.maxDD.toFixed(2)}R</div></div>
        <div class="kpi"><div class="kpi-lbl">Protected at BE</div><div class="kpi-val" style="color:#fbbf24;">${saved}</div></div>
      `;

      document.getElementById('btSpan').textContent = `${T.fmtCAT(res.span.from)} → ${T.fmtCAT(res.span.to)} CAT`;
      document.getElementById('btFunnel').textContent = `C1 Ranges: ${res.funnel.c1} · Purges: ${res.funnel.tbs} · Triggered: ${res.funnel.triggered}`;

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
          <td>${t.rr1.toFixed(2)}R / ${t.rr2.toFixed(2)}R</td>
          <td>${t.outcome}</td>
          <td style="color:${t.r50 >= 0 ? '#26a69a' : '#f23645'}; font-weight:600;">${t.r50 >= 0 ? '+' : ''}${t.r50.toFixed(2)}R</td>
          <td style="color:${t.rNo >= 0 ? '#868993' : '#f23645'};">${t.rNo >= 0 ? '+' : ''}${t.rNo.toFixed(2)}R</td>
        </tr>
      `).join('');
    } catch (err) {
      if (prog) prog.textContent = `Error: ${err.message}`;
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
        <div class="kpi"><div class="kpi-lbl">Recorded Trades</div><div class="kpi-val">${total}</div></div>
        <div class="kpi"><div class="kpi-lbl">Cumulative R</div><div class="kpi-val" style="color:${totalR >= 0 ? '#26a69a' : '#f23645'};">${totalR >= 0 ? '+' : ''}${totalR.toFixed(2)}R</div></div>
        <div class="kpi"><div class="kpi-lbl">Rule Adherence</div><div class="kpi-val">${total ? Math.round((clean / total) * 100) : 100}% (${clean}/${total})</div></div>
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
        <td style="color:${+j.r >= 0 ? '#26a69a' : '#f23645'}; font-weight:600;">${+j.r >= 0 ? '+' : ''}${(+j.r).toFixed(2)}R</td>
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

  /* ---------------- Reference & CAT Time Table ---------------- */
  function renderPlaybook() {
    const tbl = T.amdTableCAT();
    document.getElementById('pbDst').textContent = `NY ${tbl.isDst ? 'EDT (UTC-4) → CAT = NY + 6h' : 'EST (UTC-5) → CAT = NY + 7h'}`;
    document.querySelector('#pbTable tbody').innerHTML = tbl.rows.map(r => `
      <tr>
        <td>${r.cycle}</td>
        <td><b>${r.candle}</b></td>
        <td>${r.phase}</td>
        <td>${r.ny} NY</td>
        <td style="color:#26a69a; font-weight:600;">${r.cat} CAT</td>
      </tr>
    `).join('');

    const nextChange = T.nextUsClockChange();
    if (nextChange) {
      const afterTbl = T.amdTableCAT(nextChange + 3600e3);
      document.getElementById('pbNext').textContent =
        `Next US DST shift: ${T.fmtCAT(nextChange)} CAT (CAT becomes NY + ${afterTbl.offset}h).`;
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
        loadActiveMarket();
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
    document.getElementById('liveEdgeBtn')?.addEventListener('click', () => {
      htfChart.fit(75);
      ltfChart.fit(85);
    });
    document.getElementById('jumpBtn').addEventListener('click', () => applyChartAnnotations(true));
    document.getElementById('reloadBtn').addEventListener('click', () => loadActiveMarket());
    document.getElementById('trainMlBtn')?.addEventListener('click', deepTrainActivePair);
    document.getElementById('scanPureSignalsBtn')?.addEventListener('click', () => {
      toast('Scanning watchlist & calibrating models…');
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
      toast(state.alertsOn ? 'Audio & desktop alerts enabled.' : 'Alerts muted.');
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
    document.getElementById('sSave')?.addEventListener('click', () => {
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
      loadActiveMarket();
    });
    document.getElementById('sReset')?.addEventListener('click', () => {
      state.engineOpts = { ...E.DEFAULTS, minRR: 1.15 };
      savePrefs();
      modal.hidden = true;
      loadActiveMarket();
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
      toast('Levels copied to clipboard.');
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

    await loadActiveMarket();
    setTimeout(scanWatchlistOnce, 1800);
    setInterval(scanWatchlistOnce, 90000);
  });
})();
