/**
 * Live data feeds (v2.5 — Full Deriv & Weltrade SyntX Catalog + GitHub Pages Ready):
 *  - Deriv public WebSocket API (all synthetic indices + auto-discovery + real forex/metals)
 *  - Weltrade SyntX (full PainX, GainX, FX Vol, SFX Vol, SwitchX, BreakX catalog via MT5 bridge
 *    with automatic browser-native SyntX live engine when hosted on GitHub Pages)
 *  - Binance public REST/WebSocket (crypto)
 * All candles: { time: UTC ms, open, high, low, close }
 */
(function () {
  const T = window.CRTTime;

  /* ---------------- Complete Market Catalog ---------------- */
  const STATIC_MARKETS = [
    // 1. Deriv Volatility Indices (Standard & 1s)
    { id: 'R_10', name: 'Volatility 10 Index', group: 'Deriv Volatility', cat: 'deriv_vol', feed: 'deriv', profile: 'synthetic' },
    { id: 'R_25', name: 'Volatility 25 Index', group: 'Deriv Volatility', cat: 'deriv_vol', feed: 'deriv', profile: 'synthetic' },
    { id: 'R_50', name: 'Volatility 50 Index', group: 'Deriv Volatility', cat: 'deriv_vol', feed: 'deriv', profile: 'synthetic' },
    { id: 'R_75', name: 'Volatility 75 Index', group: 'Deriv Volatility', cat: 'deriv_vol', feed: 'deriv', profile: 'synthetic' },
    { id: 'R_100', name: 'Volatility 100 Index', group: 'Deriv Volatility', cat: 'deriv_vol', feed: 'deriv', profile: 'synthetic' },
    { id: '1HZ10V', name: 'Volatility 10 (1s)', group: 'Deriv Volatility (1s)', cat: 'deriv_vol', feed: 'deriv', profile: 'synthetic' },
    { id: '1HZ15V', name: 'Volatility 15 (1s)', group: 'Deriv Volatility (1s)', cat: 'deriv_vol', feed: 'deriv', profile: 'synthetic' },
    { id: '1HZ25V', name: 'Volatility 25 (1s)', group: 'Deriv Volatility (1s)', cat: 'deriv_vol', feed: 'deriv', profile: 'synthetic' },
    { id: '1HZ30V', name: 'Volatility 30 (1s)', group: 'Deriv Volatility (1s)', cat: 'deriv_vol', feed: 'deriv', profile: 'synthetic' },
    { id: '1HZ50V', name: 'Volatility 50 (1s)', group: 'Deriv Volatility (1s)', cat: 'deriv_vol', feed: 'deriv', profile: 'synthetic' },
    { id: '1HZ75V', name: 'Volatility 75 (1s)', group: 'Deriv Volatility (1s)', cat: 'deriv_vol', feed: 'deriv', profile: 'synthetic' },
    { id: '1HZ90V', name: 'Volatility 90 (1s)', group: 'Deriv Volatility (1s)', cat: 'deriv_vol', feed: 'deriv', profile: 'synthetic' },
    { id: '1HZ100V', name: 'Volatility 100 (1s)', group: 'Deriv Volatility (1s)', cat: 'deriv_vol', feed: 'deriv', profile: 'synthetic' },
    { id: '1HZ150V', name: 'Volatility 150 (1s)', group: 'Deriv Volatility (1s)', cat: 'deriv_vol', feed: 'deriv', profile: 'synthetic' },
    { id: '1HZ200V', name: 'Volatility 200 (1s)', group: 'Deriv Volatility (1s)', cat: 'deriv_vol', feed: 'deriv', profile: 'synthetic' },
    { id: '1HZ250V', name: 'Volatility 250 (1s)', group: 'Deriv Volatility (1s)', cat: 'deriv_vol', feed: 'deriv', profile: 'synthetic' },

    // 2. Deriv Boom & Crash Indices
    { id: 'BOOM300N', name: 'Boom 300 Index', group: 'Deriv Boom & Crash', cat: 'deriv_boom', feed: 'deriv', profile: 'synthetic', spike: 'up' },
    { id: 'BOOM500', name: 'Boom 500 Index', group: 'Deriv Boom & Crash', cat: 'deriv_boom', feed: 'deriv', profile: 'synthetic', spike: 'up' },
    { id: 'BOOM600', name: 'Boom 600 Index', group: 'Deriv Boom & Crash', cat: 'deriv_boom', feed: 'deriv', profile: 'synthetic', spike: 'up' },
    { id: 'BOOM900', name: 'Boom 900 Index', group: 'Deriv Boom & Crash', cat: 'deriv_boom', feed: 'deriv', profile: 'synthetic', spike: 'up' },
    { id: 'BOOM1000', name: 'Boom 1000 Index', group: 'Deriv Boom & Crash', cat: 'deriv_boom', feed: 'deriv', profile: 'synthetic', spike: 'up' },
    { id: 'CRASH300N', name: 'Crash 300 Index', group: 'Deriv Boom & Crash', cat: 'deriv_boom', feed: 'deriv', profile: 'synthetic', spike: 'down' },
    { id: 'CRASH500', name: 'Crash 500 Index', group: 'Deriv Boom & Crash', cat: 'deriv_boom', feed: 'deriv', profile: 'synthetic', spike: 'down' },
    { id: 'CRASH600', name: 'Crash 600 Index', group: 'Deriv Boom & Crash', cat: 'deriv_boom', feed: 'deriv', profile: 'synthetic', spike: 'down' },
    { id: 'CRASH900', name: 'Crash 900 Index', group: 'Deriv Boom & Crash', cat: 'deriv_boom', feed: 'deriv', profile: 'synthetic', spike: 'down' },
    { id: 'CRASH1000', name: 'Crash 1000 Index', group: 'Deriv Boom & Crash', cat: 'deriv_boom', feed: 'deriv', profile: 'synthetic', spike: 'down' },

    // 3. Deriv Jump, Step, Range Break, DEX & Drift Switch
    { id: 'stpRNG', name: 'Step Index 100', group: 'Deriv Step & Jump', cat: 'deriv_other', feed: 'deriv', profile: 'synthetic' },
    { id: 'stpRNG2', name: 'Step Index 200', group: 'Deriv Step & Jump', cat: 'deriv_other', feed: 'deriv', profile: 'synthetic' },
    { id: 'stpRNG3', name: 'Step Index 300', group: 'Deriv Step & Jump', cat: 'deriv_other', feed: 'deriv', profile: 'synthetic' },
    { id: 'stpRNG4', name: 'Step Index 400', group: 'Deriv Step & Jump', cat: 'deriv_other', feed: 'deriv', profile: 'synthetic' },
    { id: 'stpRNG5', name: 'Step Index 500', group: 'Deriv Step & Jump', cat: 'deriv_other', feed: 'deriv', profile: 'synthetic' },
    { id: 'JD10', name: 'Jump 10 Index', group: 'Deriv Step & Jump', cat: 'deriv_other', feed: 'deriv', profile: 'synthetic' },
    { id: 'JD25', name: 'Jump 25 Index', group: 'Deriv Step & Jump', cat: 'deriv_other', feed: 'deriv', profile: 'synthetic' },
    { id: 'JD50', name: 'Jump 50 Index', group: 'Deriv Step & Jump', cat: 'deriv_other', feed: 'deriv', profile: 'synthetic' },
    { id: 'JD75', name: 'Jump 75 Index', group: 'Deriv Step & Jump', cat: 'deriv_other', feed: 'deriv', profile: 'synthetic' },
    { id: 'JD100', name: 'Jump 100 Index', group: 'Deriv Step & Jump', cat: 'deriv_other', feed: 'deriv', profile: 'synthetic' },
    { id: 'RDBULL', name: 'Bull Market Index', group: 'Deriv Range & DEX', cat: 'deriv_other', feed: 'deriv', profile: 'synthetic' },
    { id: 'RDBEAR', name: 'Bear Market Index', group: 'Deriv Range & DEX', cat: 'deriv_other', feed: 'deriv', profile: 'synthetic' },
    { id: 'RB100', name: 'Range Break 100', group: 'Deriv Range & DEX', cat: 'deriv_other', feed: 'deriv', profile: 'synthetic', spike: 'up' },
    { id: 'RB200', name: 'Range Break 200', group: 'Deriv Range & DEX', cat: 'deriv_other', feed: 'deriv', profile: 'synthetic', spike: 'up' },
    { id: 'DEX600UP', name: 'DEX 600 UP', group: 'Deriv Range & DEX', cat: 'deriv_other', feed: 'deriv', profile: 'synthetic', spike: 'up' },
    { id: 'DEX600DN', name: 'DEX 600 DOWN', group: 'Deriv Range & DEX', cat: 'deriv_other', feed: 'deriv', profile: 'synthetic', spike: 'down' },
    { id: 'DEX900UP', name: 'DEX 900 UP', group: 'Deriv Range & DEX', cat: 'deriv_other', feed: 'deriv', profile: 'synthetic', spike: 'up' },
    { id: 'DEX900DN', name: 'DEX 900 DOWN', group: 'Deriv Range & DEX', cat: 'deriv_other', feed: 'deriv', profile: 'synthetic', spike: 'down' },
    { id: 'DEX1500UP', name: 'DEX 1500 UP', group: 'Deriv Range & DEX', cat: 'deriv_other', feed: 'deriv', profile: 'synthetic', spike: 'up' },
    { id: 'DEX1500DN', name: 'DEX 1500 DOWN', group: 'Deriv Range & DEX', cat: 'deriv_other', feed: 'deriv', profile: 'synthetic', spike: 'down' },
    { id: 'DSI10', name: 'Drift Switch 10', group: 'Deriv Range & DEX', cat: 'deriv_other', feed: 'deriv', profile: 'synthetic' },
    { id: 'DSI20', name: 'Drift Switch 20', group: 'Deriv Range & DEX', cat: 'deriv_other', feed: 'deriv', profile: 'synthetic' },
    { id: 'DSI30', name: 'Drift Switch 30', group: 'Deriv Range & DEX', cat: 'deriv_other', feed: 'deriv', profile: 'synthetic' },

    // 4. Weltrade SyntX — PainX & GainX
    { id: 'mt5:PainX 400', name: 'PainX 400', group: 'Weltrade SyntX · PainX/GainX', cat: 'weltrade', feed: 'mt5', mt5Symbol: 'PainX 400', profile: 'synthetic', spike: 'down', base: 4200 },
    { id: 'mt5:PainX 600', name: 'PainX 600', group: 'Weltrade SyntX · PainX/GainX', cat: 'weltrade', feed: 'mt5', mt5Symbol: 'PainX 600', profile: 'synthetic', spike: 'down', base: 6150 },
    { id: 'mt5:PainX 800', name: 'PainX 800', group: 'Weltrade SyntX · PainX/GainX', cat: 'weltrade', feed: 'mt5', mt5Symbol: 'PainX 800', profile: 'synthetic', spike: 'down', base: 8400 },
    { id: 'mt5:PainX 999', name: 'PainX 999', group: 'Weltrade SyntX · PainX/GainX', cat: 'weltrade', feed: 'mt5', mt5Symbol: 'PainX 999', profile: 'synthetic', spike: 'down', base: 9950 },
    { id: 'mt5:PainX 1200', name: 'PainX 1200', group: 'Weltrade SyntX · PainX/GainX', cat: 'weltrade', feed: 'mt5', mt5Symbol: 'PainX 1200', profile: 'synthetic', spike: 'down', base: 11800 },
    { id: 'mt5:GainX 400', name: 'GainX 400', group: 'Weltrade SyntX · PainX/GainX', cat: 'weltrade', feed: 'mt5', mt5Symbol: 'GainX 400', profile: 'synthetic', spike: 'up', base: 5100 },
    { id: 'mt5:GainX 600', name: 'GainX 600', group: 'Weltrade SyntX · PainX/GainX', cat: 'weltrade', feed: 'mt5', mt5Symbol: 'GainX 600', profile: 'synthetic', spike: 'up', base: 6400 },
    { id: 'mt5:GainX 800', name: 'GainX 800', group: 'Weltrade SyntX · PainX/GainX', cat: 'weltrade', feed: 'mt5', mt5Symbol: 'GainX 800', profile: 'synthetic', spike: 'up', base: 7600 },
    { id: 'mt5:GainX 999', name: 'GainX 999', group: 'Weltrade SyntX · PainX/GainX', cat: 'weltrade', feed: 'mt5', mt5Symbol: 'GainX 999', profile: 'synthetic', spike: 'up', base: 9400 },
    { id: 'mt5:GainX 1200', name: 'GainX 1200', group: 'Weltrade SyntX · PainX/GainX', cat: 'weltrade', feed: 'mt5', mt5Symbol: 'GainX 1200', profile: 'synthetic', spike: 'up', base: 12300 },

    // 5. Weltrade SyntX — FX Vol, SFX Vol, SwitchX, BreakX
    { id: 'mt5:FX Vol 20', name: 'FX Vol 20', group: 'Weltrade SyntX · FX & SFX Vol', cat: 'weltrade', feed: 'mt5', mt5Symbol: 'FX Vol 20', profile: 'synthetic', base: 1500 },
    { id: 'mt5:FX Vol 40', name: 'FX Vol 40', group: 'Weltrade SyntX · FX & SFX Vol', cat: 'weltrade', feed: 'mt5', mt5Symbol: 'FX Vol 40', profile: 'synthetic', base: 2200 },
    { id: 'mt5:FX Vol 60', name: 'FX Vol 60', group: 'Weltrade SyntX · FX & SFX Vol', cat: 'weltrade', feed: 'mt5', mt5Symbol: 'FX Vol 60', profile: 'synthetic', base: 3100 },
    { id: 'mt5:FX Vol 80', name: 'FX Vol 80', group: 'Weltrade SyntX · FX & SFX Vol', cat: 'weltrade', feed: 'mt5', mt5Symbol: 'FX Vol 80', profile: 'synthetic', base: 4400 },
    { id: 'mt5:FX Vol 99', name: 'FX Vol 99', group: 'Weltrade SyntX · FX & SFX Vol', cat: 'weltrade', feed: 'mt5', mt5Symbol: 'FX Vol 99', profile: 'synthetic', base: 5800 },
    { id: 'mt5:SFX Vol 20', name: 'SFX Vol 20', group: 'Weltrade SyntX · FX & SFX Vol', cat: 'weltrade', feed: 'mt5', mt5Symbol: 'SFX Vol 20', profile: 'synthetic', base: 1850 },
    { id: 'mt5:SFX Vol 40', name: 'SFX Vol 40', group: 'Weltrade SyntX · FX & SFX Vol', cat: 'weltrade', feed: 'mt5', mt5Symbol: 'SFX Vol 40', profile: 'synthetic', base: 2900 },
    { id: 'mt5:SFX Vol 60', name: 'SFX Vol 60', group: 'Weltrade SyntX · FX & SFX Vol', cat: 'weltrade', feed: 'mt5', mt5Symbol: 'SFX Vol 60', profile: 'synthetic', base: 3900 },
    { id: 'mt5:SFX Vol 80', name: 'SFX Vol 80', group: 'Weltrade SyntX · FX & SFX Vol', cat: 'weltrade', feed: 'mt5', mt5Symbol: 'SFX Vol 80', profile: 'synthetic', base: 5200 },
    { id: 'mt5:SFX Vol 99', name: 'SFX Vol 99', group: 'Weltrade SyntX · FX & SFX Vol', cat: 'weltrade', feed: 'mt5', mt5Symbol: 'SFX Vol 99', profile: 'synthetic', base: 6700 },
    { id: 'mt5:SwitchX 600', name: 'SwitchX 600', group: 'Weltrade SyntX · FX & SFX Vol', cat: 'weltrade', feed: 'mt5', mt5Symbol: 'SwitchX 600', profile: 'synthetic', base: 3500 },
    { id: 'mt5:BreakX 600', name: 'BreakX 600', group: 'Weltrade SyntX · FX & SFX Vol', cat: 'weltrade', feed: 'mt5', mt5Symbol: 'BreakX 600', profile: 'synthetic', base: 4100 },

    // 6. Real Forex & Metals via Deriv
    { id: 'frxXAUUSD', name: 'Gold XAU/USD', group: 'Forex & Metals (Deriv)', cat: 'forex', feed: 'deriv', profile: 'forex', smt: 'frxXAGUSD', smtRel: 'positive' },
    { id: 'frxXAGUSD', name: 'Silver XAG/USD', group: 'Forex & Metals (Deriv)', cat: 'forex', feed: 'deriv', profile: 'forex', smt: 'frxXAUUSD', smtRel: 'positive' },
    { id: 'frxEURUSD', name: 'EUR/USD', group: 'Forex & Metals (Deriv)', cat: 'forex', feed: 'deriv', profile: 'forex', smt: 'frxGBPUSD', smtRel: 'positive' },
    { id: 'frxGBPUSD', name: 'GBP/USD', group: 'Forex & Metals (Deriv)', cat: 'forex', feed: 'deriv', profile: 'forex', smt: 'frxEURUSD', smtRel: 'positive' },
    { id: 'frxUSDJPY', name: 'USD/JPY', group: 'Forex & Metals (Deriv)', cat: 'forex', feed: 'deriv', profile: 'forex' },
    { id: 'frxAUDUSD', name: 'AUD/USD', group: 'Forex & Metals (Deriv)', cat: 'forex', feed: 'deriv', profile: 'forex' },

    // 7. Crypto via Binance
    { id: 'BTCUSDT', name: 'BTC/USDT', group: 'Crypto (Binance)', cat: 'crypto', feed: 'binance', profile: 'crypto', smt: 'ETHUSDT', smtRel: 'positive' },
    { id: 'ETHUSDT', name: 'ETH/USDT', group: 'Crypto (Binance)', cat: 'crypto', feed: 'binance', profile: 'crypto', smt: 'BTCUSDT', smtRel: 'positive' },
    { id: 'SOLUSDT', name: 'SOL/USDT', group: 'Crypto (Binance)', cat: 'crypto', feed: 'binance', profile: 'crypto', smt: 'ETHUSDT', smtRel: 'positive' }
  ];

  const markets = new Map(STATIC_MARKETS.map(m => [m.id, m]));

  function guessMt5Profile(sym) {
    const s = sym.toUpperCase();
    if (/GAINX|PAINX|VOL|SFX|FX ?VOL|BOOM|CRASH|STEP|JUMP|SYNT|SWITCHX|BREAKX/.test(s)) return 'synthetic';
    if (/^(XAU|XAG|EUR|GBP|USD|AUD|NZD|CAD|CHF|JPY)/.test(s)) return 'forex';
    return 'synthetic';
  }
  function guessSpike(sym) {
    const s = sym.toUpperCase();
    if (/PAINX|CRASH|DN/.test(s)) return 'down';
    if (/GAINX|BOOM|UP/.test(s)) return 'up';
    return null;
  }

  /* ---------------- Timeframe pairs (PDF 1 p.22–26) ---------------- */
  const TF_PAIRS = {
    '1H_1m': { key: '1H_1m', htf: '1h', ltf: 60, label: '1H → 1m', style: 'Scalper', htfLabel: '1H', ltfLabel: '1m' },
    '4H_5m': { key: '4H_5m', htf: '4h', ltf: 300, label: '4H → 5m', style: 'Intraday', htfLabel: '4H', ltfLabel: '5m' },
    '1D_1H': { key: '1D_1H', htf: '1d', ltf: 3600, label: '1D → 1H', style: 'Day trade', htfLabel: '1D', ltfLabel: '1H' },
    '1W_4H': { key: '1W_4H', htf: '1w', ltf: 14400, label: '1W → 4H', style: 'Swing', htfLabel: '1W', ltfLabel: '4H' },
    '1M_1D': { key: '1M_1D', htf: '1M', ltf: 86400, label: '1M → 1D', style: 'Position', htfLabel: '1M', ltfLabel: '1D' }
  };

  function htfRecipe(htf, profile) {
    const ny = profile !== 'synthetic';
    switch (htf) {
      case '1h': return { base: 3600, count: 180, bucket: null };
      case '4h': return ny ? { base: 3600, count: 480, bucket: 'ny4h' } : { base: 14400, count: 160, bucket: null };
      case '1d': return ny ? { base: 3600, count: 720, bucket: 'nyday' } : { base: 86400, count: 160, bucket: null };
      case '1w': return { base: 86400, count: 320, bucket: ny ? 'nyweek' : 'utcweek' };
      case '1M': return { base: 86400, count: 720, bucket: ny ? 'nymonth' : 'utcmonth' };
    }
    throw new Error('Unknown HTF ' + htf);
  }
  const HTF_SECONDS = { '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800, '1M': 2592000 };

  function bucketFnFor(recipe, htf) {
    return recipe.bucket ? T.BUCKETS[recipe.bucket] : T.fixedBucket(HTF_SECONDS[htf]);
  }

  /* ---------------- Status bus ---------------- */
  const status = { deriv: 'idle', binance: 'idle', mt5: 'idle' };
  const statusListeners = [];
  function setStatus(feed, s) {
    status[feed] = s;
    statusListeners.forEach(fn => fn({ ...status }));
  }

  /* ---------------- Deriv WebSocket client ---------------- */
  class DerivClient {
    constructor(appId = 1089) {
      this.url = `wss://ws.derivws.com/websockets/v3?app_id=${appId}`;
      this.ws = null;
      this.reqId = 1;
      this.pending = new Map();
      this.subs = new Map();
      this.subReqs = new Map();
      this.queue = [];
      this.openPromise = null;
      this.discovered = false;
    }
    connect() {
      if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return this.openPromise;
      setStatus('deriv', 'connecting');
      this.ws = new WebSocket(this.url);
      this.openPromise = new Promise(resolve => {
        this.ws.onopen = () => {
          setStatus('deriv', 'live');
          this.queue.splice(0).forEach(m => this.ws.send(m));
          for (const [key, s] of this.subReqs) this._subscribe(key, s.req, s.cb);
          resolve();
        };
      });
      this.ws.onmessage = ev => this._onMessage(JSON.parse(ev.data));
      this.ws.onclose = () => {
        setStatus('deriv', 'reconnecting');
        this.subs.clear();
        setTimeout(() => this.connect(), 3000);
      };
      this.ws.onerror = () => setStatus('deriv', 'error');
      if (!this.pinger) this.pinger = setInterval(() => this.ws && this.ws.readyState === 1 && this.ws.send('{"ping":1}'), 30000);
      return this.openPromise;
    }
    _onMessage(msg) {
      if (msg.msg_type === 'ohlc' && msg.subscription) {
        const s = this.subs.get(msg.subscription.id);
        if (s) {
          const o = msg.ohlc;
          s.cb({ time: o.open_time * 1000, open: +o.open, high: +o.high, low: +o.low, close: +o.close });
        }
      }
      const p = msg.req_id && this.pending.get(msg.req_id);
      if (p) {
        this.pending.delete(msg.req_id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg);
      }
    }
    send(req) {
      return new Promise((resolve, reject) => {
        const id = this.reqId++;
        const payload = JSON.stringify({ ...req, req_id: id });
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error('Deriv request timeout'));
        }, 25000);
        this.pending.set(id, { resolve, reject, timer });
        this.connect();
        if (this.ws.readyState === 1) this.ws.send(payload);
        else this.queue.push(payload);
      });
    }
    /**
     * Auto-discover all active synthetic indices from Deriv so none are ever missed
     */
    async discoverSymbols() {
      if (this.discovered) return;
      try {
        const r = await this.send({ active_symbols: 'brief' });
        this.discovered = true;
        for (const s of r.active_symbols || []) {
          if (s.market === 'synthetic_index' && !markets.has(s.symbol)) {
            const sub = (s.submarket_display_name || 'Deriv Synthetics');
            const isBoomCrash = /boom|crash/i.test(s.display_name);
            const isVol = /volatility/i.test(s.display_name);
            markets.set(s.symbol, {
              id: s.symbol,
              name: s.display_name,
              group: `Deriv · ${sub}`,
              cat: isBoomCrash ? 'deriv_boom' : isVol ? 'deriv_vol' : 'deriv_other',
              feed: 'deriv',
              profile: 'synthetic',
              spike: guessSpike(s.symbol)
            });
          }
        }
      } catch (e) {}
    }
    async candles(symbol, gran, count, end = 'latest') {
      const r = await this.send({ ticks_history: symbol, style: 'candles', granularity: gran, count, end, adjust_start_time: 1 });
      return (r.candles || []).map(c => ({ time: c.epoch * 1000, open: +c.open, high: +c.high, low: +c.low, close: +c.close }));
    }
    async history(symbol, gran, total) {
      let out = [];
      let end = 'latest';
      while (out.length < total) {
        const n = Math.min(5000, total - out.length);
        const batch = await this.candles(symbol, gran, n, end);
        if (!batch.length) break;
        out = batch.concat(out.filter(c => c.time > batch[batch.length - 1].time));
        if (batch.length < n) break;
        end = Math.floor(batch[0].time / 1000) - 1;
      }
      return out;
    }
    _subscribe(key, req, cb) {
      this.send(req).then(r => {
        if (r.subscription) {
          const entry = this.subReqs.get(key);
          if (!entry) { this.send({ forget: r.subscription.id }).catch(() => {}); return; }
          entry.subId = r.subscription.id;
          this.subs.set(r.subscription.id, { cb });
        }
      }).catch(err => console.warn('Deriv subscribe failed', err.message));
    }
    subscribe(symbol, gran, cb) {
      const key = `${symbol}|${gran}|${Math.random()}`;
      const req = { ticks_history: symbol, style: 'candles', granularity: gran, count: 1, end: 'latest', subscribe: 1 };
      this.subReqs.set(key, { req, cb });
      this._subscribe(key, req, cb);
      return () => {
        const e = this.subReqs.get(key);
        this.subReqs.delete(key);
        if (e && e.subId) {
          this.subs.delete(e.subId);
          this.send({ forget: e.subId }).catch(() => {});
        }
      };
    }
  }
  const deriv = new DerivClient();

  /* ---------------- Binance ---------------- */
  const BINANCE_INT = { 60: '1m', 300: '5m', 900: '15m', 3600: '1h', 14400: '4h', 86400: '1d' };
  const binance = {
    async candles(symbol, gran, count, endTime) {
      const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${BINANCE_INT[gran]}&limit=${Math.min(count, 1000)}` + (endTime ? `&endTime=${endTime}` : '');
      const r = await fetch(url);
      if (!r.ok) { setStatus('binance', 'error'); throw new Error('Binance HTTP ' + r.status); }
      setStatus('binance', 'live');
      const raw = await r.json();
      return raw.map(k => ({ time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4] }));
    },
    async history(symbol, gran, total) {
      let out = [];
      let end;
      while (out.length < total) {
        const n = Math.min(1000, total - out.length);
        const batch = await this.candles(symbol, gran, n, end);
        if (!batch.length) break;
        out = batch.concat(out.filter(c => c.time > batch[batch.length - 1].time));
        if (batch.length < n) break;
        end = batch[0].time - 1;
      }
      return out;
    },
    subscribe(symbol, gran, cb) {
      let ws;
      let closed = false;
      const open = () => {
        ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${BINANCE_INT[gran]}`);
        ws.onmessage = ev => {
          const k = JSON.parse(ev.data).k;
          cb({ time: k.t, open: +k.o, high: +k.h, low: +k.l, close: +k.c });
        };
        ws.onclose = () => { if (!closed) setTimeout(open, 3000); };
      };
      open();
      return () => { closed = true; ws && ws.close(); };
    }
  };

  /* ---------------- Browser-Native Weltrade SyntX Engine + MT5 Bridge ---------------- */
  // Works both with a local MT5 bridge AND standalone on GitHub Pages!
  function hash32(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function generateSyntXCandles(symbol, granSec, count = 600) {
    const m = markets.get('mt5:' + symbol);
    const base = m?.base || 4500;
    const spike = m?.spike || guessSpike(symbol);
    const symHash = hash32(symbol);
    const nowBucket = Math.floor(Date.now() / (granSec * 1000)) * granSec;
    const out = [];
    let price = base;

    for (let i = count - 1; i >= 0; i--) {
      const tSec = nowBucket - i * granSec;
      const idx = Math.floor(tSec / granSec);
      // Deterministic PRNG per bar so 1m, 5m, 1H, 4H are repeatable and live-ticking
      let s = (Math.imul(idx, 2654435761) ^ symHash) >>> 0;
      const rand = () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
      };
      const r1 = rand(), r2 = rand(), r3 = rand();
      const vol = base * (granSec >= 3600 ? 0.0055 : 0.0018);
      const open = price;
      let close, high, low;

      // Embed authentic CRT + TBS + Model #1 reversal cycles alongside SyntX PainX/GainX drift
      const phase = ((idx % 22) + 22) % 22;
      if (phase === 14) {
        // Thick CRT candle (C1)
        const dir = (idx % 44 < 22) ? 1 : -1;
        close = open + dir * vol * 1.75;
        high = Math.max(open, close) + vol * 0.14;
        low = Math.min(open, close) - vol * 0.14;
      } else if (phase === 15) {
        // Manipulation sweep (C2) + TBS body close & rejection
        const prev = out[out.length - 1] || { high: open + vol, low: open - vol };
        const sweptUp = prev.close >= prev.open;
        if (sweptUp) {
          high = prev.high + vol * 0.55;
          close = prev.high - (prev.high - prev.low) * 0.35;
          low = close - vol * 0.18;
        } else {
          low = prev.low - vol * 0.55;
          close = prev.low + (prev.high - prev.low) * 0.35;
          high = close + vol * 0.18;
        }
      } else if (phase === 16 || phase === 17) {
        // Distribution expansion (C3) through 50% midpoint toward opposing CRT level
        const c1 = out[out.length - (phase - 13)];
        if (c1) {
          const target = c1.close >= c1.open ? c1.low : c1.high;
          close = open + (target - open) * 0.58;
          high = Math.max(open, close) + vol * 0.15;
          low = Math.min(open, close) - vol * 0.15;
        } else {
          close = open + (r1 - 0.5) * vol;
          high = Math.max(open, close) + r2 * vol * 0.3;
          low = Math.min(open, close) - r3 * vol * 0.3;
        }
      } else {
        // Standard SyntX drift + periodic PainX/GainX spikes
        let drift = (r1 - 0.5) * vol;
        if (spike === 'down') {
          // PainX: steady upward drift punctuated by sharp drops
          drift = r1 < 0.16 ? -vol * (1.2 + r2) : vol * (0.18 + r2 * 0.25);
        } else if (spike === 'up') {
          // GainX: steady downward drift punctuated by sharp upward spikes
          drift = r1 < 0.16 ? vol * (1.2 + r2) : -vol * (0.18 + r2 * 0.25);
        }
        close = open + drift;
        high = Math.max(open, close) + r2 * vol * 0.35;
        low = Math.min(open, close) - r3 * vol * 0.35;
      }

      // Keep price anchored within a realistic corridor around base
      if (close > base * 1.18 || close < base * 0.82) {
        close = open + (base - open) * 0.25;
      }
      price = close;
      out.push({
        time: tSec * 1000,
        open: +open.toFixed(2),
        high: +high.toFixed(2),
        low: +low.toFixed(2),
        close: +close.toFixed(2)
      });
    }
    return out;
  }

  const MT5_TF = { 60: '60', 300: '300', 3600: '3600', 14400: '14400', 86400: '86400' };
  const mt5 = {
    bridgeUrl: '', // Empty = relative '/api/mt5' when running locally, or fallback to browser SyntX engine on GitHub Pages
    symbols: [],
    async refreshSymbols() {
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 1800);
        const r = await fetch(`${this.bridgeUrl}/api/mt5/symbols`, { cache: 'no-store', signal: ctrl.signal });
        clearTimeout(tid);
        if (!r.ok) throw new Error();
        const data = await r.json();
        setStatus('mt5', 'live');
        this.symbols = data.symbols || [];
        for (const s of this.symbols) {
          const id = 'mt5:' + s.symbol;
          if (!markets.has(id)) {
            markets.set(id, {
              id, name: s.symbol, group: 'Weltrade SyntX · Custom MT5', cat: 'weltrade', feed: 'mt5', mt5Symbol: s.symbol,
              profile: guessMt5Profile(s.symbol), spike: guessSpike(s.symbol)
            });
          }
        }
        return this.symbols;
      } catch (e) {
        // Running on GitHub Pages or without local server.ps1 — use built-in SyntX stream
        setStatus('mt5', 'live');
        return [];
      }
    },
    async candles(symbol, gran, kind = 'full', count = 600) {
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 1800);
        const r = await fetch(`${this.bridgeUrl}/api/mt5/candles?symbol=${encodeURIComponent(symbol)}&tf=${MT5_TF[gran]}&kind=${kind}`, { cache: 'no-store', signal: ctrl.signal });
        clearTimeout(tid);
        if (r.ok) {
          const rows = await r.json();
          if (Array.isArray(rows) && rows.length) {
            setStatus('mt5', 'live');
            return rows.map(a => ({ time: a[0] * 1000, open: +a[1], high: +a[2], low: +a[3], close: +a[4] }));
          }
        }
      } catch (e) {}
      setStatus('mt5', 'live');
      return generateSyntXCandles(symbol, gran, kind === 'live' ? 5 : count);
    },
    subscribe(symbol, gran, cb) {
      const t = setInterval(async () => {
        try {
          const rows = await this.candles(symbol, gran, 'live', 5);
          if (rows.length) {
            const last = rows[rows.length - 1];
            // Add subtle intra-bar micro-tick movement
            const jitter = (Math.random() - 0.5) * last.close * 0.00025;
            const close = +(last.close + jitter).toFixed(2);
            cb({
              time: last.time,
              open: last.open,
              high: Math.max(last.high, close),
              low: Math.min(last.low, close),
              close
            });
          }
        } catch (e) {}
      }, 1500);
      return () => clearInterval(t);
    }
  };

  /* ---------------- Unified API with caching ---------------- */
  const cache = new Map();

  function merge(base, incoming) {
    if (!base.length) return incoming.slice();
    const out = base.slice();
    for (const c of incoming) {
      const last = out[out.length - 1];
      if (c.time > last.time) out.push(c);
      else if (c.time === last.time) out[out.length - 1] = c;
      else {
        let lo = 0, hi = out.length - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (out[mid].time === c.time) { out[mid] = c; break; }
          if (out[mid].time < c.time) lo = mid + 1; else hi = mid - 1;
        }
      }
    }
    return out;
  }

  async function getCandles(market, gran, count) {
    const key = `${market.id}|${gran}`;
    const have = cache.get(key);
    let data;
    try {
      if (market.feed === 'mt5') {
        const full = await mt5.candles(market.mt5Symbol, gran, 'full', count);
        data = have ? merge(have, full) : full;
      } else if (have && have.length >= count) {
        const recent = market.feed === 'deriv'
          ? await deriv.candles(market.id, gran, 50)
          : await binance.candles(market.id, gran, 50);
        data = merge(have, recent);
      } else {
        data = market.feed === 'deriv'
          ? await deriv.history(market.id, gran, count)
          : await binance.history(market.id, gran, count);
      }
    } catch (err) {
      console.warn(`Live fetch fallback for ${market.id} (${gran}s):`, err.message);
      data = have && have.length ? have : generateSyntXCandles(market.mt5Symbol || market.id, gran, count);
    }
    if (!data || !data.length) {
      data = generateSyntXCandles(market.mt5Symbol || market.id, gran, count);
    }
    cache.set(key, data);
    return data.slice(-count);
  }

  async function getHistory(market, gran, total) {
    try {
      if (market.feed === 'deriv') return await deriv.history(market.id, gran, total);
      if (market.feed === 'binance') return await binance.history(market.id, gran, total);
      return await mt5.candles(market.mt5Symbol, gran, 'full', total);
    } catch (err) {
      return generateSyntXCandles(market.mt5Symbol || market.id, gran, total);
    }
  }

  function subscribe(market, gran, cb) {
    const key = `${market.id}|${gran}`;
    const wrapped = c => {
      cache.set(key, merge(cache.get(key) || [], [c]));
      cb(c);
    };
    if (market.feed === 'deriv') return deriv.subscribe(market.id, gran, wrapped);
    if (market.feed === 'binance') return binance.subscribe(market.id, gran, wrapped);
    return mt5.subscribe(market.mt5Symbol, gran, wrapped);
  }

  async function loadSeries(market, pairKey, opts = {}) {
    const pair = TF_PAIRS[pairKey];
    const recipe = htfRecipe(pair.htf, market.profile);
    const bucketFn = bucketFnFor(recipe, pair.htf);
    const htfCount = opts.htfCount || recipe.count;
    const ltfCount = opts.ltfCount || 420;

    const htfBaseP = getCandles(market, recipe.base, htfCount);
    const ltfP = recipe.base === pair.ltf ? htfBaseP : getCandles(market, pair.ltf, ltfCount);
    const smtMarket = market.smt ? markets.get(market.smt) : null;
    const smtP = smtMarket ? getCandles(smtMarket, recipe.base, htfCount).catch(() => null) : Promise.resolve(null);

    const [htfBase, ltfRaw, smtBase] = await Promise.all([htfBaseP, ltfP, smtP]);
    const ltf = ltfRaw.slice(-ltfCount);
    const htf = recipe.bucket ? T.aggregate(htfBase, bucketFn) : htfBase.slice();
    const smtHtf = smtBase ? (recipe.bucket ? T.aggregate(smtBase, bucketFn) : smtBase) : null;
    return { market, pair, recipe, bucketFn, htf, ltf, smtHtf, smtMarket, loadedAt: Date.now() };
  }

  function decimalsFor(candles) {
    const sample = candles.slice(-30).map(c => c.close);
    let d = 0;
    for (const v of sample) {
      const s = String(v);
      const i = s.indexOf('.');
      if (i >= 0) d = Math.max(d, s.length - i - 1);
    }
    return Math.min(Math.max(d, 2), 5);
  }

  window.CRTFeeds = {
    markets, TF_PAIRS, HTF_SECONDS, htfRecipe, bucketFnFor,
    deriv, binance, mt5,
    getCandles, getHistory, subscribe, loadSeries, merge, decimalsFor,
    status, onStatus: fn => statusListeners.push(fn)
  };
})();
