@echo off
title RenderX Image Studio PRO (Desktop Cluster Server)
cd /d "%~dp0"

set "PY_BIN=C:\Users\Raselur Rahman\Desktop\SaaS Tools\Render X Studio pro\bin\python\python.exe"
if not exist "%PY_BIN%" (
    set "PY_BIN=python"
)

echo ============================================================
echo   RenderX Image Studio PRO - 8-Profile Desktop Cluster
echo   Starting local backend on http://127.0.0.1:8899 ...
echo ============================================================

powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort 8899 -State Listen -ErrorAction SilentlyContinue; if (-not $c) { Start-Process -FilePath '%PY_BIN%' -ArgumentList '\"%~dp0server.py\"' -WorkingDirectory '%~dp0' -WindowStyle Minimized }"

powershell -NoProfile -Command "for ($i=0; $i -lt 25; $i++) { try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8899/api/status' -UseBasicParsing -TimeoutSec 1; if ($r.StatusCode -eq 200) { break } } catch {}; Start-Sleep -Milliseconds 300 }"

set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"
if exist "%CHROME_EXE%" (
    start "" "%CHROME_EXE%" --app=http://127.0.0.1:8899 --window-size=1440,900
) else (
    start "" "http://127.0.0.1:8899"
)

exit
