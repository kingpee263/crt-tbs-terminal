$port = 8090
$root = "C:\Users\Administrator\.gemini\antigravity\scratch\crt-tbs-terminal"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "CRT Terminal v2 running at http://localhost:$port/"

$mimeTypes = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".mq5"  = "text/plain; charset=utf-8"
}

$mt5Cache = @{}
$mt5Meta  = @{
  "PainX 400"  = @{ updated = 0; base = 4200.0; spike = "down" }
  "GainX 400"  = @{ updated = 0; base = 5100.0; spike = "up" }
  "PainX 800"  = @{ updated = 0; base = 8400.0; spike = "down" }
  "GainX 800"  = @{ updated = 0; base = 7600.0; spike = "up" }
  "FX Vol 20"  = @{ updated = 0; base = 1500.0; spike = "none" }
  "SFX Vol 40" = @{ updated = 0; base = 2900.0; spike = "none" }
}

function Get-SyntXSeries([string]$sym, [int]$tfSec, [int]$bars) {
  $nowSec = [int][Math]::Floor(([DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) / $tfSec) * $tfSec
  $info = if ($mt5Meta.ContainsKey($sym)) { $mt5Meta[$sym] } else { @{ base = 3000.0; spike = "none" } }
  $price = [double]$info.base
  $list = New-Object System.Collections.Generic.List[string]

  for ($i = $bars; $i -ge 0; $i--) {
    $t = $nowSec - ($i * $tfSec)
    $seed = [Math]::Abs(($t / $tfSec) * 2654435761 + $sym.GetHashCode()) % 10000
    $r1 = ($seed % 100) / 100.0
    $r2 = (($seed / 10) % 100) / 100.0
    $open = $price
    $vol = $info.base * 0.0022

    # Embed realistic CRT + TBS structures & SyntX drift/spike behavior
    $cycle = ($t / $tfSec) % 18
    if ($cycle -eq 12) {
      # Thick CRT candle
      $close = $open + $vol * 1.6
      $high  = $close + $vol * 0.12
      $low   = $open - $vol * 0.12
    } elseif ($cycle -eq 13) {
      # Manipulation sweep above CRTH then close back inside
      $high  = $open + $vol * 0.55
      $close = $open - $vol * 0.65
      $low   = $close - $vol * 0.15
    } else {
      $drift = if ($info.spike -eq "down") { ($r1 - 0.44) * $vol } elseif ($info.spike -eq "up") { ($r1 - 0.56) * $vol } else { ($r1 - 0.5) * $vol }
      $close = $open + $drift
      $high  = [Math]::Max($open, $close) + $r2 * $vol * 0.45
      $low   = [Math]::Min($open, $close) - (1.0 - $r2) * $vol * 0.45
    }

    $price = $close
    $list.Add(("[{0},{1:F2},{2:F2},{3:F2},{4:F2}]" -f $t, $open, $high, $low, $close))
  }
  return "[" + ($list -join ",") + "]"
}

while ($listener.IsListening) {
  try {
    $context = $listener.GetContext()
    $req = $context.Request
    $res = $context.Response
    $path = $req.Url.LocalPath

    if ($path -eq "/api/mt5/push" -and $req.HttpMethod -eq "POST") {
      $sym = $req.QueryString["symbol"]
      $tf  = $req.QueryString["tf"]
      $reader = New-Object System.IO.StreamReader($req.InputStream)
      $body = $reader.ReadToEnd()
      $reader.Close()
      if ($sym -and $tf) {
        $mt5Cache["$sym|$tf"] = $body
        $mt5Meta[$sym] = @{ updated = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds(); base = 1000.0; spike = "none" }
      }
      $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"ok":true}')
      $res.ContentType = "application/json"
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      $res.OutputStream.Close()
      continue
    }

    if ($path -eq "/api/mt5/symbols") {
      $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
      $items = @()
      foreach ($k in $mt5Meta.Keys) {
        $u = $mt5Meta[$k].updated
        if ($u -eq 0) { $u = $now }
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
      $kind = $req.QueryString["kind"]
      $key = "$sym|$tf"

      if ($mt5Cache.ContainsKey($key)) {
        $json = $mt5Cache[$key]
      } else {
        $bars = if ($kind -eq "live") { 3 } else { 520 }
        $json = Get-SyntXSeries -sym $sym -tfSec $tf -bars $bars
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
    # Ignore transient socket disconnects
  }
}
