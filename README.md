# Litter Robot 4 Homebridge Plugin (Cycle Events Fork)

This fork extends the original LR4 plugin with **HomeKit-friendly cycle event switches**:

- **Cycle Completed** – pulses ON when a clean finishes
- **Cycle Interrupted** – latches ON when a cycle is interrupted/faulted (clears on completion)
- **Cycle Interrupted Timeout** – pulses ON if a clean stays “in progress” beyond your timeout window

These appear as **regular Switches** in Home, so you can trigger automations on the switch turning ON.

> Based on the excellent work in [`rylee-s/Homebridge-Litter-Robot-4`](https://github.com/rylee-s/Homebridge-Litter-Robot-4). This fork focuses on LR4 **cycle events** and a few quality-of-life tuning options.

---

## Features

- Supports multiple **Litter-Robot 4** devices
- Toggle the **Globe Light**
- **Cat Detect** status
- **Waste Drawer Level** (optional, can be disabled)
- **NEW: Three cycle-event switches** per robot:
  - `• Cycle Completed` (momentary pulse)
  - `• Cycle Interrupted` (latched ON until completion)
  - `• Cycle Interrupted Timeout` (momentary pulse if a clean hangs too long)
- **Fast polling** (default every **5 seconds**) for responsive automations
- **Canonical status-code mapping** (HA-style: `ccc`, `ccp`, `rdy`, `csi`, etc.)

### How cycle events are detected

We normalize LR4 status text to canonical codes:

- **Completed**: `ccc`, or a transition **`ccp` → `rdy`**
- **Interrupted**: any of `csi`, `csf`, `pd`, `p`, `hpf`, `dpf`, `dhf`, `otf`, `offline`, etc.
- **Timeout**: if `ccp` (clean in progress) exceeds your **max CLEAN minutes**, we fire the *Interrupted Timeout* switch

You can customize pulse durations and timeouts in the config (see below).

---

## Supported Robot Versions

- **Litter-Robot 4**

---

## Installation

### Option A — Homebridge UI (Install from file)
1. Build or download a release `.tgz` of this fork.
2. In Homebridge UI → **Plugins** → **…** (top right) → **Install from file** → select the `.tgz`.

### Option B — Command line (install directly from GitHub)
```bash
sudo npm install -g --unsafe-perm github:vivellimac/Homebridge-Litter-Robot-4-Events
