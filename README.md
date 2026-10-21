# SmartBus TN

SmartBus TN is a real-time passenger occupancy monitoring and bus telemetry system with AI camera tracking (YOLO + ByteTrack), FastAPI WebSocket backend, SQLite persistence, and a high-legibility React dashboard.

## Lab deployment (single machine)

The lab machine serves the React app, the API, the WebSocket, the
MJPEG stream, and the SQLite database. No external services.

One-time setup:
    cd smartbus-dashboard && npm install && cd ..
    pip install -r requirements.txt

Start:
    ./start.sh          (Linux/macOS)
    start.bat           (Windows)

Open:
    http://<lab-ip>:8000/         — public dashboard (TV)
    http://<lab-ip>:8000/admin    — admin dashboard (laptop only)

Default PIN is set in the ADMIN_PIN environment variable (default 4821).
Override it before starting for the expo.

The database lives in ./smartbus.db next to main.py. Delete it for a
clean slate; the schema recreates on the next write.

---

## Architecture

- **Backend**: FastAPI (`main.py`) serving WebSocket telemetry (`/ws`), camera MJPEG stream (`/video`), admin REST endpoints (`/admin/*`), and the built frontend static assets (`/`).
- **Database**: SQLite WAL mode (`smartbus.db`) logging all board/alight/clamp/set/reset events.
- **Frontend**: React single-page app (`smartbus-dashboard/dist`) with two routes:
  - `/` — 55-inch 4K Public Display (occupancy gauge, journey animation, camera preview, status alert)
  - `/admin` — PIN-protected operator panel (mode toggle, manual override, reset, live telemetry, and recent event log)
