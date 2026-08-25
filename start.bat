@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo [md-view] Checking environment...

node --version >nul 2>&1
if errorlevel 1 (
    echo [md-view] ERROR: Node.js is not installed or not in PATH.
    echo [md-view] Please install Node.js first: https://nodejs.org/
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [md-view] node_modules not found, running npm install...
    call npm install
    if errorlevel 1 (
        echo [md-view] ERROR: npm install failed.
        pause
        exit /b 1
    )
)

echo [md-view] Starting server...
node server.js
