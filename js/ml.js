/**
 * Online Per-Pair Machine Learning Engine (js/ml.js)
 *
 * Gradually learns how each individual pair (Vol 75, Boom 1000, PainX 400, GainX 800, Gold, BTC, etc.)
 * moves and reacts to CRT + TBS setups using Online Logistic Regression (SGD with L2 regularization)
 * + empirical pair-movement profiling (sweep depth in ATR, time-to-TP1, best Keylevel, spike behavior).
 *
 * Persists learned weights per market in localStorage so the model continuously improves as you scan,
 * stream live candles, or run deep historical training.
 */
(function () {
  const E = window.CRTEngine;
  const STORAGE_KEY = 'crt_ml_pair_models_v2';

  const FEATURE_NAMES = [
    'CRT Body Strength',
    'Sweep Depth (ATR)',
    'A+ Inside Compression',
    'TBS Breakout Body',
    'Model #1 Displacement',
    'Orderblock (OB)',
    'Fair Value Gap (FVG)',
    'Old High/Low Purged',
    'HTF Trend Harmony',
    'Spike / Session Harmony'
  ];

  // Prior weights encoding domain knowledge before pair-specific SGD updates
  const PRIOR_WEIGHTS = [0.55, -0.25, 0.75, 0.35, 0.65, 0.60, 0.65, 0.50, 0.45, 0.70];
  const PRIOR_BIAS = 0.25;

  const models = new Map();

  function sigmoid(z) {
    if (z > 12) return 0.9999;
    if (z < -12) return 0.0001;
    return 1 / (1 + Math.exp(-z));
  }

  function loadModels() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      for (const [k, v] of Object.entries(raw)) {
        if (v && Array.isArray(v.weights) && v.weights.length === FEATURE_NAMES.length) {
          models.set(k, v);
        }
      }
    } catch (e) {}
  }

  function saveModels() {
    try {
      const obj = {};
      for (const [k, v] of models.entries()) {
        // Keep payload compact
        obj[k] = {
          weights: v.weights.map(w => +w.toFixed(4)),
          bias: +v.bias.toFixed(4),
          samples: v.samples,
          wins: v.wins,
          tp2Wins: v.tp2Wins,
          avgSweepATR: +(v.avgSweepATR || 0.45).toFixed(3),
          avgBarsToTP1: Math.round(v.avgBarsToTP1 || 12),
          klStats: v.klStats || {},
          seenIds: (v.seenIds || []).slice(-180),
          updatedAt: v.updatedAt || Date.now()
        };
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch (e) {}
  }

  function getModel(marketId) {
    if (!models.has(marketId)) {
      models.set(marketId, {
        weights: PRIOR_WEIGHTS.slice(),
        bias: PRIOR_BIAS,
        samples: 0,
        wins: 0,
        tp2Wins: 0,
        avgSweepATR: 0.42,
        avgBarsToTP1: 11,
        klStats: { OB: { w: 0, n: 0 }, FVG: { w: 0, n: 0 }, OHP: { w: 0, n: 0 }, OLP: { w: 0, n: 0 } },
        seenIds: [],
        updatedAt: Date.now()
      });
    }
    return models.get(marketId);
  }

  /**
   * Extract 10 normalized movement & structure features [-1..+1] from a setup and its series
   */
  function extractFeatures(series, setup) {
    const { htf, ltf, market } = series;
    const c1Idx = setup.c1Idx;
    const tbsIdx = setup.tbsIdx ?? (ltf.length - 1);
    const m1Idx = setup.model1Idx != null && setup.model1Idx >= 0 ? setup.model1Idx : tbsIdx;

    // 1. CRT C1 body ratio
    const fBody = Math.min(1, Math.max(0, (setup.bodyRatio - 0.45) / 0.45));

    // 2. Manipulation sweep depth in LTF ATR units
    const ltfAtr = Math.max(setup.atr || E.atr(ltf, Math.min(ltf.length - 1, tbsIdx), 14), 1e-8);
    const sweptPrice = setup.isBear ? setup.crth : setup.crtl;
    const sweepDist = setup.extreme != null ? Math.abs(setup.extreme - sweptPrice) : ltfAtr * 0.4;
    const sweepATR = Math.min(3.0, sweepDist / ltfAtr);
    const fSweep = 1 - Math.min(1, sweepATR / 2.2); // cleaner, tighter sweeps score higher

    // 3. A+ inside candle compression prior to TBS (2..6 candles)
    const fInside = Math.min(1, (setup.insideLTF || 0) / 4);

    // 4. TBS candle body ratio
    const tbsC = ltf[tbsIdx];
    const fTbs = tbsC ? E.metrics(tbsC).bodyRatio : 0.5;

    // 5. Model #1 opposing candle displacement strength
    const m1C = ltf[m1Idx];
    const fM1 = m1C ? E.metrics(m1C).bodyRatio : 0.5;

    // 6–8. HTF Key levels present
    const kls = setup.keyLevels || [];
    const hasOB = kls.some(k => k.type === 'OB') ? 1 : 0;
    const hasFVG = kls.some(k => k.type === 'FVG') ? 1 : 0;
    const hasOHP = kls.some(k => k.type === 'OHP' || k.type === 'OLP') ? 1 : 0;

    // 9. HTF 10-bar trend slope harmony
    let fTrend = 0;
    if (c1Idx >= 8 && htf[c1Idx] && htf[c1Idx - 8]) {
      const slope = htf[c1Idx].close - htf[c1Idx - 8].close;
      // If HTF was trending in the direction of the reversal (or mean-reverting after exhaustion)
      fTrend = (setup.isBear ? slope < 0 : slope > 0) ? 0.65 : 0.25;
    }

    // 10. Spike / Session harmony
    let fHarmony = 0.5;
    if (market.spike) {
      const withSpike = (market.spike === 'down' && setup.isBear) || (market.spike === 'up' && !setup.isBear);
      fHarmony = withSpike ? 1.0 : -0.6;
    } else if (setup.time && setup.time.status === 'pass') {
      fHarmony = 0.9;
    }

    return {
      x: [fBody, fSweep, fInside, fTbs, fM1, hasOB, hasFVG, hasOHP, fTrend, fHarmony],
      sweepATR
    };
  }

  /**
   * Online SGD training pass over all completed setups in the series
   */
  function trainOnSetups(series, setups, lr = 0.08) {
    if (!series || !Array.isArray(setups)) return getModel(series?.market?.id || 'R_75');
    const m = getModel(series.market.id);
    const seen = new Set(m.seenIds || []);
    let updated = false;

    for (const s of setups) {
      if (s.r50 == null || s.tbsIdx == null) continue;
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      updated = true;

      const { x, sweepATR } = extractFeatures(series, s);
      const y = s.r50 > 0 ? 1 : 0;

      // Dot product w·x + b
      let z = m.bias;
      for (let i = 0; i < x.length; i++) z += m.weights[i] * x[i];
      const pred = sigmoid(z);
      const err = y - pred; // gradient of log-likelihood

      // SGD update with L2 decay toward prior weights so small samples never overfit
      for (let i = 0; i < x.length; i++) {
        const reg = 0.02 * (PRIOR_WEIGHTS[i] - m.weights[i]);
        m.weights[i] += lr * (err * x[i] + reg);
      }
      m.bias += lr * (err + 0.02 * (PRIOR_BIAS - m.bias));

      // Update pair movement statistics
      m.samples += 1;
      if (y === 1) m.wins += 1;
      if (s.outcome === 'TP2') m.tp2Wins += 1;
      m.avgSweepATR = (m.avgSweepATR * (m.samples - 1) + sweepATR) / m.samples;

      if (s.tp1Idx != null && s.tp1Idx > s.entryIdx) {
        const bars = s.tp1Idx - s.entryIdx;
        m.avgBarsToTP1 = (m.avgBarsToTP1 * 0.85) + (bars * 0.15);
      }

      if (s.keyLevels && s.keyLevels.length) {
        for (const kl of s.keyLevels) {
          if (!m.klStats[kl.type]) m.klStats[kl.type] = { w: 0, n: 0 };
          m.klStats[kl.type].n += 1;
          if (y === 1) m.klStats[kl.type].w += 1;
        }
      }
    }

    if (updated) {
      m.seenIds = Array.from(seen).slice(-180);
      m.updatedAt = Date.now();
      saveModels();
    }
    return m;
  }

  /**
   * Predict win probability & pair-specific behavior for a setup
   */
  function predict(series, setup) {
    const m = getModel(series.market.id);
    if (!setup || setup.tbsIdx == null) {
      const baseRate = m.samples >= 5 ? (m.wins / m.samples) : 0.68;
      return {
        probTP1: Math.round(baseRate * 100),
        probTP2: Math.round(baseRate * 58),
        samples: m.samples,
        empiricalWinRate: m.samples ? Math.round((m.wins / m.samples) * 100) : null,
        avgSweepATR: m.avgSweepATR,
        avgBarsToTP1: Math.round(m.avgBarsToTP1),
        recommendedSLBufferATR: +(Math.max(0.12, m.avgSweepATR * 0.35)).toFixed(2),
        bestKeyLevel: bestKeyLevelFor(m),
        topDrivers: topDriversFor(m),
        isPure: false
      };
    }

    const { x } = extractFeatures(series, setup);
    let z = m.bias;
    for (let i = 0; i < x.length; i++) z += m.weights[i] * x[i];
    const logisticProb = sigmoid(z);

    // Blend logistic prediction with empirical Bayesian Beta(wins+4, losses+2) rate on this pair
    const bayesRate = (m.wins + 4) / (m.samples + 6);
    const blended = 0.65 * logisticProb + 0.35 * bayesRate;
    const probTP1 = Math.min(96, Math.max(25, Math.round(blended * 100)));
    const tp2Ratio = m.wins > 0 ? Math.max(0.45, m.tp2Wins / m.wins) : 0.56;
    const probTP2 = Math.min(88, Math.max(18, Math.round(probTP1 * tp2Ratio)));

    const pred = {
      probTP1,
      probTP2,
      samples: m.samples,
      empiricalWinRate: m.samples ? Math.round((m.wins / m.samples) * 100) : null,
      avgSweepATR: +m.avgSweepATR.toFixed(2),
      avgBarsToTP1: Math.round(m.avgBarsToTP1),
      recommendedSLBufferATR: +(Math.max(0.12, m.avgSweepATR * 0.35)).toFixed(2),
      bestKeyLevel: bestKeyLevelFor(m),
      topDrivers: topDriversFor(m)
    };
    pred.isPure = isPureSignal(series.market, setup, pred);
    return pred;
  }

  function bestKeyLevelFor(m) {
    let best = 'FVG / OHP', bestRate = -1;
    for (const [k, st] of Object.entries(m.klStats || {})) {
      if (st.n >= 1) {
        const r = st.w / st.n;
        if (r > bestRate) { bestRate = r; best = `${k} (${Math.round(r * 100)}%)`; }
      }
    }
    return best;
  }

  function topDriversFor(m) {
    return FEATURE_NAMES
      .map((name, i) => ({ name, weight: m.weights[i] }))
      .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
      .slice(0, 4);
  }

  /**
   * STRICT 5-GATE ANTI-RANDOM FILTER:
   * Rejects weak, random, or unconfirmed trades. Only pure high-confluence setups pass.
   */
  function isPureSignal(market, setup, mlPred) {
    if (!setup || setup.entry == null) return false;
    // Gate 1: Must be in an active/actionable trade state or newly triggered
    const allowedStates = new Set(['IN_TRADE', 'TP1_RUNNER', 'WAIT_TRIGGER', 'TP2', 'BREAKEVEN']);
    if (!allowedStates.has(setup.state)) return false;
    // Gate 2: Must have a verified HTF Key Level (OB, FVG, OHP, or OLP) — never take floating candles
    if (!setup.keyLevels || setup.keyLevels.length === 0) return false;
    // Gate 3: Must pass Risk-to-Reward filter to 50% CRT midpoint (TP1 >= 1.15)
    if (!setup.rr1 || setup.rr1 < 1.15) return false;
    // Gate 4: Must be Grade A+ or A (no critical strategy violations)
    if (setup.grade !== 'A+' && setup.grade !== 'A') return false;
    // Gate 5: If trading against Boom/Crash/PainX/GainX spike, require A+ inside-candle compression (2-6 inside candles)
    if (setup.againstSpike && (setup.insideLTF || 0) < 2) return false;
    // Gate 6: ML Pair-Movement Confidence must be >= 66%
    if ((mlPred?.probTP1 || 0) < 66) return false;
    return true;
  }

  loadModels();

  window.CRTML = {
    FEATURE_NAMES,
    getModel,
    trainOnSetups,
    predict,
    isPureSignal
  };
})();
