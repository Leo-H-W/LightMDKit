@echo off
chcp 65001 >nul

echo [md-view] Stopping background server...
taskkill /F /IM md-view.exe 2>nul
taskkill /F /IM node.exe 2>nul

echo [md-view] Stopped.
pause
