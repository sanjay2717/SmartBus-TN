import asyncio
import base64
import hmac
import json
import os
import sqlite3
import threading
import time
from typing import Optional, Set

from fastapi import FastAPI, Header, HTTPException, Request, Response, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

# ==============================================================================
# STEP 2 — Module-level state + event log (SQLite-backed)
# ==============================================================================

MODE: str = "ai"          # "ai" | "manual" | "paused"
SOURCE_LAST: str = "camera"      # "camera" | "manual"

# ---------------------------------------------------------------------------
# SQLite DB path — same directory as main.py
# ---------------------------------------------------------------------------
_DB_PATH: str = os.path.join(os.path.dirname(os.path.abspath(__file__)), "smartbus.db")
_JSON_PATH: str = os.path.join(os.path.dirname(os.path.abspath(__file__)), "event_log.json")

# Separate lock for DB writes (reads are concurrent-safe under WAL).
_db_lock = threading.Lock()


def _ensure_schema(conn: sqlite3.Connection) -> None:
    """Create tables and indexes if they don't exist."""
    conn.executescript(
        """
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=NORMAL;
        CREATE TABLE IF NOT EXISTS events (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          ts        REAL    NOT NULL,
          type      TEXT    NOT NULL,
          source    TEXT    NOT NULL,
          track_id  INTEGER,
          occupancy INTEGER NOT NULL,
          mode      TEXT    NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts);
        """
    )
    conn.commit()


def _open_db() -> sqlite3.Connection:
    """Open (or create) smartbus.db and ensure the schema exists."""
    conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
    _ensure_schema(conn)
    return conn


def _migrate_json_to_sqlite() -> None:
    """One-time migration: if smartbus.db is absent but event_log.json is
    present, import all rows into SQLite then rename the JSON file.
    """
    if os.path.exists(_DB_PATH):
        return  # DB already exists — nothing to migrate
    if not os.path.exists(_JSON_PATH):
        return  # Neither file present — fresh start

    try:
        with open(_JSON_PATH, "r", encoding="utf-8") as f:
            rows = json.load(f)
        if not isinstance(rows, list):
            rows = []
    except Exception:
        rows = []

    # Open DB (creates + schema) then bulk-insert
    tmp_conn = _open_db()
    with _db_lock:
        for row in rows:
            try:
                tmp_conn.execute(
                    "INSERT INTO events(ts,type,source,track_id,occupancy,mode)"
                    " VALUES (?,?,?,?,?,?)",
                    (
                        row.get("ts", time.time()),
                        row.get("type", "unknown"),
                        row.get("source", "manual"),
                        row.get("id"),           # old JSON used "id" for track_id
                        row.get("occupancy", 0),
                        row.get("mode", "ai"),   # old rows had no mode field
                    ),
                )
            except Exception:
                pass
        tmp_conn.commit()
    tmp_conn.close()

    # Rename so next restart doesn't re-migrate
    try:
        os.rename(_JSON_PATH, _JSON_PATH + ".migrated")
    except Exception:
        pass


# Run migration BEFORE opening the permanent connection
_migrate_json_to_sqlite()

# Permanent, module-level DB connection
_conn: sqlite3.Connection = _open_db()


def log_event(
    type: str,
    source: str,
    occupancy: int,
    mode: str,
    track_id: Optional[int] = None,
) -> None:
    """Insert one event row into SQLite.
    Recovers gracefully if the DB file was deleted at runtime.
    """
    _INSERT_SQL = (
        "INSERT INTO events(ts,type,source,track_id,occupancy,mode)"
        " VALUES (?,?,?,?,?,?)"
    )
    params = (time.time(), type, source, track_id, occupancy, mode)
    with _db_lock:
        try:
            _conn.execute(_INSERT_SQL, params)
            _conn.commit()
        except sqlite3.OperationalError:
            # DB file was deleted mid-run — recreate schema and retry once.
            _ensure_schema(_conn)
            try:
                _conn.execute(_INSERT_SQL, params)
                _conn.commit()
            except Exception:
                pass


