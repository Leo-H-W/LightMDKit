#!/usr/bin/env bash

echo "[LightMDKit] Stopping background server..."

pkill -f "lightmdkit.exe" 2>/dev/null || true
pkill -f "node server.js" 2>/dev/null || true

echo "[LightMDKit] Stopped."
