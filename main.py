import asyncio
import base64
import hmac
import json
import os
import socket
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
    """Create tables and indexes if they don't exist, and migrate columns if needed."""
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
          mode      TEXT    NOT NULL,
          event_id  TEXT,
          door      TEXT,
          applied   INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_events_event_id
          ON events(event_id) WHERE event_id IS NOT NULL;
        """
    )
    # Check existing columns in case table was created with earlier schema
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(events)")
    existing_cols = {row[1] for row in cursor.fetchall()}
    if "event_id" not in existing_cols:
        cursor.execute("ALTER TABLE events ADD COLUMN event_id TEXT")
    if "door" not in existing_cols:
        cursor.execute("ALTER TABLE events ADD COLUMN door TEXT")
    if "applied" not in existing_cols:
        cursor.execute("ALTER TABLE events ADD COLUMN applied INTEGER NOT NULL DEFAULT 1")
    cursor.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_events_event_id ON events(event_id) WHERE event_id IS NOT NULL"
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
                    "INSERT INTO events(ts,type,source,track_id,occupancy,mode,event_id,door,applied)"
                    " VALUES (?,?,?,?,?,?,?,?,?)",
                    (
                        row.get("ts", time.time()),
                        row.get("type", "unknown"),
                        row.get("source", "manual"),
                        row.get("id"),           # old JSON used "id" for track_id
                        row.get("occupancy", 0),
                        row.get("mode", "ai"),   # old rows had no mode field
                        None,
                        None,
                        1,
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
    door: Optional[str] = None,
    event_id: Optional[str] = None,
    applied: int = 1,
) -> None:
    """Insert one event row into SQLite.
    Recovers gracefully if the DB file was deleted at runtime.
    """
    _INSERT_SQL = (
        "INSERT INTO events(ts,type,source,track_id,occupancy,mode,event_id,door,applied)"
        " VALUES (?,?,?,?,?,?,?,?,?)"
    )
    params = (time.time(), type, source, track_id, occupancy, mode, event_id, door, applied)
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
            "SELECT id,ts,type,source,track_id,occupancy,mode,event_id,door,applied"
            " FROM events ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    except sqlite3.OperationalError:
        _ensure_schema(_conn)
        return []
    return [
        dict(zip(("id", "ts", "type", "source", "track_id", "occupancy", "mode", "event_id", "door", "applied"), r))
        for r in rows
    ]


DEFAULT_CAPACITY: int = 10
CAPACITY: int = int(os.getenv("CAPACITY", os.getenv("BUS_CAPACITY", str(DEFAULT_CAPACITY))))
capacity: int = CAPACITY
boarded: int = 0
alighted: int = 0
occupancy: int = 0

ADMIN_PIN: str = os.getenv("ADMIN_PIN", "4821")
INGEST_KEY: str = os.getenv("INGEST_KEY", "")
DOORS_EXPECTED: int = int(os.getenv("DOORS_EXPECTED", "2"))
ENABLE_LOCAL_YOLO: bool = os.getenv("ENABLE_LOCAL_YOLO", "1") not in ("0", "false", "False")

camera_boards: dict = {"entrance": 0, "exit": 0}
camera_alights: dict = {"entrance": 0, "exit": 0}

door_baselines: dict = {
    "entrance": {"run_id": None, "server_boards_at_start": 0},
    "exit":     {"run_id": None, "server_boards_at_start": 0},
}

last_heartbeat: dict = {
    "entrance": {"ts": 0.0, "fps": 0.0, "camera_ok": False, "run_id": None, "cumulative_boards": 0, "cumulative_alights": 0},
    "exit":     {"ts": 0.0, "fps": 0.0, "camera_ok": False, "run_id": None, "cumulative_boards": 0, "cumulative_alights": 0},
}

latest_jpeg: dict = {"entrance": None, "exit": None}
last_frame_ts: dict = {"entrance": 0.0, "exit": 0.0}

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

def compute_camera_ok() -> bool:
    has_any_heartbeat = any(last_heartbeat[d]["ts"] > 0 for d in ("entrance", "exit"))
    if ENABLE_LOCAL_YOLO and not has_any_heartbeat:
        return bool(tracker.camera_ok)

    expected = {"entrance"} if DOORS_EXPECTED == 1 else {"entrance", "exit"}
    now = time.time()
    for door in expected:
        hb = last_heartbeat[door]
        if hb["ts"] == 0:
            return False
        if now - hb["ts"] > 5.0:
            return False
        if not hb["camera_ok"]:
            return False
    return True


def compute_ai_ok() -> bool:
    """Rewrite compute_ai_ok for two-door ingestion."""
    if MODE != "ai":
        return False
    has_any_heartbeat = any(last_heartbeat[d]["ts"] > 0 for d in ("entrance", "exit"))
    if ENABLE_LOCAL_YOLO and not has_any_heartbeat:
        return bool(tracker.camera_ok and tracker.model_loaded and tracker.tracker_alive)

    expected = {"entrance"} if DOORS_EXPECTED == 1 else {"entrance", "exit"}
    now = time.time()
    for door in expected:
        hb = last_heartbeat[door]
        if hb["ts"] == 0:
            return False              # never received a heartbeat
        if now - hb["ts"] > 5.0:
            return False              # stale
        if not hb["camera_ok"]:
            return False              # client reports camera down

    return True


def get_state_payload() -> dict:
    """Builds the extended WebSocket broadcast / admin state payload."""
    pct = round((occupancy / capacity) * 100) if capacity > 0 else 0
    st = compute_status(occupancy, capacity)
    is_ai_ok = compute_ai_ok()
    is_cam_ok = compute_camera_ok()

    expected = {"entrance"} if DOORS_EXPECTED == 1 else {"entrance", "exit"}
    now = time.time()

    entrance_hb = last_heartbeat["entrance"]
    entrance_stale = (entrance_hb["ts"] == 0) or ((now - entrance_hb["ts"]) > 5.0)
    entrance_client_boards = entrance_hb.get("cumulative_boards", 0)
    entrance_server_boards = camera_boards["entrance"]

    doors_obj = {
        "entrance": {
            "configured": True,
            "camera_ok": entrance_hb["camera_ok"],
            "fps": entrance_hb["fps"],
            "last_heartbeat_at": entrance_hb["ts"],
            "run_id": entrance_hb["run_id"],
            "client_boards": entrance_client_boards,
            "server_boards": entrance_server_boards,
            "mismatch": entrance_client_boards - entrance_server_boards,
            "stale": entrance_stale,
        }
    }

    if DOORS_EXPECTED == 1:
        doors_obj["exit"] = {
            "configured": False,
        }
    else:
        exit_hb = last_heartbeat["exit"]
        exit_stale = (exit_hb["ts"] == 0) or ((now - exit_hb["ts"]) > 5.0)
        exit_client_boards = exit_hb.get("cumulative_boards", 0)
        exit_server_boards = camera_boards["exit"]
        doors_obj["exit"] = {
            "configured": True,
            "camera_ok": exit_hb["camera_ok"],
            "fps": exit_hb["fps"],
            "last_heartbeat_at": exit_hb["ts"],
            "run_id": exit_hb["run_id"],
            "client_boards": exit_client_boards,
            "server_boards": exit_server_boards,
            "mismatch": exit_client_boards - exit_server_boards,
            "stale": exit_stale,
        }

    has_any_heartbeat = any(last_heartbeat[d]["ts"] > 0 for d in ("entrance", "exit"))
    if ENABLE_LOCAL_YOLO and not has_any_heartbeat:
        curr_fps = tracker.fps if (tracker.tracker_alive and MODE == "ai") else 0.0
        tracks = tracker.active_tracks if MODE == "ai" else 0
    else:
        fps_vals = [last_heartbeat[d]["fps"] for d in expected if last_heartbeat[d]["ts"] > 0]
        curr_fps = round(sum(fps_vals) / len(fps_vals), 1) if fps_vals else 0.0
        tracks = 0

    return {
        "boarded": boarded,
        "alighted": alighted,
        "occupancy": occupancy,
        "capacity": capacity,
        "percent": pct,
        "status": st,
        "camera_ok": is_cam_ok,
        "timestamp": int(time.time()),
        "source": SOURCE_LAST,
        "mode": MODE,
        "ai_ok": is_ai_ok,
        "fps": curr_fps,
        "active_tracks": tracks,
        "doors": doors_obj,
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


def verify_ingest_key(x_ingest_key: Optional[str] = Header(None, alias="X-Ingest-Key")):
    """Verifies the X-Ingest-Key header matches INGEST_KEY.
    Returns 401 with {"ok": False, "error": "bad_key"} if invalid.
    """
    if not INGEST_KEY or not x_ingest_key or not hmac.compare_digest(x_ingest_key.strip().encode("utf-8"), INGEST_KEY.strip().encode("utf-8")):
        raise AuthException({"ok": False, "error": "bad_key"}, status_code=401)
    return True


# ==============================================================================
# FastAPI Application & Admin Endpoints
# ==============================================================================

app = FastAPI(title="SmartBus TN Backend", version="2.0.0")

LAN_HOST: str = os.getenv("LAN_HOST", "").strip()

_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]
if LAN_HOST:
    _origins.append(f"http://{LAN_HOST}:5173")
    _origins.append(f"http://{LAN_HOST}:8000")

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
    if ENABLE_LOCAL_YOLO:
        tracker.start()
    asyncio.create_task(heartbeat_loop())

    # Detect LAN IP
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = "127.0.0.1"
    finally:
        s.close()

    print(f"[startup] Listening on http://{ip}:8000")
    key_display = "<default>" if (not INGEST_KEY or INGEST_KEY == "change-me") else "<set>"
    print(f"[startup] DOORS_EXPECTED={DOORS_EXPECTED} CAPACITY={CAPACITY} INGEST_KEY={key_display}")


@app.on_event("shutdown")
async def shutdown_event():
    if ENABLE_LOCAL_YOLO:
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


# ==============================================================================
# Ingestion Endpoints (Two-door ingestion API)
# ==============================================================================

@app.post("/ingest/event")
async def ingest_event(
    request: Request,
    x_ingest_key: Optional[str] = Header(None, alias="X-Ingest-Key"),
):
    verify_ingest_key(x_ingest_key)
    try:
        data = await request.json()
    except Exception:
        return JSONResponse(status_code=422, content={"ok": False, "error": "bad_payload"})

    door = data.get("door")
    evt_type = data.get("type")
    event_id = data.get("event_id")
    track_id = data.get("track_id")

    if (
        door not in ("entrance", "exit")
        or evt_type not in ("board", "alight")
        or not isinstance(event_id, str)
        or not event_id.strip()
    ):
        return JSONResponse(status_code=422, content={"ok": False, "error": "bad_payload"})

    global occupancy, boarded, alighted, SOURCE_LAST

    with state_lock:
        with _db_lock:
            cur = _conn.cursor()
            cur.execute("SELECT 1 FROM events WHERE event_id = ?", (event_id,))
            if cur.fetchone() is not None:
                return {
                    "ok": True,
                    "applied": False,
                    "reason": "duplicate",
                    "event_id": event_id,
                }

        # Reject path: MODE != "ai"
        if MODE != "ai":
            log_event(
                type=evt_type,
                source="camera",
                occupancy=occupancy,
                mode=MODE,
                track_id=track_id,
                door=door,
                event_id=event_id,
                applied=0,
            )
            return {
                "ok": True,
                "applied": False,
                "reason": "mode_not_ai",
                "event_id": event_id,
            }

        # Reject path: type == "board" AND occupancy >= CAPACITY
        if evt_type == "board" and occupancy >= capacity:
            log_event(
                type=evt_type,
                source="camera",
                occupancy=occupancy,
                mode=MODE,
                track_id=track_id,
                door=door,
                event_id=event_id,
                applied=0,
            )
            return {
                "ok": True,
                "applied": False,
                "reason": "overflow",
                "event_id": event_id,
            }

        # Apply path:
        warning = None
        if door == "entrance" and evt_type == "alight":
            warning = "door_type_mismatch"
        elif door == "exit" and evt_type == "board":
            warning = "door_type_mismatch"

        SOURCE_LAST = "camera"
        if evt_type == "board":
            occupancy = min(capacity, occupancy + 1)
            boarded += 1
            camera_boards[door] += 1
        elif evt_type == "alight":
            old = occupancy
            occupancy = max(0, occupancy - 1)
            alighted += 1
            camera_alights[door] += 1
            if old == 0:
                # When decremented at occupancy 0, log alight_at_zero and return
                # warning="alight_at_zero" in the response (overriding door_type_mismatch
                # if present, so the zero-clamp condition is immediately signaled to the client).
                warning = "alight_at_zero"
                log_event(
                    type="alight_at_zero",
                    source="camera",
                    occupancy=0,
                    mode=MODE,
                    track_id=track_id,
                    door=door,
                    applied=1,
                )

        log_event(
            type=evt_type,
            source="camera",
            occupancy=occupancy,
            mode=MODE,
            track_id=track_id,
            door=door,
            event_id=event_id,
            applied=1,
        )

    notify_state_changed()

    response = {
        "ok": True,
        "applied": True,
        "event_id": event_id,
        "occupancy": occupancy,
    }
    if warning:
        response["warning"] = warning
    return response


@app.post("/ingest/heartbeat")
async def ingest_heartbeat(
    request: Request,
    x_ingest_key: Optional[str] = Header(None, alias="X-Ingest-Key"),
):
    verify_ingest_key(x_ingest_key)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=422, content={"ok": False, "error": "bad_payload"})

    door = body.get("door")
    if door not in ("entrance", "exit"):
        return JSONResponse(status_code=422, content={"ok": False, "error": "bad_payload"})

    run_id = body.get("run_id")
    cum_boards = body.get("cumulative_boards", 0)
    cum_alights = body.get("cumulative_alights", 0)
    fps = float(body.get("fps", 0.0))
    camera_ok = bool(body.get("camera_ok", False))
    timestamp = float(body.get("timestamp", time.time()))

    with state_lock:
        prev_run = door_baselines[door]["run_id"]
        prev_start = door_baselines[door]["server_boards_at_start"]

        if prev_run is None or prev_run != run_id:
            # First heartbeat of a new run. Record baseline, no comparison.
            door_baselines[door]["run_id"] = run_id
            door_baselines[door]["server_boards_at_start"] = camera_boards[door] - cum_boards
            expected = camera_boards[door]
            diff_boards = 0
            match = "ok"
        else:
            expected = prev_start + cum_boards
            diff_boards = abs(expected - camera_boards[door])
            match = "ok" if diff_boards <= 2 else "mismatch"

        last_heartbeat[door] = {
            "ts": timestamp,
            "fps": fps,
            "camera_ok": camera_ok,
            "run_id": run_id,
            "cumulative_boards": cum_boards,
            "cumulative_alights": cum_alights,
        }

        server_boards = camera_boards[door]
        server_alights = camera_alights[door]

    return {
        "ok": True,
        "received_at": time.time(),
        "server_cumulative_boards": server_boards,
        "server_cumulative_alights": server_alights,
        "match": match,
        "diff_boards": diff_boards,
    }


@app.post("/ingest/frame")
async def ingest_frame(
    request: Request,
    door: Optional[str] = None,
    x_ingest_key: Optional[str] = Header(None, alias="X-Ingest-Key"),
):
    verify_ingest_key(x_ingest_key)
    if not door or door not in ("entrance", "exit"):
        return JSONResponse(status_code=422, content={"ok": False, "error": "bad_payload"})

    body = await request.body()
    latest_jpeg[door] = body
    last_frame_ts[door] = time.time()
    return {"ok": True}


# ------------------------------------------------------------------------------
# Video & WebSocket Endpoints (STEP 5 & STEP 6)
# ------------------------------------------------------------------------------

def generate_door_mjpeg(door: str):
    """Multipart MJPEG stream reading latest_jpeg[door]. If door is not configured
    or latest_jpeg is None, sends a 1-pixel transparent JPEG at 1 fps.
    """
    while True:
        frame = latest_jpeg.get(door)
        if frame is None and ENABLE_LOCAL_YOLO and door == "entrance" and tracker.tracker_alive:
            frame = tracker.current_frame_bytes

        if frame is None:
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n" + TINY_JPEG_BYTES + b"\r\n"
            )
            time.sleep(1.0)
        else:
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
            )
            time.sleep(0.05)


@app.get("/video")
def video_feed(door: Optional[str] = "entrance"):
    """Serves camera feed as an MJPEG stream at /video per door."""
    target_door = door if door in ("entrance", "exit") else "entrance"
    return StreamingResponse(
        generate_door_mjpeg(target_door),
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
