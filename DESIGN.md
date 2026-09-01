# RoboSoccer Dashboard — Design System & UI Specifications (`DESIGN.md`)

## 1. Aesthetic Vision & Concept

The RoboSoccer Dashboard is designed as a **dark, high-contrast scoreboard and mission control console** meant to be operated at arm's length in noisy gymnasiums, arenas, or outdoor venues under bright or ambient lighting.

- **Theme:** Broadcast sports graphics meets mission control.
- **Form Follows Function:** Dominant tabular numerals for rapid readability; clean hairline paneling for contrast without visual bloat; color used *strictly* for team identity and state indication.
- **Canvas & Context:** Primary target is desktop web (`1440px` width) for laptops placed at a scorer's/referee's table or cast to venue spectator displays.

---

## 2. Design Tokens

### 2.1 Color Palette

| Token Name | Hex Code | Purpose & Usage |
| :--- | :--- | :--- |
| **`bg-canvas`** | `#0B0E14` | Primary viewport background (near-black). |
| **`bg-panel`** | `#151923` | Card & panel background (charcoal). |
| **`border-subtle`** | `#252B38` | 1px hairline panel borders. |
| **`text-primary`** | `#F2F4F8` | Primary headings, timers, active scores (off-white). |
| **`text-secondary`** | `#8B93A7` | Labels, captions, inactive nav items (cool gray). |
| **`team-red`** | `#E8453D` | **Team Red Identity ONLY** (borders, score highlights, team badges). |
| **`team-blue`** | `#3B82F6` | **Team Blue Identity ONLY** (borders, score highlights, team badges). |
| **`status-ready`** | `#22C55E` | Online, ready, connected state (green). |
| **`status-warning`** | `#F5A524` | Cooldown, reconnecting, pending state (amber). |
| **`status-error`** | `#EF4444` | Offline, rejected action state (status-red, orange-tinted to distinguish from Team Red). |

> [!IMPORTANT]
> **Strict Rule:** Red `#E8453D` and Blue `#3B82F6` must NEVER be used decoratively. They indicate Team Red or Team Blue identity. Status colors (`#22C55E`, `#F5A524`, `#EF4444`) must ALWAYS be accompanied by text labels or distinct icons, never color alone.

---

## 3. Typography System

| Category | Font Family | Usage |
| :--- | :--- | :--- |
| **UI & Headings** | `Inter`, `Space Grotesk`, or system sans-serif | Navigation, labels, table headers, buttons, form fields. |
| **Scoreboard & Timer** | `JetBrains Mono`, `Space Mono`, or tabular monospace | Match timer (`120px`), team scores (`96px`), duration counters. |

- **Tabular Figures:** Monospaced numbers ensure digits do not jitter or shift container widths during fast countdowns or rapid goal scoring.
- **Letter Spacing:** All-caps subheaders and table column titles use `tracking-wider` (`0.05em`).

---

## 4. Spacing, Elevation & Ergonomics

- **Border Radius:** `12px` default for panels, cards, and modal dialogs; `9999px` for pill badges.
- **Elevation:** Soft radial glows (`box-shadow: 0 0 24px rgba(..., 0.15)`) instead of heavy drop shadows.
- **Touch Targets:** Minimum interactive size of `44×44px` with at least `8px` gap between tappable elements for rapid mouse clicks or touchscreen operation.

---

## 5. Page Specifications

### 5.1 Live Match Control (`/`)
- **Top Bar:** Wordmark, 6-tab navigation (`LIVE` active), connection pill (connected/reconnecting/disconnected), and pulsing "MATCH LIVE" badge.
- **3-Column Hero Layout:**
  - **Left (~20%):** Team Red fleet status card (controller & truck battery, online status, kicker cooldown).
  - **Center (~60%):** Huge 120px tabular timer ("07:42") with red-to-blue gradient glow in intense mode (≤45s left, tied score). Transport controls (`−30s`, `Start/Pause/Resume`, `+30s`, `Reset Match`). Dual score panel (Red score left, Blue score right, `+1 Goal` CTA and `Undo last goal` secondary button). Powerup status strip (Kicker & EMP states for both teams).
  - **Right (~20%):** Team Blue fleet status card.
