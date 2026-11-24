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

start "RenderX-Server" /min "%PY_BIN%" "%~dp0server.py"

timeout /t 2 /nobreak >nul

set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"
if exist "%CHROME_EXE%" (
    start "" "%CHROME_EXE%" --app=http://127.0.0.1:8899 --window-size=1440,900
) else (
    start "" "http://127.0.0.1:8899"
)

exit
