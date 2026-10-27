# CRT Terminal — Unified CRT + TBS & CRT Unlocked Web System

Live institutional trading terminal combining **PDF 1 (*Candle Range Theory: CRT + TBS* by AR)** and **PDF 2 (*CRT Unlocked Q4 Lectures*)** into one unified multi-timeframe system.

Live deployment: [https://kingpee263.github.io/crt-tbs-terminal/](https://kingpee263.github.io/crt-tbs-terminal/)

## Key Features
- **Real Market Quotes & Calibrated Baselines:**
  - Price levels directly match official broker charts: Deriv Volatility 75 / 1s (`~33,220`), Boom 1000 (`~13,420`), Crash 1000 (`~11,250`), Weltrade PainX 400 (`~4,180`), Gold (`~$2,732`), and Bitcoin.
- **Dual Engine View (Strategy Desk ⇋ Live Broker Chart):**
  - **Strategy Desk:** Dual-pane HTF/LTF institutional TradingView Lightweight Charts with automated CRT range markings (CRTH, 50% EQ, CRTL), Key Levels (OB, FVG, OHP, OLP), TBS execution arrows, live candle countdown timers, and visual Blue/Red position boxes.
  - **Live Broker Chart:** Direct in-terminal integration with official broker charting engines:
    - Deriv Synthetics via `https://charts.deriv.com:8443/deriv?instrument={symbol}&theme=dark`
    - Weltrade SyntX via `https://weltradecharts.com/chart?lang=en&theme=dark`
    - Crypto & Forex via TradingView Advanced Real-Time Charts
    - One-click "Open Full Official Window ↗" direct launch button.
- **All Deriv Synthetic Indices:**
  - Volatility 10, 25, 50, 75, 100 & 1s Volatility 10–250 (`1HZ10V`–`1HZ250V`)
  - Boom 300, 500, 600, 900, 1000 & Crash 300, 500, 600, 900, 1000
  - Step 100–500, Jump 10–100, Range Break 100/200, DEX 600/900/1500 UP & DOWN, Drift Switch 10/20/30
- **All Weltrade SyntX Pairs:**
  - `PainX 400, 600, 800, 999, 1200`
  - `GainX 400, 600, 800, 999, 1200`
  - `FX Vol 20, 40, 60, 80, 99` & `SFX Vol 20, 40, 60, 80, 99`
  - `SwitchX 600` & `BreakX 600`
- **Pure Trades Signal Filter & Permanent Ledger:**
  - Strict 6-gate confluence engine (HTF Purge + HTF Key Level + 2–6 LTF Inside Bars + Body Close TBS + RR >= 1.20 to 50% EQ + Machine Learning Probability >= 70%).
  - Permanent verified trades ledger (`data/trades_ledger.json`) tracking win rate, weekly growth targets, and account balance progression starting from $40.00.
- **$40 Account Institutional Risk Manager:**
  - Enforces strict 2.5% max risk per trade with auto-calculated lot sizing, dynamic weekly pacing, and drawdown locks to prevent overtrading.
- **Central African Time (`CAT`, UTC+2) & Live Candle Countdown Timers:**
  - Real-time countdown clocks display exact minutes and seconds remaining until HTF and LTF candles close.