def recent_events(limit: int = 20) -> list:
    """Return up to *limit* most-recent events, newest first."""
    try:
        rows = _conn.execute(
            "SELECT id,ts,type,source,track_id,occupancy,mode"
            " FROM events ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    except sqlite3.OperationalError:
        _ensure_schema(_conn)
        return []
    return [
        dict(zip(("id", "ts", "type", "source", "track_id", "occupancy", "mode"), r))
        for r in rows
    ]

DEFAULT_CAPACITY: int = 10
capacity: int = int(os.getenv("BUS_CAPACITY", DEFAULT_CAPACITY))
boarded: int = 0
alighted: int = 0
occupancy: int = 0

ADMIN_PIN: str = os.getenv("ADMIN_PIN", "4821")

# Thread lock for state modifications
state_lock = threading.Lock()

# Active WebSocket connections
active_connections: Set[WebSocket] = set()

# Reference to the main asyncio event loop for thread-safe broadcasts
main_loop: Optional[asyncio.AbstractEventLoop] = None


def compute_status(occ: int, cap: int) -> str:
    """Calculates status based on occupancy and capacity:
    >capacity -> OVERFLOW (checked FIRST)
    >=80%    -> RED
    >=50%    -> YELLOW
    else     -> GREEN
    """
    if occ > cap:
        return "OVERFLOW"
    pct = round((occ / cap) * 100) if cap > 0 else 0
    if pct >= 80:
        return "RED"
    if pct >= 50:
        return "YELLOW"
    return "GREEN"


# ==============================================================================
# Camera & Tracker Loop (YOLO + ByteTrack with fallback simulation)
# ==============================================================================

# Minimal 1x1 blank JPEG bytes for fallback video streaming when cv2 is not present
TINY_JPEG_BYTES = base64.b64decode(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="
)


class TrackerEngine:
    def __init__(self):
        self.camera_ok: bool = True
        self.model_loaded: bool = True
        self.tracker_alive: bool = False
        self.fps: float = 0.0
        self.active_tracks: int = 0
        self.current_frame_bytes: bytes = TINY_JPEG_BYTES
        self._running: bool = False
        self._thread: Optional[threading.Thread] = None

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=1.0)
        self.tracker_alive = False
        self.fps = 0.0
        self.active_tracks = 0

    def _run_loop(self):
        self.tracker_alive = True
        prev_time = time.time()

        # Try importing OpenCV and Ultralytics if available
        cv2 = None
        yolo_model = None
        cap = None
        try:
            import cv2 as _cv2
            from ultralytics import YOLO as _YOLO

            cv2 = _cv2
            cam_idx = int(os.getenv("CAMERA_INDEX", "0"))
            cap = cv2.VideoCapture(cam_idx)
            if cap.isOpened():
                yolo_model = _YOLO(os.getenv("YOLO_MODEL", "yolov8n.pt"))
                self.camera_ok = True
                self.model_loaded = True
            else:
                self.camera_ok = False
        except Exception:
            # When OpenCV/YOLO/Webcam are not present in dev, maintain simulated loop
            pass

        track_history = {}
        last_sim_step = time.time()

        while self._running:
            start_loop = time.time()

            if cap is not None and cap.isOpened() and yolo_model is not None:
                ret, frame = cap.read()
                if not ret:
                    self.camera_ok = False
                else:
                    self.camera_ok = True
                    results = yolo_model.track(
                        frame, persist=True, tracker="bytetrack.yaml", classes=[0], verbose=False
                    )
                    tracks_count = 0
                    if results and results[0].boxes and results[0].boxes.id is not None:
                        boxes = results[0].boxes.xyxy.cpu().numpy()
                        ids = results[0].boxes.id.int().cpu().tolist()
                        tracks_count = len(ids)

                        # Virtual tripwire counting logic at 50% frame height
                        door_line_y = frame.shape[0] // 2
                        for box, track_id in zip(boxes, ids):
                            cy = int((box[1] + box[3]) / 2)
                            if track_id in track_history:
                                prev_cy = track_history[track_id]
                                # Cross from top to bottom -> alight
                                if prev_cy < door_line_y <= cy:
                                    handle_camera_event(delta=-1, track_id=track_id)
                                # Cross from bottom to top -> board
                                elif prev_cy > door_line_y >= cy:
                                    handle_camera_event(delta=+1, track_id=track_id)
                            track_history[track_id] = cy

                    self.active_tracks = tracks_count
                    annotated = results[0].plot() if results else frame
                    _, buf = cv2.imencode(".jpg", annotated)
                    self.current_frame_bytes = buf.tobytes()
            else:
                # Simulated telemetry loop when hardware camera is not available
                time.sleep(0.066)  # ~15 FPS simulation
                self.active_tracks = 2 if MODE == "ai" else 0

            # Calculate FPS
            now = time.time()
            elapsed = now - prev_time
            prev_time = now
            if elapsed > 0:
                calc_fps = 1.0 / elapsed
                self.fps = round(calc_fps, 1)

            # Keep loop responsive
            loop_duration = time.time() - start_loop
            sleep_time = max(0.01, (1.0 / 30.0) - loop_duration)
            time.sleep(sleep_time)

        self.tracker_alive = False
        self.fps = 0.0
        self.active_tracks = 0
        if cap is not None:
            cap.release()


