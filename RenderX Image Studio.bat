@echo off
cd /d "%~dp0"

set "PYW_BIN=C:\Users\Raselur Rahman\Desktop\SaaS Tools\Render X Studio pro\bin\python\pythonw.exe"
if not exist "%PYW_BIN%" (
    set "PYW_BIN=pythonw"
)

start "" "%PYW_BIN%" "%~dp0launch_studio.pyw"
exit
