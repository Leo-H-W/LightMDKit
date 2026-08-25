#!/usr/bin/env bash

echo "[md-view] Stopping background server..."

pkill -f "md-view.exe" 2>/dev/null || true
pkill -f "node server.js" 2>/dev/null || true

echo "[md-view] Stopped."
