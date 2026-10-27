$port = 8090
$root = "C:\Users\Administrator\.gemini\antigravity\scratch\crt-tbs-terminal"
$ledgerFile = Join-Path $root "data\trades_ledger.json"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "CRT Desk Server running at http://localhost:$port/"

$mimeTypes = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".mq5"  = "text/plain; charset=utf-8"
}

$mt5Cache = @{}
$mt5Meta  = @{}
$commonBridgeDir = "C:\Users\Administrator\AppData\Roaming\MetaQuotes\Terminal\Common\Files\crt_bridge"
if (-not (Test-Path $commonBridgeDir)) {
  New-Item -ItemType Directory -Path $commonBridgeDir -Force | Out-Null
}

$aliasMap = @{
  "Volatility 75 Index" = "R_75"
  "Volatility 75 (1s) Index" = "1HZ75V"
  "Volatility 100 Index" = "R_100"
  "Volatility 100 (1s) Index" = "1HZ100V"
  "Volatility 50 Index" = "R_50"
  "Volatility 50 (1s) Index" = "1HZ50V"
  "Volatility 25 Index" = "R_25"
  "Volatility 25 (1s) Index" = "1HZ25V"
  "Volatility 10 Index" = "R_10"
  "Volatility 10 (1s) Index" = "1HZ10V"
  "Boom 1000 Index" = "BOOM1000"
  "Crash 1000 Index" = "CRASH1000"
  "Boom 500 Index" = "BOOM500"
  "Crash 500 Index" = "CRASH500"
  "Boom 300 Index" = "BOOM300N"
  "Crash 300 Index" = "CRASH300N"
  "Step Index" = "STP"
  "Jump 75 Index" = "JD75"
  "Jump 100 Index" = "JD100"
  "EURUSD" = "frxEURUSD"
  "GBPUSD" = "frxGBPUSD"
  "USDJPY" = "frxUSDJPY"
  "XAUUSD" = "frxXAUUSD"
}

# Build bidirectional lookup table
$allLookup = @{}
foreach ($k in $aliasMap.Keys) {
  $v = $aliasMap[$k]
  $safeK = $k -replace '[^A-Za-z0-9_-]', '_'
  $allLookup[$k] = @($k, $v, $safeK)
  $allLookup[$v] = @($v, $k, $safeK)
  $allLookup[$safeK] = @($safeK, $k, $v)
}

