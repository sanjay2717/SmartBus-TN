#!/usr/bin/env bash
set -e

# ── Deployment profiles ──────────────────────────────
# EXPO (default): single-camera safe
# export DOORS_EXPECTED=1
# export CAPACITY=10
#
# ACCURACY TEST: both doors, room for 15 IN + 15 OUT
# export DOORS_EXPECTED=2
# export CAPACITY=20
#
# FULL DEMO (only after exit camera confirmed working):
# export DOORS_EXPECTED=2
# export CAPACITY=10
# ─────────────────────────────────────────────────────

export INGEST_KEY="${INGEST_KEY:-change-me}"
export DOORS_EXPECTED="${DOORS_EXPECTED:-1}"
export CAPACITY="${CAPACITY:-20}"

cd smartbus-dashboard && npm run build && cd ..
exec uvicorn main:app --host 0.0.0.0 --port 8000


