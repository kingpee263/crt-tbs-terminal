//+------------------------------------------------------------------+
//|                                                   CRT_Bridge.mq5 |
//|     Weltrade SyntX / MT5 Live Candle Bridge for CRT Terminal v2  |
//+------------------------------------------------------------------+
#property copyright "CRT Terminal v2"
#property version   "2.00"
#property strict

input string InpServerUrl = "http://localhost:8090/api/mt5/push"; // Local CRT Terminal URL
input string InpSymbols   = "PainX 400,GainX 400,PainX 800,GainX 800,FX Vol 20,SFX Vol 40"; // Comma-separated symbols (leave empty for current chart symbol)
input int    InpFullBars  = 600; // Historical bars on initial sync

bool g_initialSent = false;

int OnInit()
{
   EventSetTimer(2);
   Print("CRT_Bridge initialized. Add ", InpServerUrl, " to Tools -> Options -> Expert Advisors -> Allow WebRequest.");
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   string syms[];
   int n = StringSplit(InpSymbols, ',', syms);
   if(n <= 0)
   {
      ArrayResize(syms, 1);
      syms[0] = _Symbol;
      n = 1;
   }

   ENUM_TIMEFRAMES tfs[5] = {PERIOD_M1, PERIOD_M5, PERIOD_H1, PERIOD_H4, PERIOD_D1};
   int tfSec[5]           = {60, 300, 3600, 14400, 86400};

   int count = g_initialSent ? 5 : InpFullBars;
   string kind = g_initialSent ? "live" : "full";

   for(int s = 0; s < n; s++)
   {
      string sym = syms[s];
      StringTrimLeft(sym);
      StringTrimRight(sym);
      if(StringLen(sym) == 0) continue;
      SymbolSelect(sym, true);

      for(int t = 0; t < 5; t++)
      {
         MqlRates rates[];
         int copied = CopyRates(sym, tfs[t], 0, count, rates);
         if(copied <= 0) continue;

         string json = "[";
         for(int i = 0; i < copied; i++)
         {
            if(i > 0) json += ",";
            json += StringFormat("[%I64d,%.5f,%.5f,%.5f,%.5f]",
               (long)rates[i].time,
               rates[i].open,
               rates[i].high,
               rates[i].low,
               rates[i].close);
         }
         json += "]";

         string url = InpServerUrl + "?symbol=" + sym + "&tf=" + IntegerToString(tfSec[t]) + "&kind=" + kind;
         char post[], result[];
         string headers = "Content-Type: application/json\r\n";
         StringToCharArray(json, post, 0, StringLen(json));
         string resHeaders;
         WebRequest("POST", url, headers, 1500, post, result, resHeaders);
      }
   }
   g_initialSent = true;
}
//+------------------------------------------------------------------+
