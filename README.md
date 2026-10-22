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

## Accessing from a second machine on the LAN

1. Find the server laptop's LAN IP:
   Windows: ipconfig   -> IPv4 Address, e.g. 192.168.1.42
   Linux/macOS: ifconfig | grep "inet "
2. Open port 8000 on the server laptop:
   Windows: netsh advfirewall firewall add rule ^
            name="SmartBus8000" dir=in action=allow ^
            protocol=TCP localport=8000
   Linux:   sudo ufw allow 8000/tcp
3. From the second machine:
   curl http://<lan-ip>:8000/admin/state -H "X-Admin-Pin: <pin>"
   Expected: JSON snapshot within 1 second. If it hangs, port
   8000 is blocked or the two machines are on different networks.
4. Set LAN_HOST=<lan-ip> in the server env so CORS allows the
   dev dashboard from the second machine.

*Note:* Verify manually from a second device on the LAN before the expo.

## Running the accuracy test with Nitish

Before the test, set on the server:
    export DOORS_EXPECTED=1
    export CAPACITY=20

Reason: capacity 20 ensures Nitish's 15 IN crossings are not
rejected as overflow. DOORS_EXPECTED=1 means only the entrance
heartbeat is required for ai_ok to be true.

Run the test, collect:
    - the paper tally sheet
    - the SQLite log:
        sqlite3 smartbus.db \
          "SELECT id, ts, type, door, occupancy FROM events \
           WHERE source='camera' ORDER BY id;"

Compute:
    IN accuracy  = correct_IN  / 15
    OUT accuracy = correct_OUT / 15
    Report the two numbers separately. Do NOT report the
    heartbeat "match" flag as accuracy — it is a loss detector,
    not an accuracy measure.

After the test, restore expo settings:
    export DOORS_EXPECTED=2
    export CAPACITY=10

---

## Architecture

- **Backend**: FastAPI (`main.py`) serving WebSocket telemetry (`/ws`), camera MJPEG stream (`/video`), admin REST endpoints (`/admin/*`), and the built frontend static assets (`/`).
- **Database**: SQLite WAL mode (`smartbus.db`) logging all board/alight/clamp/set/reset events.
- **Frontend**: React single-page app (`smartbus-dashboard/dist`) with two routes:
  - `/` — 55-inch 4K Public Display (occupancy gauge, journey animation, camera preview, status alert)
  - `/admin` — PIN-protected operator panel (mode toggle, manual override, reset, live telemetry, and recent event log)

