@echo off
cd /d "%~dp0"

echo Iniciando Scriptorium...
start "" http://localhost:8000/

py -m http.server 8000 2>nul

if errorlevel 1 (
    python -m http.server 8000
)

pause