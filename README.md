# CRT Terminal — Unified CRT + TBS & CRT Unlocked Web System

Live institutional trading terminal combining **PDF 1 (*Candle Range Theory: CRT + TBS* by AR)** and **PDF 2 (*CRT Unlocked Q4 Lectures*)** into one unified multi-timeframe system.

## Key Features
- **All Deriv Synthetic Indices (Live WebSocket):**
  - Volatility 10, 25, 50, 75, 100 & 1s Volatility 10–250 (`1HZ10V`–`1HZ250V`)
  - Boom 300, 500, 600, 900, 1000 & Crash 300, 500, 600, 900, 1000
  - Step 100–500, Jump 10–100, Range Break 100/200, DEX 600/900/1500 UP & DOWN, Drift Switch 10/20/30
  - Plus automatic symbol discovery via Deriv's `active_symbols` API.
- **All Weltrade SyntX Pairs:**
  - `PainX 400, 600, 800, 999, 1200`
  - `GainX 400, 600, 800, 999, 1200`
  - `FX Vol 20, 40, 60, 80, 99` & `SFX Vol 20, 40, 60, 80, 99`
  - `SwitchX 600` & `BreakX 600`
  - Works out-of-the-box in the browser (including on GitHub Pages) AND connects to your local MetaTrader 5 terminal via `mt5/CRT_Bridge.mq5`.
- **Real Forex, Metals & Crypto:**
  - `XAU/USD`, `XAG/USD`, `EUR/USD`, `GBP/USD`, `USD/JPY`, `AUD/USD` (via Deriv)
  - `BTC/USDT`, `ETH/USDT`, `SOL/USDT` (via Binance Live WebSocket)
- **Central African Time (`CAT`, UTC+2) & NY-Aligned Candle Builder:**
  - All charts, tables, and session clocks run in **CAT** with automatic US Daylight-Saving Time adjustment (`America/New_York` ↔ `CAT`).
  - Builds NY-aligned 4H, Daily, Weekly, and Monthly candles for Forex/Crypto so HTF Candle 1 (Accumulation), Candle 2 (Manipulation), and Candle 3 (Distribution) match PDF 2's exact schedule.
- **Automated Chart Markings & Trade Execution Box:**
  - Draws `CRTH`, `50% Equilibrium (TP1 + Breakeven)`, `CRTL`, HTF Key Levels (`OB`, `FVG`, `OHP`, `OLP`), `TBS Body Close`, `A+ Inside Candles (2–6)`, `Model #1 Trigger`, `CRT OTE (50–79% Fib)`, `KOD Sweep`, and the full `Entry / Stop Loss / TP1 / TP2` box directly on TradingView Lightweight Charts.
- **Real Historical Backtester:**
  - Replays the exact causal strategy rules candle-by-candle over 10,000–40,000 real historical bars, comparing **With the 50% Rule + Breakeven** vs **Holding Full Size for TP2**.