tracker = TrackerEngine()


# ==============================================================================
# Helper functions for state & broadcasting
# ==============================================================================

def compute_ai_ok() -> bool:
    """ai_ok = true IFF (camera is open) AND (model is loaded) AND
    (tracker loop is alive) AND (mode == 'ai')
    """
    return bool(tracker.camera_ok and tracker.model_loaded and tracker.tracker_alive and MODE == "ai")


def get_state_payload() -> dict:
    """Builds the extended WebSocket broadcast / admin state payload."""
    pct = round((occupancy / capacity) * 100) if capacity > 0 else 0
    st = compute_status(occupancy, capacity)
    is_ai_ok = compute_ai_ok()
    curr_fps = tracker.fps if (tracker.tracker_alive and MODE == "ai") else 0.0
    tracks = tracker.active_tracks if MODE == "ai" else 0

    return {
        "boarded": boarded,
        "alighted": alighted,
        "occupancy": occupancy,
        "capacity": capacity,
        "percent": pct,
        "status": st,
        "camera_ok": tracker.camera_ok,
        "timestamp": int(time.time()),
        "source": SOURCE_LAST,
        "mode": MODE,
        "ai_ok": is_ai_ok,
        "fps": curr_fps,
        "active_tracks": tracks,
    }


async def broadcast_state():
    """Broadcasts current state payload to all connected WebSocket clients."""
    if not active_connections:
        return
    payload = get_state_payload()
    message = json.dumps(payload)
    disconnected = set()
    for ws in list(active_connections):
        try:
            await ws.send_text(message)
        except Exception:
            disconnected.add(ws)
    for ws in disconnected:
        active_connections.discard(ws)


def notify_state_changed():
    """Dispatches broadcast_state onto the main asyncio loop safely from any thread."""
    global main_loop
    if main_loop and main_loop.is_running():
        asyncio.run_coroutine_threadsafe(broadcast_state(), main_loop)


def handle_camera_event(delta: int, track_id: Optional[int] = None):
    """Camera board/alight event handler:
    - If MODE != "ai": camera events IGNORED
    - If current occupancy > capacity: IGNORE camera event entirely (no-op, no log, no broadcast)
    - SOURCE_LAST = "camera"
    - occupancy = clamp(occupancy + delta, 0, capacity)
    - If clamp triggers on the UP side: log "clamp" event
    - log "board" | "alight"
    - broadcast()
    """
    global occupancy, boarded, alighted, SOURCE_LAST
    with state_lock:
        if MODE != "ai":
            return  # Ignored when not in 'ai' mode

        # If current occupancy > capacity, IGNORE camera event entirely
        if occupancy > capacity:
            return

        SOURCE_LAST = "camera"
        new_occ = occupancy + delta
        clamped_occ = max(0, min(capacity, new_occ))
        clamp_triggered = (clamped_occ != new_occ)
        occupancy = clamped_occ

        if delta > 0:
            boarded += 1
        elif delta < 0:
            alighted += 1

        if clamp_triggered and delta > 0:
            log_event(
                type="clamp",
                source="camera",
                occupancy=occupancy,
                mode=MODE,
                track_id=track_id,
            )

        log_event(
            type="board" if delta > 0 else "alight",
            source="camera",
            occupancy=occupancy,
            mode=MODE,
            track_id=track_id,
        )

    notify_state_changed()


