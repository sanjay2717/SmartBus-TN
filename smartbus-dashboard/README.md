# SmartBus TN — Live Occupancy Dashboard

A self-contained React dashboard for the **SmartBus TN** college project. It displays
live bus occupancy counts from a Python/WebSocket backend and a clearly-labelled
**simulated** route animation.

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 18 or later |
| npm | 9 or later |
| Python backend | Running on port **8000** (optional for demo mode) |

---

## Install

```bash
cd smartbus-dashboard
npm install
```

---

## Development

```bash
npm run dev
```

Opens at **http://localhost:5173** (or your local IP for LAN access — Vite is started
with `--host`).

The dashboard will immediately attempt to connect to `ws://localhost:8000/ws`.  
Without a backend, it shows **RECONNECTING → OFFLINE** with exponential back-off and the
route animation still plays in simulated mode.

---

## Environment variables

Copy `.env.example` to `.env` and adjust if your backend runs on a different port:

```bash
cp .env.example .env
```

```env
VITE_WS_URL=ws://localhost:8000/ws
VITE_CAMERA_URL=http://localhost:8000/video
```

---

## Production build (expo / presentation)

```bash
npm run build
# Output in smartbus-dashboard/dist/
```

### Serving from FastAPI

Mount the built `dist/` folder as a static directory in your FastAPI backend:

```python
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

app = FastAPI()
app.mount("/", StaticFiles(directory="smartbus-dashboard/dist", html=True), name="static")
```

The dashboard is then served at the same origin as the WebSocket, so no CORS issues.

---

## Backend WebSocket contract

The backend must send JSON frames to `ws://localhost:8000/ws`:

```json
{
  "boarded": 5,
  "alighted": 1,
  "occupancy": 4,
  "capacity": 10,
  "percent": 40,
  "status": "GREEN",
  "camera_ok": true,
  "timestamp": 1760000000
}
```

`status` must be one of: `GREEN` · `YELLOW` · `RED` · `OVERFLOW`

The frontend renders **status**, **percent**, and **occupancy** verbatim from the server.
It never recomputes them from camera counts.

The camera MJPEG feed is served at `http://localhost:8000/video` and rendered with a
plain `<img src>`.

---

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `Shift` + `D` | Toggle Demo mode panel |

---

## Real vs Simulated — honest note

| Feature | Source | Label shown |
|---|---|---|
| Passenger boarded / alighted count | OpenCV camera AI on the Raspberry Pi | **LIVE (camera)** |
| Occupancy / percent / status | Computed by the backend, sent over WebSocket | **LIVE** |
| Bus position on route map | Client-side animation timer (60-second loop) | **SIMULATED** |
| ETA and next stop | Derived from animation timer, not GPS | **SIMULATED** |
| Camera feed | MJPEG stream from `http://localhost:8000/video` | **LIVE (camera)** / **OFFLINE** |

The route animation is intentionally fake — the project has no GPS module.
It is always tagged **SIMULATED** so the audience can distinguish it from the real data.

---

## Project structure

```
smartbus-dashboard/
├── index.html            HTML entry point
├── package.json
├── vite.config.js
├── .env.example
└── src/
    ├── main.jsx          React root, ThemeProvider wrapper
    ├── App.jsx           Wiring: Lenis, WebSocket, demo state, view computation
    ├── config.js         All constants, STATUS_COLOR, statusFor()
    ├── styles.css        CSS variables (dark + light), grid, all component styles
    ├── context/
    │   └── ThemeContext.jsx
    ├── hooks/
    │   ├── useBusSocket.js   WebSocket + reconnect + staleness
    │   └── useLenis.js       Smooth scroll (respects prefers-reduced-motion)
    └── components/
        ├── Header.jsx
        ├── ThemeToggle.jsx
        ├── RouteMap.jsx
        ├── OccupancyKPI.jsx
        ├── StatusBanner.jsx
        ├── Counters.jsx
        ├── CameraPanel.jsx
        ├── DemoMode.jsx
        └── Footer.jsx
```

---

*SmartBus TN — College project. All simulated data is for demonstration only.*
