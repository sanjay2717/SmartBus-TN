@echo off
cd smartbus-dashboard
call npm run build
cd ..
uvicorn main:app --host 0.0.0.0 --port 8000
