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
        $mt5Cache["$sym|$tf"] = $body
        $mt5Meta[$sym] = @{ updated = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() }
      }
      $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"ok":true}')
      $res.ContentType = "application/json"
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      $res.OutputStream.Close()
      continue
    }

    if ($path -eq "/api/mt5/symbols") {
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
      $key = "$sym|$tf"

      if ($mt5Cache.ContainsKey($key)) {
        $json = $mt5Cache[$key]
      } else {
        $json = "[]"
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