def handle_admin_event(action: str, new_value: Optional[int] = None):
    """Admin board/alight/set/reset handler:
    - /admin/board when occupancy > capacity: no-op (same as camera events)
    - SOURCE_LAST = "manual"
    - /admin/set: accept any integer >= 0, floor at 0, store as-is without upper clamp
    - /admin/alight: decrement occupancy down to floor 0, no upper clamp
    - /admin/board: clamp to capacity
    - broadcast()
    """
    global occupancy, boarded, alighted, SOURCE_LAST
    with state_lock:
        if action == "board" and occupancy > capacity:
            # /admin/board when occupancy > capacity is a no-op
            return

        SOURCE_LAST = "manual"

        if action == "reset":
            occupancy = 0
            boarded = 0
            alighted = 0
            log_event(
                type="reset",
                source="manual",
                occupancy=0,
                mode=MODE,
            )
        elif action == "set":
            target = max(0, new_value) if new_value is not None else occupancy
            occupancy = target
            log_event(
                type="set",
                source="manual",
                occupancy=occupancy,
                mode=MODE,
            )
        elif action == "alight":
            occupancy = max(0, occupancy - 1)
            alighted += 1
            log_event(
                type="alight",
                source="manual",
                occupancy=occupancy,
                mode=MODE,
            )
        else:
            if action == "board":
                target = occupancy + 1
                boarded += 1
            else:
                target = occupancy

            clamped = max(0, min(capacity, target))
            clamp_triggered = (clamped != target)
            occupancy = clamped

            if clamp_triggered and target > capacity:
                log_event(
                    type="clamp",
                    source="manual",
                    occupancy=occupancy,
                    mode=MODE,
                )

            log_event(
                type=action,
                source="manual",
                occupancy=occupancy,
                mode=MODE,
            )

    notify_state_changed()


# ==============================================================================
# Security / PIN Verification
# ==============================================================================

class AuthException(Exception):
    def __init__(self, content: dict, status_code: int = 401):
        self.content = content
        self.status_code = status_code


def verify_pin(x_admin_pin: Optional[str] = Header(None, alias="X-Admin-Pin")):
    """Verifies the X-Admin-Pin header using constant-time comparison.
    Never logs or echoes the PIN.
    """
    if not x_admin_pin or not hmac.compare_digest(x_admin_pin.strip().encode("utf-8"), ADMIN_PIN.encode("utf-8")):
        raise AuthException({"ok": False, "error": "bad_pin"}, status_code=401)
    return True


# ==============================================================================
# FastAPI Application & Admin Endpoints
# ==============================================================================

app = FastAPI(title="SmartBus TN Backend", version="2.0.0")

_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(AuthException)
async def auth_exception_handler(request: Request, exc: AuthException):
    return JSONResponse(status_code=exc.status_code, content=exc.content)


@app.on_event("startup")
async def startup_event():
    global main_loop
    main_loop = asyncio.get_running_loop()
    tracker.start()
    asyncio.create_task(heartbeat_loop())


@app.on_event("shutdown")
async def shutdown_event():
    tracker.stop()


async def heartbeat_loop():
    """Heartbeat: broadcast once per second so clients can re-sync."""
    while True:
        try:
            await broadcast_state()
        except Exception:
            pass
        await asyncio.sleep(1.0)


# ------------------------------------------------------------------------------
# Request Schemas
# ------------------------------------------------------------------------------

class SetOccupancyBody(BaseModel):
    occupancy: int


class SetModeBody(BaseModel):
    mode: str


class SimulateCameraBody(BaseModel):
    delta: int = Field(..., description="+1 for board, -1 for alight")
    track_id: Optional[int] = None


# ------------------------------------------------------------------------------
# Admin REST Endpoints (STEP 3)
# ------------------------------------------------------------------------------

@app.post("/admin/board")
async def admin_board(x_admin_pin: Optional[str] = Header(None, alias="X-Admin-Pin")):
    verify_pin(x_admin_pin)
    if MODE == "paused":
        raise AuthException({"ok": False, "error": "paused"}, status_code=409)

    handle_admin_event("board")
    return {
        "ok": True,
        "occupancy": occupancy,
        "mode": MODE,
        "ai_ok": compute_ai_ok(),
    }


@app.post("/admin/alight")
async def admin_alight(x_admin_pin: Optional[str] = Header(None, alias="X-Admin-Pin")):
    verify_pin(x_admin_pin)
    if MODE == "paused":
        raise AuthException({"ok": False, "error": "paused"}, status_code=409)

    handle_admin_event("alight")
    return {
        "ok": True,
        "occupancy": occupancy,
        "mode": MODE,
        "ai_ok": compute_ai_ok(),
    }


