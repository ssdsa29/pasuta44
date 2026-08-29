@echo off
chcp 65001 >nul
cd /d "%~dp0"
python scripts\service.py status & echo. & python scripts\status.py
echo.
pause