- **Bottom:** Collapsible live event log strip (collapses to 40px, expands upward to show last 6 events).

### 5.2 Admin — Fleet & Pairing (`/admin` / `/fleet` / `/pairing`)
- **Connected Devices Table:** 8-column data grid showing MAC, IP, Node Type, Team, Battery, Last Seen, and inline action triggers.
- **Manual Assignment Modal/Row:** Dropdowns for Team, Node Type, Label, and Save/Cancel triggers.
- **Pairing Matrix:** Two-column visual connector card linking Controller chips to Truck chips with status connector lines.
- **Powerup Test Panel:** Amber-tinted header warning banner, force-fire test buttons (`Test Kick`, `Test EMP`) for hardware diagnostic validation.

### 5.3 Players & Match Queue (`/players`)
- **Arena Banner:** Highlights currently active match players with a quick "GO TO LIVE SCREEN" jump CTA.
- **Left Column:** "ADD PLAYER" form card (Name, Team, Controller, Available toggle, Submit button).
- **Right Column:** "SET UP NEXT MATCH" card (Red Player select, Blue Player select, "START THIS MATCH NOW" CTA, "Add to queue" secondary CTA).
- **Match Queue:** Reorderable list of upcoming matchups.
- **Player Roster Table:** Saved players table with wins, matches, team, controller, and availability toggle.

### 5.4 Match History (`/history`)
- **Match Ledger Table:** Completed match records detailing Timestamp, Red Player, Blue Player, Final Score (`3 – 2`), Winner Badge, and Total Match Duration. Highlights winning team score in team accent color.

### 5.5 Settings & Audio (`/settings`)
- **Backend Notice Banner:** Explains environment variable defaults.
- **2×2 Card Grid:**
  1. **Match Rules:** Duration, intense mode threshold, win condition, goal limit, sudden death toggle, auto-pause toggle.
  2. **Power-ups:** Cooldown durations, enable/disable switches.
  3. **Arena & Lighting:** Lighting mode dropdown, confetti/shake/LED sweep toggles.
  4. **Audio:** Sound triggers (goal, intense music, end match) and Master Volume slider.

---

## 6. Interaction & Motion Rules

1. **Intense Mode Trigger:** Automatically activates when `timeRemaining ≤ 45s` AND scores are tied. Triggers a red-to-blue pulse glow behind the timer and sweeps arena lighting effects.
2. **Goal Scored Effect:** Brief 1.2s flash on the scoring team's scorecard border and score numeral scale bump (`scale(1.08)`).
3. **Connection State Feedback:**
   - **Green:** Solid dot, "Connected".
   - **Amber:** Pulsing dot (`1.5s ease-in-out`), "Reconnecting…".
   - **Red:** Solid dot, "Disconnected — showing last known state".

---

## 7. Stitch Prompt Style Lock Line

When generating UI components via Stitch or LLM prompts, prefix every prompt with this style-lock payload:

```
Design language: dark scoreboard/broadcast-graphics aesthetic, not a generic SaaS dashboard. Background near-black (#0B0E14), panels a slightly lighter charcoal (#151923) with a 1px hairline border (#252B38), 12px corner radius, soft glow instead of drop shadow for elevation. Primary text off-white (#F2F4F8), secondary text cool gray (#8B93A7). Two team accent colors used ONLY for team identity, never decoratively: red #E8453D (Team Red) and blue #3B82F6 (Team Blue). Status colors used only for state, always paired with a text label (never color alone): green #22C55E = ready/online, amber #F5A524 = cooldown/warning, red #EF4444 = offline/rejected — note this status-red is visually distinct (more orange-leaning) from Team Red so the two never get confused. Typography: a geometric sans (Inter or Space Grotesk) for all UI text and labels; a monospaced, tabular-figure face (JetBrains Mono or Space Mono) specifically for the match timer and both scores, set large and bold, so digits don't shift width as they change. Icons are simple line-style SVG icons (Lucide style), never emoji. Minimum interactive target 44×44px, 8px+ spacing between tappable elements. Desktop web app, 1440px canvas, laptop-at-a-scorer's-table context.
```
