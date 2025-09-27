# Litter Robot 4 Homebridge Plugin (Cycle Events Fork)

This fork extends the original LR4 plugin with **HomeKit event-style triggers** and a **clean, canonical status pipeline**.

**New HomeKit accessories (per robot):**
- **Cycle Completed** — a *Switch* that pulses ON when a clean completes.
- **Cycle Interrupted** — a *Switch* that latches ON when an interruption/fault is detected (clears on next completion).
- **Cycle Interrupted Timeout** — a *Switch* that pulses ON if a clean stays “in progress” longer than your timeout window.

These make it easy to drive Automations/Scenes in the Home app.

---

## Features
- Supports multiple Litter-Robot 4 devices
- Toggle the **Globe Light**
- **Cat Detect** sensor
- **Waste Drawer Level** sensor
- **Cycle event switches** (Completed / Interrupted / Interrupted Timeout)
- Fast fixed polling (**5s**) for snappy automations
- Robust normalization of backend status into **canonical HA-style codes**

---

## How it Works

### Canonical status codes (normalized)
The plugin converts the backend `robotStatus` into **Home Assistant–style codes**:

| Code | Meaning |
|---|---|
| `ccc` | Clean Cycle Complete |
| `ccp` | Clean Cycle In Progress |
| `rdy` | Ready / Idle |
| `csi` | Cat Sensor Interrupted |
| `csf` | Cat Sensor Fault |
| `pd`  | Pinch Detect |
| `p`   | Paused |
| `df1` / `df2` / `dfs` | Drawer almost full / full |
| `hpf` / `dpf` / `dhf` | Home/Dump position faults |
| `offline` / `pwru` / `pwrd` | Offline / Powering up / Powering down |
| `br` / `scf` / `sdf` / `spf` | Bonnet removed / startup faults |

> If the API already returns these short codes, they’re used directly. If it returns strings (e.g., “idle”, “cleaning”, “paused”, “drawer full”), we map them into these codes via keyword rules.

### Event logic
- **Cycle Completed** → fires when:
  - We see `ccc`, **or**
  - We observe a transition **`ccp → rdy`** (common cloud behavior).
- **Cycle Interrupted** → fires when **any interrupt/fault-like code** appears:  
  `csi, csf, pd, p, hpf, dpf, dhf, otf, offline, sdf, spf, scf…`
  - This switch **latches ON** until a completion clears it.
- **Cycle Interrupted Timeout** → fires if a clean remains `ccp` longer than **`ccpMaxMinutes`** (fallback for stalls / Wi-Fi hiccups).

All three are exposed as **Switches** so they’re easy to use in Home automations. (Completed/Timeout are stateless pulses; Interrupted latches.)

---

## Supported Robot Versions
- **Litter-Robot 4**

---

## Installation

### Option A — From your GitHub fork (recommended while developing)
```bash
# On the Homebridge host
cd /var/lib/homebridge/node_modules
git clone https://github.com/vivellimac/Homebridge-Litter-Robot-4-Events.git homebridge-litter-robot-4-events
cd homebridge-litter-robot-4-events
npm ci
npm run build
# Restart Homebridge from the UI
```

### Option B — Global install via npm (publish / or GitHub shortcut)
```bash
# Example (if published to npm):
# sudo npm install -g --unsafe-perm homebridge-litter-robot-4-events
```

```bash
# Or install straight from GitHub:
sudo npm install -g --unsafe-perm github:vivellimac/Homebridge-Litter-Robot-4-Events
```

## Configuration

Add a platform block like:


```bash
{
  "platform": "LitterRobot4",
  "email": "your@email",
  "password": "your-password",
  "disableDrawerSensor": false,
  "debug": true,

  "completedPulseSeconds": 1,
  "interruptedTimeoutMinutes": 5,
  "interruptedTimeoutPulseSeconds": 1,
  "ccpMaxMinutes": 15
}
```

**Fields**
- `email` / `password` — Whisker app credentials (used to authenticate).
- `disableDrawerSensor` — hide the drawer level sensor if you don’t want it.
- `debug` — verbose logs (recommended while testing).
- `completedPulseSeconds` — how long the **Cycle Completed** switch stays ON when triggered (stateless pulse).
- `interruptedTimeoutMinutes` — if a clean stays `ccp` beyond this, trigger the **Interrupted Timeout** switch.
- `interruptedTimeoutPulseSeconds` — pulse length for the **Interrupted Timeout** switch.
- `ccpMaxMinutes` — “long clean” window before we treat it as interrupted (fallback for stalls/Wi-Fi issues).

> **Security tip:** Homebridge stores config on disk. If you prefer not to store a plaintext password, you can add a `passwordEnv` option in your fork and read from an environment variable (not enabled by default here).

---

## Using in HomeKit

Open **Home → Automations → + → A Sensor Detects Something → Choose Accessory** and pick:
- `<Robot Name> • Cycle Completed` — Switch turns **ON briefly** when a clean completes.
- `<Robot Name> • Cycle Interrupted` — Switch **latches ON** when an interruption/fault is detected; it clears on the next completion.
- `<Robot Name> • Cycle Interrupted Timeout` — Switch turns **ON briefly** if a clean remains in progress longer than your timeout window.

Attach scenes / notifications to those events.

---

## How Status Codes Are Handled (API pass-through → canonical codes)

The plugin converts backend `robotStatus` text into **Home Assistant–style canonical codes** and drives events from those:

| Code | Meaning |
|---|---|
| `ccc` | Clean Cycle Complete |
| `ccp` | Clean Cycle In Progress |
| `rdy` | Ready / Idle |
| `csi` | Cat Sensor Interrupted |
| `csf` | Cat Sensor Fault |
| `pd`  | Pinch Detect |
| `p`   | Paused |
| `df1` / `df2` / `dfs` | Drawer almost full / full |
| `hpf` / `dpf` / `dhf` | Home/Dump position faults |
| `offline` / `pwru` / `pwrd` | Offline / Powering up / Powering down |
| `br` / `scf` / `sdf` / `spf` | Bonnet removed / startup faults |

**Event logic**
- **Cycle Completed** → fires on `ccc`, or when we detect **`ccp → rdy`**.
- **Cycle Interrupted** → fires on any of: `csi, csf, pd, p, hpf, dpf, dhf, otf, offline, sdf, spf, scf…` (latches until completion).
- **Cycle Interrupted Timeout** → fires if `ccp` exceeds `ccpMaxMinutes` (fallback for silent stalls/Wi-Fi issues).

If the API already returns the short codes above, they’re used directly. If it returns descriptive strings (e.g., “cleaning”, “idle”, “paused”, “drawer full”), the plugin maps them into these codes via keywords.

---

## Troubleshooting

- **Not seeing events?**  
  Turn on `"debug": true` and watch logs for:  
  - `"[DEBUG] robotStatus raw …"`  
  - `"[DEBUG] mapped status … → <code>"`  
  - `"[DEBUG] status transition …"`
- **Old accessories lingering?**  
  Remove just the old tiles in the Homebridge **Accessories** tab, then restart Homebridge; the plugin will re-register the new ones.
- **Polling cadence**  
  Fixed **5s**. You can make it configurable in `platform.ts` if needed.
- **Conflicting installs**  
  Ensure only one LR4 plugin is enabled and that Homebridge is loading **this** folder (check the startup log banner if you added one).

---

## Credits
- Original LR4 Homebridge plugin by **@rylee-s**
- Status code semantics aligned with **Home Assistant / pylitterbot**
- This fork by **@vivellimac** adds event switches + canonical code normalization
