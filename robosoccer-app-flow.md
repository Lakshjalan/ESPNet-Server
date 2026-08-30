# RoboSoccer dashboard — app flow & page specs

Three pages, one nav shell, one WebSocket connection shared across all of them (`/ws`, subscribing to `state`, `audio_event`, `light_event`, `powerup_rejected`, `history`). REST calls are one-shot actions; the WS `state` push is the source of truth for everything on screen — never poll `/api/devices` or `/api/match/state` after the initial load.

## 0. Site map

```
/admin    → set up pairing, teams, names, test-fire powerups   (used BEFORE a match)
/         → live match control                                  (used DURING a match)
/history  → completed match ledger                              (used AFTER a match)
```

All three are reachable from a persistent top nav at any time (a referee mid-match might jump to `/admin` to re-pair a rebooted device), but the *intended* flow is left-to-right: Admin → Live → History.

**Global nav bar** (present on all pages):
- Logo/title, 3 nav links (Live / Admin / History)
- WS connection pill: connected (green dot) / reconnecting (amber, pulsing) / disconnected (red) — drive this off the raw socket `onopen`/`onclose`, not off receiving a `state` message, so it reflects transport state even if the server is silent
- If disconnected: bank the last-known `state` in memory and show a "showing last known state — reconnecting" banner instead of blanking the UI

## 1. Live match control — `/`

This is the in-game page. Everything here is driven by the WS `state` push (`{devices, match}`) plus the audio/light event stream for a live activity log.

### 1.1 Timer
- Big countdown, `match.timeRemainingMs` formatted `MM:SS`
- Start / Pause / Resume / Reset buttons → `POST /api/match/start {playerRedName, playerBlueName}`, `/pause`, `/resume`, `/reset`
- Increase / decrease buttons → `POST /api/match/time {deltaMs}` (positive or negative delta; use a fixed step, e.g. ±30s, with a long-press or a small stepper input for a custom amount)
- Visually flag `isIntenseMode` (≤45s, tied score) — border glow / background tint, since this is server-computed and should just be reflected, not re-derived client-side
- Disable Start once `matchActive` is true; disable Pause/Resume appropriately based on `isPaused`

### 1.2 Score panel (both players)
- Two symmetric cards (red / blue), each showing `match.playerRedName`/`playerBlueName` and `match.scoreRed`/`match.scoreBlue`
- Increase button → `POST /api/match/goal {team}`
- Decrease button → `POST /api/match/undo`

  **Flag:** `/api/match/undo` is documented as *single-level* — it reverses only the most recently scored goal, and it's not team-scoped (there's one shared undo, not a per-team decrement). A "decrease blue score" button that's meant to work at any point in the match, arbitrarily, isn't something the current API supports. Two honest options for the UI:
  1. Keep one "undo last goal" control (not per-team) and label it that way, matching the API exactly.
  2. If you want true per-team arbitrary decrement, that's a backend gap — flag it for whoever owns the server (`state/matchState.ts`) rather than papering over it client-side.

### 1.3 Fleet status side panel
Two columns (red / blue), each showing that team's controller and truck:
- Filter `devices` from the WS `state` push by `team` and `nodeType`
- Per device: `label` (fallback to short MAC), `isOnline` (dot), `batteryPct` if present, and for controllers specifically: `kickerCooldownUntil` (countdown chip if in the future) and `powerupEmpReady`
- An unpaired or missing controller/truck for a team should show a clear "not assigned — set up in Admin" state rather than a blank slot

### 1.4 Powerup status section
- **Kicker**, per team: ready / on cooldown (countdown from `kickerCooldownUntil`)
- **EMP**, per team: not unlocked / ready (green) / active — opponent frozen (countdown from `powerCutUntil`)
- All of this is read straight off `DeviceNode` fields already in the `state` push — no separate endpoint needed
- Small live event strip fed by `audio_event`/`light_event` WS messages (e.g. "Kick fired — red", "EMP fired — blue → red") gives the referee a sanity-check log without needing devtools

### 1.5 Rejections
- Subscribe to `powerup_rejected {action, mac, reason}` and surface it as a toast — this is the one signal that a referee-triggered action (or a player's own button press relayed through your dashboard's test controls) didn't go through, and why

## 2. Admin — pairing & powerup test — `/admin`

Used before a match to get the fleet into a known state.

### 2.1 Connected devices table
- Full `devices` list from `state` (or `GET /api/devices` on load, then WS for live updates)
- Columns: MAC, IP, nodeType, team, label, online/offline, battery, last seen
- This is also where "is ESP32 X connected right now" is answered directly — no separate polling needed since `isOnline`/`lastSeen` come from the same heartbeat-driven registry

