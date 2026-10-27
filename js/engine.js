/**
 * Unified CRT strategy engine (PDF 1 "CRT + TBS" + PDF 2 "CRT Unlocked").
 *
 * Honesty rules:
 *  - Every check is computed from real candles; nothing is invented.
 *  - The scan is causal: a setup only uses candles up to the moment each decision
 *    is made, so the live view and the backtester run the exact same logic.
 *
 * Flow for each closed, thick-bodied HTF candle (C1):
 *   1. Mark CRTH / 50% / CRTL.
 *   2. On the LTF, wait (up to `maxWait` HTF candles) for TBS: the first LTF candle
 *      that CLOSES beyond CRTH (→ sell) or CRTL (→ buy).        [PDF 1 p.16]
 *   3. Count inside candles before TBS (2–6 = A+ TBS).          [PDF 1 p.17]
 *   4. Model #1 reference candle, then entry on the first LTF close beyond it.
 *                                                               [PDF 1 p.18–20, PDF 2 p.18]
 *   5. Invalidate if an HTF candle CLOSES beyond the swept level before entry
 *      (acceptance, not manipulation) or price reaches 50% before entry (missed).
 *   6. SL beyond the manipulation extreme (+ buffer), TP1 = 50% CRT (close half, SL→BE),
 *      TP2 = opposite end of the CRT.                           [PDF 1 p.8, PDF 2 p.16]
 *   7. Skip if RR to TP1 is below the minimum.                  [PDF 1 p.29]
 */
