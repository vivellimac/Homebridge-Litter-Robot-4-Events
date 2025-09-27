# Litter Robot 4 Homebridge Plugin (Cycle Events Fork)

This fork extends the original plugin with **HomeKit event triggers** for Litter-Robot 4:
- **Cycle Completed** → fires a HomeKit trigger when a clean cycle finishes.
- **Cycle Interrupted** → fires a HomeKit trigger when a cycle is interrupted (e.g., cat sensor).

These appear in the Home app as **Stateless Programmable Switch** “buttons,” perfect for automations/scenes.

---

## Features
- Supports multiple Litter-Robot 4 devices 🤖🤖🤖
- Toggle the **Globe Light** 💡
- **Cat Detect** sensor 📸
- **Waste Drawer Level** sensor 💰
- **NEW: Cycle Completed / Cycle Interrupted** HomeKit triggers (event-style)

### How it works (TL;DR)
The plugin polls Whisker’s LR4 API and watches `robotStatus`. When it transitions to:
- `ccc` (or a label containing “complete”) → **Cycle Completed** event
- `csi` / `csf` (or labels containing “interrupted” / “cat sensor fault”) → **Cycle Interrupted** event

> You’ll use these in **Home → Automations → A Sensor Detects Something → Choose Accessory**.

---

## Supported Robot Versions
- Litter-Robot 4

---

## Installation

### Option A — Homebridge UI (Install from file)
1. Build or download a release `.tgz` of this fork.
2. In Homebridge UI → **Plugins** → **…** (top right) → **Install from file** → select the `.tgz`.

### Option B — Command line (install directly from GitHub)
```bash
sudo npm install -g --unsafe-perm github:vivellimac/Homebridge-Litter-Robot-4-Events
