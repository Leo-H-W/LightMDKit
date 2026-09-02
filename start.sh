#!/usr/bin/env bash
set -e

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[LightMDKit] Checking environment..."

if ! command -v node >/dev/null 2>&1; then
    echo "[LightMDKit] ERROR: Node.js is not installed or not in PATH."
    echo "[LightMDKit] Please install Node.js first: https://nodejs.org/"
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo "[LightMDKit] node_modules not found, running npm install..."
    npm install
fi

echo "[LightMDKit] Starting server..."
node server.js
