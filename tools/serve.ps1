# Local static server for checking DotPack (no install needed). Stop with Ctrl+C or close the window.
param([int]$Port = 8000, [string]$Open = "index.html")
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..")).TrimEnd('\') + '\'
$mime = @{
  ".html" = "text/html; charset=utf-8"; ".js" = "text/javascript; charset=utf-8"; ".css" = "text/css; charset=utf-8";
  ".json" = "application/json; charset=utf-8"; ".woff2" = "font/woff2"; ".png" = "image/png"; ".svg" = "image/svg+xml";
  ".md" = "text/plain; charset=utf-8"; ".rules" = "text/plain; charset=utf-8"; ".ico" = "image/x-icon"
}
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try { $listener.Start() } catch {
  Write-Host "Port $Port is in use. Close the other window or change PORT in the .bat file." -ForegroundColor Red
  Read-Host "Press Enter to exit"; exit 1
}
$url = "http://localhost:$Port/$Open"
Write-Host "Serving $root"
Write-Host "Open: $url"
Write-Host "Close this window to stop."
Start-Process $url
while ($listener.IsListening) {
  try { $ctx = $listener.GetContext() } catch { break }
  $res = $ctx.Response
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq "") { $rel = "index.html" }
    $full = [IO.Path]::GetFullPath((Join-Path $root $rel))
    if ($full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $full -PathType Leaf)) {
      $bytes = [IO.File]::ReadAllBytes($full)
      $ext = [IO.Path]::GetExtension($full).ToLower()
      $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { "application/octet-stream" }
      $res.Headers.Add("Cache-Control", "no-cache")
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else { $res.StatusCode = 404 }
  } catch { $res.StatusCode = 500 }
  finally { $res.Close() }
}
