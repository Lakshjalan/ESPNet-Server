# RoboSoccer — Contributor Guide

> **One rule before you touch anything:** the server is the single source of truth.  
> The dashboard reads state from WebSocket `state` push — it never re-derives what the server already computed.

---

## Folder Structure

```
ESPNet-Server/
│
├── src/                        ← TypeScript server (Node.js)
│   ├── index.ts                ← Entry point — starts everything
│   ├── engine.ts               ← Composition root — wires all modules together
│   ├── config.ts               ← All env vars in one place (ports, timings, cooldowns)
│   ├── types.ts                ← Shared types: DeviceNode, MatchState, WS event shapes
│   │
│   ├── net/                    ← UDP layer (ESP32 ↔ Server)
│   │   ├── udp.ts              ← dgram socket, discovery broadcast, retry-send
│   │   └── messages.ts         ← UDP message parser/encoder — never throws
│   │
│   ├── state/                  ← In-memory game state (the source of truth)
│   │   ├── deviceRegistry.ts   ← Fleet: all ESP32 nodes, pairing, online sweep
│   │   ├── matchState.ts       ← Score, clock, intense-mode, EMP eligibility, 1s tick
│   │   ├── playerRegistry.ts   ← Player profiles (name, team, stats, availability)
│   │   ├── queueRegistry.ts    ← Match queue (upcoming Red vs Blue pairings)
│   │   └── settingsRegistry.ts ← Runtime-overridable game settings
│   │
│   ├── game/                   ← Game rule logic (pure functions, unit tested)
│   │   ├── powerups.ts         ← Kick + EMP eligibility rules, force-override path
│   │   └── ambiance.ts         ← Maps game events → audio_event / light_event WS messages
│   │
│   ├── audio/
│   │   └── spotify.ts          ← OAuth + duck/resume. Safe no-op if unconfigured.
│   │
│   ├── persistence/
│   │   └── store.ts            ← Atomic + debounced JSON file writes (crash-safe)
│   │
│   └── http/
│       ├── server.ts           ← Express app — mounts routes, serves /public static
│       ├── ws.ts               ← WebSocket hub — broadcasts state to all dashboard clients
│       └── routes/             ← One file per resource area
│           ├── match.ts        ← /api/match/*
│           ├── devices.ts      ← /api/devices/*
│           ├── pairing.ts      ← /api/pairing
│           ├── players.ts      ← /api/players/*
│           ├── queue.ts        ← /api/queue/*
│           ├── settings.ts     ← /api/settings
│           └── powerups.ts     ← /api/powerups/kick & emp
│
├── public/                     ← Frontend dashboard (plain HTML/CSS/JS — no build step)
│   ├── index.html              ← Single-page app shell + all screen HTML
│   ├── style.css               ← All styles
│   └── js/                     ← Loaded sequentially — all globals, no modules
│       ├── config.js           ← API base URL, WebSocket URL
│       ├── api.js              ← REST client, WebSocket controller, pub/sub bus
│       ├── audio.js            ← Web Audio tone synth (goal/kick/EMP sounds)
│       ├── ui.js               ← DOM renderers (fleet, timer, confetti, ticker, players)
│       ├── game.js             ← Match state, referee controls, queue, history, settings
│       └── main.js             ← DOMContentLoaded bootstrap — wires everything together
│
├── test/                       ← Vitest unit tests
│   ├── matchState.test.ts
│   └── powerups.test.ts
│
├── data/                       ← Runtime persistence (gitignored — auto-created)
│   ├── devices.json
│   └── matches.json
│
├── .env                        ← Your local config (gitignored — copy from .env.example)
├── .env.example                ← Template with all supported vars + docs
├── package.json
├── tsconfig.json
├── ARCHITECTURE (1).md         ← Full system design, UDP wire protocol, state models
├── robosoccer-app-flow.md      ← Page-by-page UI specs and API mapping
├── GAMEPLAN.md                 ← Firmware track + phase roadmap
└── README.md
```

---

## Who Owns What

| Area | Files | Notes |
|---|---|---|
| **ESP32 comms** | `net/udp.ts`, `net/messages.ts` | UDP only — all parsing is total (never throws) |
| **Game rules** | `game/powerups.ts`, `state/matchState.ts` | Pure functions — must have unit tests |
| **Fleet state** | `state/deviceRegistry.ts` | MAC-keyed, never IP-keyed |
| **REST API** | `http/routes/*.ts` | Zod-validated — bad input → 400, never a crash |
| **Dashboard** | `public/js/` | No build step. Load order matters — see below. |
| **Persistence** | `persistence/store.ts` | Never write JSON files directly — always go through JsonStore |

