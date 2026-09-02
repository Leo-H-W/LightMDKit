@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo [LightMDKit] Checking environment...

node --version >nul 2>&1
if errorlevel 1 (
    echo [LightMDKit] ERROR: Node.js is not installed or not in PATH.
    echo [LightMDKit] Please install Node.js first: https://nodejs.org/
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [LightMDKit] node_modules not found, running npm install...
    call npm install
    if errorlevel 1 (
        echo [LightMDKit] ERROR: npm install failed.
        pause
        exit /b 1
    )
)

echo [LightMDKit] Starting server...
node server.js