(function () {
  const T = window.CRTTime;

  const DEFAULTS = {
    minBodyRatio: 0.5,     // CRT candle body ≥ 50% of range and larger than each wick
    maxWait: 6,            // HTF candles to wait for the sweep ("till God desires", capped)
    maxTriggerBars: 30,    // LTF candles after TBS to find Model #1 trigger
    model1: 'pdf2',        // 'pdf2' = thick candle INTO the level; 'pdf1' = thick opposing candle after TBS
    minRR: 1.0,            // min RR to TP1 (50%)
    slBufferATR: 0.1,      // SL buffer in LTF ATRs
    spikeBufferATR: 1.0,   // extra buffer when trading against Boom/Crash/GainX/PainX spike direction
    lookbackC1: 14         // how many recent HTF candles to consider for the live setup
  };

  /* ---------------- helpers ---------------- */
  function metrics(c) {
    const range = c.high - c.low;
    const body = Math.abs(c.close - c.open);
    return {
      range,
      body,
      upper: c.high - Math.max(c.open, c.close),
      lower: Math.min(c.open, c.close) - c.low,
      bodyRatio: range > 0 ? body / range : 0,
      bull: c.close > c.open
    };
  }
  function isThick(c, minRatio) {
    const m = metrics(c);
    return m.range > 0 && m.bodyRatio >= minRatio && m.body > m.upper && m.body > m.lower;
  }
  function atr(candles, endIdx, n = 14) {
    let sum = 0, cnt = 0;
    for (let k = Math.max(1, endIdx - n + 1); k <= endIdx; k++) {
      const c = candles[k], p = candles[k - 1];
      sum += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
      cnt++;
    }
    return cnt ? sum / cnt : 0;
  }
  function lowerBound(arr, t) {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].time < t) lo = mid + 1; else hi = mid;
    }
    return lo;
  }
  // index of HTF candle containing time t
  function htfIndexAt(htf, t) {
    const i = lowerBound(htf, t + 1) - 1;
    return i;
  }

  /* ---------------- Key levels before C1 (PDF 1 p.9–14) ---------------- */
  function findKeyLevel(htf, i, isBear, extreme) {
    const c1 = htf[i];
    const lb = Math.max(2, i - 25);
    const found = [];

    // OHP / OLP: a swing (fractal) high/low before C1 that the setup purged and that
    // had not already been purged before C1.
    for (let k = i - 2; k >= lb; k--) {
      const c = htf[k];
      const isSwingH = c.high > htf[k - 1].high && c.high > htf[k - 2].high && c.high >= htf[k + 1].high && (k + 2 > i || c.high >= htf[k + 2].high);
      const isSwingL = c.low < htf[k - 1].low && c.low < htf[k - 2].low && c.low <= htf[k + 1].low && (k + 2 > i || c.low <= htf[k + 2].low);
      if (isBear && isSwingH && extreme > c.high) {
        let purgedBefore = false;
        for (let m = k + 1; m < i; m++) if (htf[m].high > c.high) { purgedBefore = true; break; }
        if (!purgedBefore && c.high >= c1.low) {
          found.push({ type: 'OHP', name: 'Old High Purged', top: c.high, bottom: c.high, price: c.high, time: c.time });
          break;
        }
      }
      if (!isBear && isSwingL && extreme < c.low) {
        let purgedBefore = false;
        for (let m = k + 1; m < i; m++) if (htf[m].low < c.low) { purgedBefore = true; break; }
        if (!purgedBefore && c.low <= c1.high) {
          found.push({ type: 'OLP', name: 'Old Low Purged', top: c.low, bottom: c.low, price: c.low, time: c.time });
          break;
        }
      }
    }

    // FVG traded into by the setup
    for (let k = i - 1; k >= lb + 2; k--) {
      const a = htf[k - 2], b = htf[k];
      if (isBear && a.low > b.high) {
        const zone = { bottom: b.high, top: a.low };
        if (extreme >= zone.bottom && c1.low <= zone.top) {
          found.push({ type: 'FVG', name: 'Bearish Fair Value Gap', ...zone, price: (zone.top + zone.bottom) / 2, time: htf[k - 1].time });
          break;
        }
      }
      if (!isBear && a.high < b.low) {
        const zone = { bottom: a.high, top: b.low };
        if (extreme <= zone.top && c1.high >= zone.bottom) {
          found.push({ type: 'FVG', name: 'Bullish Fair Value Gap', ...zone, price: (zone.top + zone.bottom) / 2, time: htf[k - 1].time });
          break;
        }
      }
    }

    // Order block: last opposite candle before a displacement that closed through it
    for (let k = i - 1; k >= lb; k--) {
      const c = htf[k];
      const m = metrics(c);
      let displaced = false;
      for (let n = k + 1; n <= Math.min(k + 3, i); n++) {
        if (isBear && m.bull && htf[n].close < c.low) displaced = true;
        if (!isBear && !m.bull && m.body > 0 && htf[n].close > c.high) displaced = true;
      }
      if (!displaced) continue;
      const zone = isBear ? { bottom: c.open, top: c.high } : { bottom: c.low, top: c.open };
      const touched = isBear ? extreme >= zone.bottom && c1.low <= zone.top : extreme <= zone.top && c1.high >= zone.bottom;
      if (touched) {
        found.push({ type: 'OB', name: isBear ? 'Bearish Order Block' : 'Bullish Order Block', ...zone, price: (zone.top + zone.bottom) / 2, time: c.time });
        break;
      }
    }
    return found;
  }

  /* ---------------- Time check (PDF 2 p.12–14) ---------------- */
  function timeCheck(htfKey, ms, profile) {
    if (profile === 'synthetic') {
      return { status: 'na', text: 'Synthetic index — 24/7 algorithm, no sessions. Time filter off.' };
    }
    const w = T.nyWall(ms);
    const h = w.getUTCHours() + w.getUTCMinutes() / 60;
    const dow = w.getUTCDay();
    const dom = w.getUTCDate();
    const when = `${T.fmtCAT(ms)} CAT (${T.fmtNY(ms)})`;
    switch (htfKey) {
      case '4h': {
        const ok = (h >= 5 && h < 9) || (h >= 9.5 && h < 10.5);
        return { status: ok ? 'pass' : 'fail', text: `TBS at ${when}. Manipulation window: 05:00–09:00 or 09:30–10:30 NY.` };
      }
      case '1h': {
        const ok = (h >= 2 && h < 5) || (h >= 9.5 && h < 11);
        return { status: ok ? 'pass' : 'fail', text: `TBS at ${when}. Killzones: London 02:00–05:00 or NY 09:30–11:00 NY.` };
      }
      case '1d': {
        const status = dow === 2 ? 'pass' : (dow === 1 || dow === 3) ? 'warn' : 'fail';
        return { status, text: `TBS on ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow]} (${when}). Weekly AMD: Tuesday = manipulation.` };
      }
      case '1w': {
        const ok = dom >= 8 && dom <= 14;
        return { status: ok ? 'pass' : 'fail', text: `TBS on day ${dom} of month. Monthly AMD: week 2 = manipulation.` };
      }
      default:
        return { status: 'na', text: 'No AMD time rule defined for monthly HTF.' };
    }
  }

  /* ---------------- SMT check (PDF 2 p.24–28) ---------------- */
  function smtCheck(htf, i, manipIdx, isBear, smtHtf, rel, partnerName) {
    if (!smtHtf || !smtHtf.length) return { status: 'na', text: 'No correlated pair for this market.' };
    const byTime = new Map(smtHtf.map(c => [c.time, c]));
    const p1 = byTime.get(htf[i].time);
    if (!p1) return { status: 'na', text: `${partnerName}: candle data not aligned.` };
    let pHigh = -Infinity, pLow = Infinity, n = 0;
    for (let j = i + 1; j <= manipIdx; j++) {
      const p = byTime.get(htf[j].time);
      if (!p) continue;
      n++;
      pHigh = Math.max(pHigh, p.high);
      pLow = Math.min(pLow, p.low);
    }
    if (!n) return { status: 'na', text: `${partnerName}: no aligned manipulation candle.` };
    const inverse = rel === 'inverse';
    const partnerSwept = isBear
      ? (inverse ? pLow < p1.low : pHigh > p1.high)
      : (inverse ? pHigh > p1.high : pLow < p1.low);
    return partnerSwept
      ? { status: 'fail', text: `${partnerName} also swept its ${isBear !== inverse ? 'high' : 'low'} — no divergence.` }
      : { status: 'pass', text: `${partnerName} failed to sweep its ${isBear !== inverse ? 'high' : 'low'} — SMT divergence.` };
  }

  /* ---------------- Inside candles before TBS (PDF 1 p.17) ---------------- */
  function insideBefore(ltf, tbs) {
    for (let n = 6; n >= 2; n--) {
      const motherIdx = tbs - n - 1;
      if (motherIdx < 0) continue;
      const m = ltf[motherIdx];
      let ok = true;
      for (let k = motherIdx + 1; k < tbs; k++) {
        if (ltf[k].high > m.high || ltf[k].low < m.low) { ok = false; break; }
      }
      if (ok) return { count: n, motherIdx };
    }
    return { count: 0, motherIdx: -1 };
  }

  /* ---------------- Trade management ---------------- */
  function manage(ltf, e, isBear, entry, sl, tp1, tp2, rr1, rr2) {
    const res = { outcome: 'OPEN', r50: null, tp1Idx: -1, exitIdx: -1, noOutcome: 'OPEN', rNo: null, noExitIdx: -1 };
    for (let k = e + 1; k < ltf.length; k++) {
      const c = ltf[k];
      const hitSL = isBear ? c.high >= sl : c.low <= sl;
      const hitTP1 = isBear ? c.low <= tp1 : c.high >= tp1;
      const hitTP2 = isBear ? c.low <= tp2 : c.high >= tp2;
      const hitBE = isBear ? c.high >= entry : c.low <= entry;

      if (res.outcome === 'OPEN') {
        if (res.tp1Idx < 0) {
          if (hitSL) { res.outcome = 'SL'; res.r50 = -1; res.exitIdx = k; }      // same-bar ambiguity → assume worst
          else if (hitTP1) {
            res.tp1Idx = k;
            if (hitTP2) { res.outcome = 'TP2'; res.r50 = 0.5 * rr1 + 0.5 * rr2; res.exitIdx = k; }
          }
        } else if (hitBE) { res.outcome = 'BE'; res.r50 = 0.5 * rr1; res.exitIdx = k; }
        else if (hitTP2) { res.outcome = 'TP2'; res.r50 = 0.5 * rr1 + 0.5 * rr2; res.exitIdx = k; }
      }
      if (res.noOutcome === 'OPEN') {
        if (hitSL) { res.noOutcome = 'SL'; res.rNo = -1; res.noExitIdx = k; }
        else if (hitTP2) { res.noOutcome = 'TP2'; res.rNo = rr2; res.noExitIdx = k; }
      }
      if (res.outcome !== 'OPEN' && res.noOutcome !== 'OPEN') break;
    }
    if (res.outcome === 'OPEN' && res.tp1Idx >= 0) res.outcome = 'RUNNER';
    return res;
  }

  /* ---------------- Evaluate one C1 candidate ---------------- */
  function evaluateC1(data, i, o) {
    const { htf, ltf, market, pair } = data;
    const c1 = htf[i];
    const crth = c1.high, crtl = c1.low, mid = (crth + crtl) / 2;
    const base = {
      id: `${market.id}|${pair.key}|${c1.time}`,
      c1Idx: i, c1, crth, crtl, mid,
      bodyRatio: metrics(c1).bodyRatio
    };
    if (!htf[i + 1]) return { ...base, state: 'C1_FORMING' };
    const startT = htf[i + 1].time;
    const lastWaitIdx = i + o.maxWait;
    const windowEnd = htf[lastWaitIdx + 1] ? htf[lastWaitIdx + 1].time : Infinity;

    if (!ltf.length || ltf[0].time > startT) return { ...base, state: 'NO_LTF' };
    const s = lowerBound(ltf, startT);

    // 1. TBS
    let tbs = -1, isBear = null;
    for (let k = s; k < ltf.length && ltf[k].time < windowEnd; k++) {
      // HTF candle closed outside the range without an LTF body close? (gap) — treat as expired
      if (ltf[k].close > crth) { tbs = k; isBear = true; break; }
      if (ltf[k].close < crtl) { tbs = k; isBear = false; break; }
    }
    if (tbs < 0) {
      const lastT = ltf.length ? ltf[ltf.length - 1].time : 0;
      return { ...base, state: lastT < windowEnd ? 'WAITING_SWEEP' : 'EXPIRED', windowEnd };
    }

    const dir = isBear ? 'SELL' : 'BUY';
    const manipIdx = htfIndexAt(htf, ltf[tbs].time);
    let insideHTF = 0;
    for (let j = i + 1; j < manipIdx; j++) if (htf[j].high <= crth && htf[j].low >= crtl) insideHTF++;
    const inside = insideBefore(ltf, tbs);

    // first LTF candle that pierced the level (start of manipulation)
    let pierce = tbs;
    for (let k = s; k <= tbs; k++) if (isBear ? ltf[k].high > crth : ltf[k].low < crtl) { pierce = k; break; }

    // 2. Model #1 + trigger, with invalidation
    let ref = -1, entry = -1, state = null, invalidReason = '';
    let hj = manipIdx;
    const endK = Math.min(ltf.length, tbs + o.maxTriggerBars);
    for (let k = tbs; k < endK; k++) {
      const c = ltf[k];
      // HTF acceptance check: any HTF candle that has fully closed before this LTF candle
      while (htf[hj + 1] && htf[hj + 1].time <= c.time) {
        const hc = htf[hj];
        if (isBear ? hc.close > crth : hc.close < crtl) {
          state = 'INVALID';
          invalidReason = `${pair.htfLabel} candle closed beyond ${isBear ? 'CRTH' : 'CRTL'} (acceptance, not manipulation)`;
          break;
        }
        hj++;
      }
      if (state) break;
      if (ref >= 0 && (isBear ? c.close < ltf[ref].low : c.close > ltf[ref].high)) { entry = k; break; }
      if (isBear ? c.low <= mid : c.high >= mid) {
        state = 'MISSED';
        invalidReason = 'Price reached 50% before a Model #1 trigger';
        break;
      }
      const m = metrics(c);
      const thick = isThick(c, o.minBodyRatio);
      if (o.model1 === 'pdf2') {
        if (thick && (isBear ? m.bull : !m.bull && m.body > 0)) ref = k;
      } else if (k > tbs && ref < 0 && thick && (isBear ? !m.bull : m.bull)) {
        ref = k;
      }
    }

    const setup = {
      ...base, dir, isBear, tbsIdx: tbs, pierceIdx: pierce, manipIdx, insideHTF,
      insideLTF: inside.count, motherIdx: inside.motherIdx, model1Idx: ref
    };

    // Context checks (computed even if not triggered, for display)
    let extreme = isBear ? -Infinity : Infinity;
    const extremeEnd = entry >= 0 ? entry : Math.min(ltf.length - 1, endK - 1);
    for (let k = pierce; k <= extremeEnd; k++) {
      extreme = isBear ? Math.max(extreme, ltf[k].high) : Math.min(extreme, ltf[k].low);
    }
    setup.extreme = extreme;
    setup.keyLevels = findKeyLevel(htf, i, isBear, extreme);
    setup.time = timeCheck(pair.htf, ltf[tbs].time, market.profile);
    setup.smt = smtCheck(htf, i, Math.max(manipIdx, i + 1), isBear, data.smtHtf, market.smtRel, data.smtMarket ? data.smtMarket.name : '');
    setup.crtType = classify(htf, i, manipIdx, insideHTF, isBear);

    if (state) return { ...setup, state, invalidReason };
    if (entry < 0) {
      const dataEnded = endK === ltf.length;
      return { ...setup, state: dataEnded ? (ref >= 0 ? 'WAIT_TRIGGER' : 'WAIT_MODEL1') : 'EXPIRED' };
    }

    // 3. Levels
    const a = atr(ltf, entry);
    let buffer = o.slBufferATR * a;
    const againstSpike = (market.spike === 'up' && isBear) || (market.spike === 'down' && !isBear);
    if (againstSpike) buffer += o.spikeBufferATR * a;
    const entryP = ltf[entry].close;
    const sl = isBear ? extreme + buffer : extreme - buffer;
    const tp1 = mid;
    const tp2 = isBear ? crtl : crth;
    const risk = Math.abs(entryP - sl);
    const rr1 = risk > 0 ? Math.abs(entryP - tp1) / risk : 0;
    const rr2 = risk > 0 ? Math.abs(entryP - tp2) / risk : 0;

    Object.assign(setup, { entryIdx: entry, entry: entryP, sl, tp1, tp2, risk, rr1, rr2, againstSpike, atr: a });

    // OTE zone of the displacement leg (PDF 2 Model #2)
    let legEnd = isBear ? Infinity : -Infinity, legEndIdx = entry;
    const legStop = Math.min(ltf.length - 1, entry + 40);
    for (let k = entry; k <= legStop; k++) {
      if (isBear ? ltf[k].low < legEnd : ltf[k].high > legEnd) { legEnd = isBear ? ltf[k].low : ltf[k].high; legEndIdx = k; }
      if (isBear ? ltf[k].low <= tp1 : ltf[k].high >= tp1) break;
    }
    const leg = Math.abs(extreme - legEnd);
    const f = r => isBear ? legEnd + leg * r : legEnd - leg * r;
    setup.ote = { from: f(0.5), to: f(0.786), deep: f(0.886), startIdx: legEndIdx };

    if (rr1 < o.minRR) return { ...setup, state: 'LOW_RR', invalidReason: `RR to 50% equilibrium is 1:${rr1.toFixed(2)} (below 1:${o.minRR} minimum)` };

    // 4. Manage
    const m = manage(ltf, entry, isBear, entryP, sl, tp1, tp2, rr1, rr2);
    Object.assign(setup, m);

    // KOD (PDF 2 Model #3): after a close beyond 50%, a sweep of the mini-range that closes back
    let past = -1;
    for (let k = entry + 1; k < ltf.length; k++) if (isBear ? ltf[k].close < mid : ltf[k].close > mid) { past = k; break; }
    if (past > 0) {
      let ext = isBear ? ltf[past].high : ltf[past].low;
      for (let k = past + 1; k < Math.min(ltf.length, past + 40); k++) {
        const c = ltf[k];
        if (isBear ? c.low <= tp2 : c.high >= tp2) break;
        if (k > past + 1 && (isBear ? c.high > ext && c.close < c.open && c.close < mid : c.low < ext && c.close > c.open && c.close > mid)) {
          setup.kod = { idx: k, price: c.close };
          break;
        }
        ext = isBear ? Math.max(ext, c.high) : Math.min(ext, c.low);
      }
    }

    const stateMap = { OPEN: 'IN_TRADE', RUNNER: 'TP1_RUNNER', TP2: 'TP2', SL: 'STOPPED', BE: 'BREAKEVEN' };
    setup.state = stateMap[m.outcome];
    return setup;
  }

  // PDF 2 p.6–11 structural types
  function classify(htf, i, manipIdx, insideHTF, isBear) {
    const c1 = htf[i];
    const mc = htf[manipIdx];
    if (!mc) return { id: 1, name: '3-Candle CRT' };
    const reachedOpp = isBear ? mc.low <= c1.low : mc.high >= c1.high;
    if (insideHTF === 0 && reachedOpp) return { id: 2, name: '2-Candle CRT' };
    if (insideHTF >= 5) return { id: 5, name: `Long Wait CRT (${insideHTF} inside)` };
    if (insideHTF >= 1) return { id: 3, name: `Candle 3 & Till God Desires (${insideHTF} inside)` };
    // Pause: after manipulation, 2+ HTF candles without reaching 50%
    const mid = (c1.high + c1.low) / 2;
    let pause = 0;
    for (let j = manipIdx + 1; j < Math.min(htf.length, manipIdx + 4); j++) {
      if (isBear ? htf[j].low > mid : htf[j].high < mid) pause++; else break;
    }
    if (pause >= 2) return { id: 4, name: 'Pause CRT' };
    return { id: 1, name: '3-Candle CRT' };
  }

  /* ---------------- Grading ---------------- */
  function buildChecks(s, o) {
    const checks = [];
    checks.push({ key: 'c1', title: 'HTF Range Candle (C1)', src: 'Range Spec', status: 'pass', text: `Body ${(s.bodyRatio * 100).toFixed(0)}% of range · ${s.crtType ? s.crtType.name : ''}` });
    if (s.keyLevels) {
      const kl = s.keyLevels[0];
      checks.push({ key: 'kl', title: 'HTF Key Level (OB / FVG / Liquidity)', src: 'HTF Structure', status: kl ? 'pass' : 'fail', text: kl ? s.keyLevels.map(k => k.type).join(' + ') + ` — ${kl.name}` : 'No HTF key level engaged' });
    }
    if (s.time) checks.push({ key: 'time', title: 'Session AMD Window', src: 'Session Timing', status: s.time.status, text: s.time.text });
    if (s.smt) checks.push({ key: 'smt', title: 'SMT Correlation Check', src: 'SMT Filter', status: s.smt.status, text: s.smt.text });
    if (s.tbsIdx != null) {
      checks.push({ key: 'tbs', title: 'LTF Inside-Bar Compression', src: 'Compression', status: s.insideLTF >= 2 ? 'pass' : 'warn', text: s.insideLTF >= 2 ? `${s.insideLTF} inside bars prior to TBS close` : 'Direct TBS close (0–1 inside bars)' });
    }
    if (s.rr1 != null) {
      checks.push({ key: 'rr', title: 'Reward-to-Risk to 50% EQ', src: 'Risk Filter', status: s.rr1 >= o.minRR ? 'pass' : 'fail', text: `TP1 ${s.rr1.toFixed(2)}R · TP2 ${s.rr2.toFixed(2)}R` });
    }
    if (s.againstSpike) {
      checks.push({ key: 'spike', title: 'Counter-Spike Buffer', src: 'Spike Guard', status: 'warn', text: 'Counter-spike direction — widened stop buffer applied' });
    }
    const applicable = checks.filter(c => c.status !== 'na');
    const fails = applicable.filter(c => c.status === 'fail').length;
    const warns = applicable.filter(c => c.status === 'warn').length;
    const passes = applicable.filter(c => c.status === 'pass').length;
    let grade = 'C';
    if (fails === 0 && warns === 0) grade = 'A+';
    else if (fails === 0) grade = 'A';
    else if (fails === 1) grade = 'B';
    return { checks, grade, passes, total: applicable.length };
  }

  /* ---------------- Public API ---------------- */
  const ACTIVE = new Set(['WAITING_SWEEP', 'WAIT_MODEL1', 'WAIT_TRIGGER', 'IN_TRADE', 'TP1_RUNNER']);
  const TRADED = new Set(['IN_TRADE', 'TP1_RUNNER', 'TP2', 'STOPPED', 'BREAKEVEN']);

  function findAllSetups(data, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const out = [];
    const { htf } = data;
    for (let i = 2; i < htf.length - 1; i++) {
      if (!isThick(htf[i], o.minBodyRatio)) continue;
      const s = evaluateC1(data, i, o);
      if (s.state === 'NO_LTF') continue;
      Object.assign(s, buildChecks(s, o));
      out.push(s);
    }
    return out;
  }

  function evaluateLive(data, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const { htf } = data;
    const setups = [];
    for (let i = htf.length - 2; i >= Math.max(2, htf.length - 2 - o.lookbackC1); i--) {
      if (!isThick(htf[i], o.minBodyRatio)) continue;
      const s = evaluateC1(data, i, o);
      if (s.state === 'NO_LTF') continue;
      Object.assign(s, buildChecks(s, o));
      setups.push(s);
    }
    // Strongly prioritize setups near the current live market bar so levels match live price
    const recentCutoff = htf.length - 7;
    const rank = s => {
      const isRecent = s.c1Idx >= recentCutoff ? 10 : 0;
      const stateScore = { IN_TRADE: 6, TP1_RUNNER: 6, WAIT_TRIGGER: 5, WAIT_MODEL1: 4, WAITING_SWEEP: 3 }[s.state] || (TRADED.has(s.state) ? 2 : 1);
      return isRecent + stateScore;
    };
    const primary = setups.slice().sort((a, b) => rank(b) - rank(a) || b.c1Idx - a.c1Idx)[0] || null;
    return { primary, setups, opts: o };
  }

  const STATE_INFO = {
    C1_FORMING: { label: 'C1 forming', tone: 'muted', step: 0 },
    WAITING_SWEEP: { label: 'Waiting for sweep', tone: 'info', step: 1 },
    WAIT_MODEL1: { label: 'TBS · wait Model #1', tone: 'warn', step: 2 },
    WAIT_TRIGGER: { label: 'Model #1 · wait close', tone: 'warn', step: 3 },
    IN_TRADE: { label: 'ENTRY LIVE', tone: 'live', step: 4 },
    TP1_RUNNER: { label: 'TP1 hit · SL at BE', tone: 'good', step: 5 },
    TP2: { label: 'TP2 hit', tone: 'good', step: 6 },
    BREAKEVEN: { label: 'TP1 + BE exit', tone: 'good', step: 6 },
    STOPPED: { label: 'Stopped out', tone: 'bad', step: 6 },
    LOW_RR: { label: 'Skipped · low RR', tone: 'muted', step: 4 },
    MISSED: { label: 'Missed (hit 50%)', tone: 'muted', step: 3 },
    INVALID: { label: 'Invalidated', tone: 'muted', step: 2 },
    EXPIRED: { label: 'Expired', tone: 'muted', step: 1 }
  };

  window.CRTEngine = { DEFAULTS, metrics, isThick, atr, evaluateLive, findAllSetups, STATE_INFO, ACTIVE, TRADED, lowerBound };
})();
