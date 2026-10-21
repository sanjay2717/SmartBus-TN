#!/usr/bin/env bash
set -e
cd smartbus-dashboard && npm run build && cd ..
exec uvicorn main:app --host 0.0.0.0 --port 8000
