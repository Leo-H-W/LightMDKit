#!/usr/bin/env bash
set -e

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[md-view] Checking environment..."

if ! command -v node >/dev/null 2>&1; then
    echo "[md-view] ERROR: Node.js is not installed or not in PATH."
    echo "[md-view] Please install Node.js first: https://nodejs.org/"
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo "[md-view] node_modules not found, running npm install..."
    npm install
fi

echo "[md-view] Starting server..."
node server.js
