@echo off
chcp 65001 >nul

echo [LightMDKit] Stopping background server...
taskkill /F /IM lightmdkit.exe 2>nul
taskkill /F /IM node.exe 2>nul

echo [LightMDKit] Stopped.
pause
