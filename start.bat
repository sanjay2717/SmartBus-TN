@echo off

REM ── Deployment profiles ──────────────────────────────
REM EXPO (default): single-camera safe
REM set DOORS_EXPECTED=1
REM set CAPACITY=10
REM
REM ACCURACY TEST: both doors, room for 15 IN + 15 OUT
REM set DOORS_EXPECTED=2
REM set CAPACITY=20
REM
REM FULL DEMO (only after exit camera confirmed working):
REM set DOORS_EXPECTED=2
REM set CAPACITY=10
REM ─────────────────────────────────────────────────────

if "%INGEST_KEY%"=="" set INGEST_KEY=change-me
if "%DOORS_EXPECTED%"=="" set DOORS_EXPECTED=1
if "%CAPACITY%"=="" set CAPACITY=20

cd smartbus-dashboard
call npm run build
cd ..
uvicorn main:app --host 0.0.0.0 --port 8000