@app.post("/admin/set")
async def admin_set(body: SetOccupancyBody, x_admin_pin: Optional[str] = Header(None, alias="X-Admin-Pin")):
    verify_pin(x_admin_pin)
    if MODE == "paused":
        raise AuthException({"ok": False, "error": "paused"}, status_code=409)

    handle_admin_event("set", new_value=body.occupancy)
    return {
        "ok": True,
        "occupancy": occupancy,
        "mode": MODE,
        "ai_ok": compute_ai_ok(),
    }


@app.post("/admin/reset")
async def admin_reset(x_admin_pin: Optional[str] = Header(None, alias="X-Admin-Pin")):
    verify_pin(x_admin_pin)
    handle_admin_event("reset")
    return {
        "ok": True,
        "occupancy": 0,
        "mode": MODE,
        "ai_ok": compute_ai_ok(),
    }


@app.post("/admin/mode")
async def admin_set_mode(body: SetModeBody, x_admin_pin: Optional[str] = Header(None, alias="X-Admin-Pin")):
    verify_pin(x_admin_pin)
    global MODE
    valid_modes = {"ai", "manual", "paused"}
    if body.mode not in valid_modes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid mode '{body.mode}'. Must be one of {valid_modes}",
        )

    with state_lock:
        MODE = body.mode

    log_event(
        type="mode",
        source="system",
        occupancy=occupancy,
        mode=MODE,
    )
    notify_state_changed()
    return {
        "ok": True,
        "occupancy": occupancy,
        "mode": MODE,
        "ai_ok": compute_ai_ok(),
    }


@app.get("/admin/state")
async def admin_get_state(x_admin_pin: Optional[str] = Header(None, alias="X-Admin-Pin")):
    verify_pin(x_admin_pin)
    return get_state_payload()


@app.get("/admin/log")
async def admin_get_log(limit: int = 20, x_admin_pin: Optional[str] = Header(None, alias="X-Admin-Pin")):
    verify_pin(x_admin_pin)
    return recent_events(limit if limit > 0 else 20)


@app.post("/admin/simulate-camera")
async def admin_simulate_camera(body: SimulateCameraBody, x_admin_pin: Optional[str] = Header(None, alias="X-Admin-Pin")):
    """Internal test/simulation endpoint to trigger a camera crossing event."""
    verify_pin(x_admin_pin)
    handle_camera_event(delta=body.delta, track_id=body.track_id)
    return {
        "ok": True,
        "occupancy": occupancy,
        "mode": MODE,
        "ai_ok": compute_ai_ok(),
    }


# ------------------------------------------------------------------------------
# Video & WebSocket Endpoints (STEP 5)
# ------------------------------------------------------------------------------

def generate_mjpeg_frames():
    """Streams MJPEG frames from the tracker engine."""
    while True:
        if not tracker.camera_ok:
            break
        frame = tracker.current_frame_bytes
        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
        )
        time.sleep(0.05)


@app.get("/video")
def video_feed():
    """Serves camera feed as an MJPEG stream at /video."""
    if not tracker.camera_ok:
        raise HTTPException(status_code=503, detail="Camera offline")
    return StreamingResponse(
        generate_mjpeg_frames(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket broadcast endpoint for dashboard telemetry."""
    await websocket.accept()
    active_connections.add(websocket)
    try:
        # Send initial state immediately
        await websocket.send_text(json.dumps(get_state_payload()))
        while True:
            # Keep connection alive, listen for any client messages
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        active_connections.discard(websocket)


# ==============================================================================
# Mount built React frontend (STEP 1 — Single-machine lab deployment)
# ==============================================================================
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException


class SPAStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except (HTTPException, StarletteHTTPException) as ex:
            if ex.status_code == 404:
                return await super().get_response("index.html", scope)
            raise ex


_dist = os.path.join(os.path.dirname(__file__), "smartbus-dashboard", "dist")
if not os.path.isdir(_dist):
    _dist = os.path.join(os.path.dirname(__file__), "..", "smartbus-dashboard", "dist")

if os.path.isdir(_dist):
    app.mount("/", SPAStaticFiles(directory=_dist, html=True), name="ui")
else:
    print("[startup] dist/ not found — run `cd smartbus-dashboard && npm run build`")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