---

## How Data Flows

```
ESP32 firmware
    │  UDP :8888
    ▼
net/udp.ts  →  messages.ts (parse)
    │
    ├──► state/deviceRegistry.ts   (fleet, pairing, online/offline)
    ├──► state/matchState.ts       (score, clock, intense-mode)
    └──► game/powerups.ts          (kick/EMP eligibility)
              │
              ▼
         http/ws.ts  ──► broadcasts { type: 'state', devices, match }
                    ──► broadcasts audio_event / light_event / powerup_rejected
                              │
                              ▼
                    public/js/api.js (bus pub/sub)
                         │
                         ├──► ui.js     (renders DOM)
                         ├──► game.js   (updates local state vars)
                         └──► audio.js  (plays Web Audio synth sounds)
```

**Rule:** never derive game state client-side. If it is on DeviceNode or MatchState, read it from the WS state push.

---

## Frontend JS Load Order

Scripts load in this exact order — **do not reorder**:

```html
<script src="js/config.js"></script>   <!-- CONFIG object -->
<script src="js/api.js"></script>      <!-- api, bus, connectWebSocket -->
<script src="js/audio.js"></script>    <!-- tone synth — needs bus -->
<script src="js/ui.js"></script>       <!-- render helpers — needs api, bus -->
<script src="js/game.js"></script>     <!-- match logic — needs all ui fns -->
<script src="js/main.js"></script>     <!-- bootstrap — needs everything above -->
```

No ES modules. All functions are global so onclick handlers in index.html work directly.

---

## Adding a New REST Endpoint

1. Create or edit the file in `src/http/routes/`
2. Validate the request body with **Zod** — no raw req.body access
3. Mount the route in `src/http/server.ts`
4. Add the client call in `public/js/api.js`
5. If it mutates DeviceNode or MatchState — call `ws.broadcast()` after so all dashboards update

---

## Game Rules You Must Not Break

- **Score undo is single-level, not per-team.** POST /api/match/undo reverses only the last goal.
- **EMP unlocks on 2 consecutive goals OR trailing by 2+.** Logic lives in `computeEmpEligibility` in `state/matchState.ts`. Do not re-implement client-side.
- **Intense mode** = matchActive AND not paused AND timeRemainingMs <= 45000 AND scores tied. Server-computed only.
- **force: true on kick/EMP** is only honored when matchActive === false. Pre-match only.
- **Device identity is MAC-keyed, never IP-keyed.** A rebooted ESP32 gets a new IP but the same MAC.
- **Heartbeat-reported team/nodeType only seed a null field.** A REST-assigned value always wins.

---

## Running Locally

```bash
cp .env.example .env       # first time only
npm install                # first time only

npm run dev                # tsx watch — hot reloads on src/ changes
# Dashboard: http://localhost:8880

npm run build              # tsc compile check
npm test                   # vitest unit tests
```

---

## Environment Variables (.env)

| Var | Default | Purpose |
|---|---|---|
| PORT | 8880 | HTTP + WS port |
| UDP_PORT | 8888 | Listen for ESP32 traffic |
| ESP_PORT | 8889 | Send to ESP32 |
| MATCH_DURATION_MS | 900000 | 15 minutes |
| KICKER_COOLDOWN_MS | 15000 | 15s between kicks |
| EMP_DURATION_MS | 3000 | Power-cut duration |
| INTENSE_THRESHOLD_MS | 45000 | Tied + <=45s = intense mode |
| OFFLINE_THRESHOLD_MS | 6000 | No heartbeat for 6s = offline |
| SPOTIFY_CLIENT_ID/SECRET | blank | Optional — no-ops if unset |

---

## Three Screens

| Screen | Used when | Driven by |
|---|---|---|
| **Live** | During a match | WS state push — timer, score, fleet, powerups |
| **Fleet / Admin** | Before a match | WS state + REST device/pairing endpoints |
| **History** | After a match | GET /api/match/history + WS history event |

---

## Ports

| Port | What |
|---|---|
| 8880 | HTTP dashboard + REST API + WebSocket /ws |
| 8888 | UDP — listens for all ESP32 traffic |
| 8889 | UDP — server to ESP32 (unicast + discovery broadcast) |
