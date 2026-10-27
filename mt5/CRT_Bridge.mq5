//+------------------------------------------------------------------+
//|                                                   CRT_Bridge.mq5 |
//|     Deriv MT5 & Weltrade Live Candle Bridge for CRT Terminal v2  |
//+------------------------------------------------------------------+
#property copyright "CRT Terminal v2"
#property version   "2.10"
#property strict

input string InpServerUrl = "http://localhost:8090/api/mt5/push"; // Local CRT Terminal URL (leave as default)
input string InpSymbols   = "Volatility 75 Index,Volatility 75 (1s) Index,Volatility 100 Index,Volatility 100 (1s) Index,Volatility 50 Index,Volatility 50 (1s) Index,Volatility 25 Index,Volatility 10 Index,Boom 1000 Index,Crash 1000 Index,Boom 500 Index,Crash 500 Index,Boom 300 Index,Crash 300 Index,Step Index,Jump 75 Index,PainX 400,GainX 400,EURUSD,GBPUSD,USDJPY,XAUUSD"; // Comma-separated symbols
input int    InpFullBars  = 600; // Historical bars on initial sync (500-1000)

bool g_initialSent = false;
datetime g_lastLog = 0;

int OnInit()
{
   EventSetTimer(2);
   Print("=================================================");
   Print("CRT_Bridge v2.10 started for account: ", AccountInfoInteger(ACCOUNT_LOGIN), " on ", AccountInfoString(ACCOUNT_SERVER));
   Print("Streaming symbols: ", InpSymbols);
   Print("Data exported to Common\\Files\\crt_bridge and ", InpServerUrl);
   Print("=================================================");
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Print("CRT_Bridge stopped.");
}

string SanitizeSym(string s)
{
   string out = "";
   int len = StringLen(s);
   for(int i = 0; i < len; i++)
   {
      ushort ch = StringGetCharacter(s, i);
      if((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_' || ch == '-')
         out += ShortToString(ch);
      else if(ch == ' ' || ch == '(' || ch == ')')
         out += "_";
   }
   return out;
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

   // Always include current chart symbol
   bool hasCurr = false;
   for(int s = 0; s < n; s++)
   {
      if(syms[s] == _Symbol) { hasCurr = true; break; }
   }
   if(!hasCurr)
   {
      ArrayResize(syms, n + 1);
      syms[n] = _Symbol;
      n++;
   }

   // Also include all open charts
   long chartId = ChartFirst();
   while(chartId >= 0)
   {
      string cs = ChartSymbol(chartId);
      if(StringLen(cs) > 0)
      {
         bool exists = false;
         for(int s = 0; s < n; s++)
         {
            if(syms[s] == cs) { exists = true; break; }
         }
         if(!exists)
         {
            ArrayResize(syms, n + 1);
            syms[n] = cs;
            n++;
         }
      }
      chartId = ChartNext(chartId);
   }

   ENUM_TIMEFRAMES tfs[5] = {PERIOD_M1, PERIOD_M5, PERIOD_H1, PERIOD_H4, PERIOD_D1};
   int tfSec[5]           = {60, 300, 3600, 14400, 86400};

   int count = g_initialSent ? 15 : InpFullBars;
   string kind = g_initialSent ? "live" : "full";

   int exportedCount = 0;

   for(int s = 0; s < n; s++)
   {
      string sym = syms[s];
      StringTrimLeft(sym);
      StringTrimRight(sym);
      if(StringLen(sym) == 0) continue;

      // Ensure symbol is selected in Market Watch
      if(!SymbolInfoInteger(sym, SYMBOL_SELECT))
         SymbolSelect(sym, true);

      // Check if symbol exists on broker
      double bid = SymbolInfoDouble(sym, SYMBOL_BID);
      if(bid <= 0 && !SymbolInfoInteger(sym, SYMBOL_VISIBLE))
         continue;

      for(int t = 0; t < 5; t++)
      {
         MqlRates rates[];
         ArraySetAsSeries(rates, false);
         int copied = CopyRates(sym, tfs[t], 0, count, rates);
         if(copied <= 0) continue;

         int dec = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
         if(dec < 0 || dec > 8) dec = 2;
         string fmt = "%I64d,%." + IntegerToString(dec) + "f,%." + IntegerToString(dec) + "f,%." + IntegerToString(dec) + "f,%." + IntegerToString(dec) + "f";

         string json = "[";
         for(int i = 0; i < copied; i++)
         {
            if(i > 0) json += ",";
            json += "[" + StringFormat(fmt,
               (long)rates[i].time,
               rates[i].open,
               rates[i].high,
               rates[i].low,
               rates[i].close) + "]";
         }
         json += "]";

         // 1. Direct File Bridge to Common\Files (Always works, no permissions needed)
         string safeSym = SanitizeSym(sym);
         string filePath = "crt_bridge\\" + safeSym + "_" + IntegerToString(tfSec[t]) + ".json";
         int fileHandle = FileOpen(filePath, FILE_WRITE | FILE_TXT | FILE_COMMON | FILE_SHARE_READ);
         if(fileHandle != INVALID_HANDLE)
         {
            FileWriteString(fileHandle, json);
            FileClose(fileHandle);
            exportedCount++;
         }

         // 2. HTTP POST WebRequest (Fast stream when WebRequest is permitted)
         if(StringLen(InpServerUrl) > 5)
         {
            string url = InpServerUrl + "?symbol=" + sym + "&tf=" + IntegerToString(tfSec[t]) + "&kind=" + kind;
            char post[], result[];
            string headers = "Content-Type: application/json\r\n";
            StringToCharArray(json, post, 0, StringLen(json));
            string resHeaders;
            WebRequest("POST", url, headers, 800, post, result, resHeaders);
         }
      }
   }

   if(TimeCurrent() - g_lastLog > 30)
   {
      g_lastLog = TimeCurrent();
      Print("CRT_Bridge: Active sync for ", n, " symbols (", exportedCount, " series updated). Account=", AccountInfoInteger(ACCOUNT_LOGIN));
   }

   g_initialSent = true;
}
//+------------------------------------------------------------------+