while ($listener.IsListening) {
  try {
    $context = $listener.GetContext()
    $req = $context.Request
    $res = $context.Response
    $res.Headers.Add("Access-Control-Allow-Origin", "*")
    $res.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    $res.Headers.Add("Access-Control-Allow-Headers", "Content-Type")
    $path = $req.Url.LocalPath

    if ($req.HttpMethod -eq "OPTIONS") {
      $res.StatusCode = 200
      $res.OutputStream.Close()
      continue
    }

    # Permanent Trade Ledger API (GET & POST)
    if ($path -eq "/api/ledger") {
      if ($req.HttpMethod -eq "POST") {
        $reader = New-Object System.IO.StreamReader($req.InputStream)
        $body = $reader.ReadToEnd()
        $reader.Close()
        if ($body -and $body.Length -gt 10) {
          $dir = Split-Path $ledgerFile -Parent
          if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
          [System.IO.File]::WriteAllText($ledgerFile, $body, [System.Text.Encoding]::UTF8)
          # Non-blocking background git commit & push so GitHub Pages always has the latest logged trades
          Start-Job -ScriptBlock {
            param($repoRoot)
            Set-Location $repoRoot
            git add data/trades_ledger.json 2>$null
            git commit -m "Auto-sync permanent Pure Trades ledger" 2>$null
            git push origin main 2>$null
          } -ArgumentList $root | Out-Null
        }
        $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"ok":true}')
        $res.ContentType = "application/json"
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
        $res.OutputStream.Close()
        continue
      } else {
        if (Test-Path $ledgerFile) {
          $bytes = [System.IO.File]::ReadAllBytes($ledgerFile)
        } else {
          $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"account":{"startingBalance":40,"riskPct":2.5},"trades":[]}')
        }
        $res.ContentType = "application/json; charset=utf-8"
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
        $res.OutputStream.Close()
        continue
      }
    }

    if ($path -eq "/api/mt5/push" -and $req.HttpMethod -eq "POST") {
      $sym = $req.QueryString["symbol"]
      $tf  = $req.QueryString["tf"]
      $reader = New-Object System.IO.StreamReader($req.InputStream)
      $body = $reader.ReadToEnd()
      $reader.Close()
      if ($sym -and $tf) {
        $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        $candidates = if ($allLookup.ContainsKey($sym)) { $allLookup[$sym] } else { @($sym) }
        foreach ($c in $candidates) {
          $mt5Cache["$c|$tf"] = $body
          $mt5Meta[$c] = @{ updated = $now }
        }
      }
      $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"ok":true}')
      $res.ContentType = "application/json"
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      $res.OutputStream.Close()
      continue
    }

    if ($path -eq "/api/mt5/symbols") {
      $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
      # Scan disk bridge for actively written files
      if (Test-Path $commonBridgeDir) {
        Get-ChildItem $commonBridgeDir -Filter "*_*.json" -ErrorAction SilentlyContinue | ForEach-Object {
          $baseName = $_.BaseName
          $idx = $baseName.LastIndexOf('_')
          if ($idx -gt 0) {
            $sName = $baseName.Substring(0, $idx)
            $mt5Meta[$sName] = @{ updated = [int][DateTimeOffset]::new($_.LastWriteTimeUtc).ToUnixTimeSeconds() }
            if ($allLookup.ContainsKey($sName)) {
              foreach ($alias in $allLookup[$sName]) {
                $mt5Meta[$alias] = @{ updated = [int][DateTimeOffset]::new($_.LastWriteTimeUtc).ToUnixTimeSeconds() }
              }
            }
          }
        }
      }

      $items = @()
      foreach ($k in $mt5Meta.Keys) {
        $u = $mt5Meta[$k].updated
        $items += ('{{"symbol":"{0}","updated":{1}}}' -f $k, $u)
      }
      $json = '{"symbols":[' + ($items -join ",") + ']}'
      $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
      $res.ContentType = "application/json"
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      $res.OutputStream.Close()
      continue
    }

    if ($path -eq "/api/mt5/candles") {
      $sym = $req.QueryString["symbol"]
      $tf  = [int]($req.QueryString["tf"] -as [int])
      if (-not $tf) { $tf = 300 }

      $candidates = if ($allLookup.ContainsKey($sym)) { $allLookup[$sym] } else { @($sym) }
      $json = "[]"

      # 1. Check memory cache
      foreach ($c in $candidates) {
        $key = "$c|$tf"
        if ($mt5Cache.ContainsKey($key)) {
          $json = $mt5Cache[$key]
          break
        }
      }

      # 2. Check disk file bridge if not in memory
      if ($json -eq "[]" -and (Test-Path $commonBridgeDir)) {
        foreach ($c in $candidates) {
          $safeC = $c -replace '[^A-Za-z0-9_-]', '_'
          $fPath = Join-Path $commonBridgeDir "${safeC}_${tf}.json"
          if (Test-Path $fPath) {
            try {
              $json = [System.IO.File]::ReadAllText($fPath, [System.Text.Encoding]::UTF8)
              $mt5Cache["$sym|$tf"] = $json
              break
            } catch {}
          }
        }
      }

      $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
      $res.ContentType = "application/json"
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      $res.OutputStream.Close()
      continue
    }

    if ($path -eq "/") { $path = "/index.html" }
    $filePath = Join-Path $root ($path.TrimStart('/').Replace('/', '\'))

    if (Test-Path $filePath -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($filePath)
      $res.ContentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { "application/octet-stream" }
      $bytes = [System.IO.File]::ReadAllBytes($filePath)
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $res.StatusCode = 404
    }
    $res.OutputStream.Close()
  } catch {
  }
}