### 2.2 Manual assignment
Per device row (or a dedicated assignment form):
- Team dropdown (red / blue / unassigned) → `PUT /api/devices/:mac/team {team}`
- Node type dropdown (controller / truck / lighting) → `PUT /api/devices/:mac/node-type {nodeType}`
- Label/name field → `PUT /api/devices/:mac/label {label}`
- Remove button (for stale/decommissioned devices) → `DELETE /api/devices/:mac`

### 2.3 Pairing matrix
- Controller ↔ truck links, e.g. "controller ESP1 + truck ESP2 → assigned red" is really two separate calls: assign both devices' `team=red` (2.2 above), then `POST /api/pairing {controllerMac, truckMac}` to link them
- `DELETE /api/pairing/:mac` to unpair
- Render as a simple two-column picker (controllers on the left, trucks on the right) rather than free-text MAC entry — pick from the already-known online devices

### 2.4 Player names

**Flag:** there's no standalone "set player name" endpoint — `playerRedName`/`playerBlueName` only exist on `MatchState`, and the only way to set them today is `POST /api/match/start {playerRedName, playerBlueName}`. So a name field on the Admin page is either:
- purely staged locally and passed through when the referee later hits "Start match" on the Live page (simplest, no backend change), or
- if you want names locked in during setup (before the match clock starts), that needs a small backend addition — e.g. accept an optional name payload on `POST /api/match/reset`, or a new `PUT /api/match/players` endpoint

Recommend option 1 for now (store staged names in a tiny bit of client state or localStorage, prefill the Start-match form on `/`) since it needs zero backend changes.

### 2.5 Powerup test section

Per the architecture doc, `POST /api/powerups/kick {mac}` and `POST /api/powerups/emp {mac, targetTeam}` are explicitly documented as reusing "the same validated path as `EVENT|KICK_REQ`" — i.e. cooldown, pairing, and online checks still apply.

**Flag — this conflicts with the requirement.** "Test mode, no criteria needed, should be able to overwrite" needs an unconditional fire path, and the current two endpoints aren't that; they're a referee-facing shortcut for the *same* rule-checked flow. Two ways to close this gap, in order of preference:
1. Add a `force`/`test` flag the existing endpoints honor server-side — `POST /api/powerups/kick {mac, force: true}` — that skips `evaluateKick`/`evaluateEmp` and goes straight to the UDP dispatch (`CMD|KICK_FIRE` / `CMD|POWER_CUT`). Keep it gated (e.g. only in a non-production build, or requiring the Admin page context) so it can't be hit accidentally during a real match.
2. A parallel `/api/powerups/test/*` route pair that bypasses the eligibility functions entirely.

Until one of those exists, the Admin test buttons should call the existing endpoints and clearly surface `powerup_rejected` events when the test fires while eligibility checks aren't met (cooldown mid-test, device offline) — that's honest about current behavior, just not what was asked for.

UI: per team, a "test kick" and "test EMP" button hitting the relevant controller/truck MACs directly (bypassing the fleet-status read of `powerupEmpReady`/cooldown, once the backend gap above is closed) plus a live result readout.

## 3. Match history — `/history`

- `GET /api/match/history` on load
- Table: date/time, red name vs blue name, final score, winner, duration
- No live update needed here (WS `history` event exists for pushing a freshly-completed match to the top without a refetch — nice-to-have, not required)

## 4. Cross-checked against the gameplan — anything else needed?

Went through `PRD.pdf`/`GAMEPLAN.md`'s Phase 2/3 scope against the three pages above:

- **Spotify (Phase 3):** `GET /auth/spotify/login` is an OAuth redirect, not a page of its own. Fits as a small "connect Spotify" button + status chip inside Admin — optional, safe to skip for v1 since the server no-ops cleanly when unconfigured.
- **Lighting pattern preview (Phase 3):** the server already dispatches `CMD|LIGHT_FX` on every relevant event; there's no dedicated lighting-test endpoint yet (parallel gap to the powerup force-fire one above) but if you want to visually confirm the WS2812B rig without touching the arena, that's a natural sibling to the powerup test section in Admin, not a separate page.
- **RSSI / fleet health depth (Phase 3 backlog):** not in the current heartbeat dictionary at all — nothing to build yet, it's a firmware-side addition first.
- **Auth/login:** nothing in the API implies a login flow; this reads as a LAN-only referee console. No login page unless that's a requirement you're adding independently.
- **Settings page:** most "settings" (ports, cooldowns, thresholds) are env-configured server-side (`config.ts`), not runtime-editable — no settings page needed unless you want to expose match duration / cooldown overrides at runtime, which isn't in the current REST surface either.

So: **3 pages covers the full documented API surface.** The two real gaps are backend, not missing pages — (a) no standalone player-naming endpoint outside match-start, and (b) no unconditional/force powerup test path — both called out above with the smallest fix for each.
