@echo off
rem Starts the lesson player for editing: stops any dev server this repo left running (a stale one keeps serving
rem old copies of changed files), then runs `npm run dev`, which exports the vault, serves the player and re-exports
rem on every save in Obsidian. The browser opens once the server answers. Close this window or press Ctrl+C to stop.
setlocal
cd /d "%~dp0"
title MQE lessons - dev server

echo Stopping old dev servers for this repo...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'mqe-lessons' -and $_.CommandLine -match 'vite|dev\.mjs' -and $_.ProcessId -ne $PID } | ForEach-Object { Write-Host ('  stopped ' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

rem Opens the player when it is up (the first export takes a few seconds); gives up after two minutes.
start "" /min powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "for ($i = 0; $i -lt 120; $i++) { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:5173/ | Out-Null; Start-Process http://localhost:5173/; break } catch { Start-Sleep -Seconds 1 } }"

call npm run dev
echo.
echo The dev server stopped.
pause
