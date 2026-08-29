@echo off
chcp 65001 >nul
cd /d "%~dp0"
python scripts\preview.py %*
echo.
if exist outputs\preview.mp4 start "" "outputs\preview.mp4"
pause
