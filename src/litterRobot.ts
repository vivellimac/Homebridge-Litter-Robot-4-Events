import { LitterRobotPlatform } from './platform';
import Whisker from './api/Whisker';
import { Logger, PlatformConfig } from 'homebridge';
import { GlobeLightAccessory } from './accessories/globeLight';
import { OccupancySensorAccessory } from './accessories/occupancySensor';
import { DrawerLevelAccessory } from './accessories/drawerLevel';
import { CycleEventsAccessory } from './accessories/cycleEvents';
import { Robot } from './api/Whisker.types';

// Canonical HA codes we care about
const CODE_LABELS: Record<string, string> = {
  br: 'Bonnet Removed',
  ccc: 'Clean Cycle Complete',
  ccp: 'Clean Cycle In Progress',
  cd: 'Cat Detected',
  csf: 'Cat Sensor Fault',
  csi: 'Cat Sensor Interrupted',
  cst: 'Cat Sensor Timing',
  df1: 'Drawer Almost Full - 2 Cycles Left',
  df2: 'Drawer Almost Full - 1 Cycle Left',
  dfs: 'Drawer Full',
  dhf: 'Dump + Home Position Fault',
  dpf: 'Dump Position Fault',
  ec: 'Empty Cycle',
  hpf: 'Home Position Fault',
  off: 'Off',
  offline: 'Offline',
  otf: 'Over Torque Fault',
  p: 'Paused',
  pd: 'Pinch Detect',
  pwrd: 'Powering Down',
  pwru: 'Powering Up',
  rdy: 'Ready',
  scf: 'Cat Sensor Fault At Startup',
  sdf: 'Drawer Full At Startup',
  spf: 'Pinch Detect At Startup',
};

const INTERRUPT_LIKE = new Set([
  'csi', 'csf', 'cst', 'pd', 'p', 'hpf', 'dpf', 'dhf', 'otf', 'offline', 'sdf', 'spf', 'scf',
]);

const STATUS_COMPLETE = new Set(['ccc']);
const STATUS_IN_PROGRESS = new Set(['ccp']);
const STATUS_READY = new Set(['rdy']);

export class LitterRobot {
  private globeLight: GlobeLightAccessory;
  private occupancySensor: OccupancySensorAccessory;
  private drawerLevel?: DrawerLevelAccessory;
  private cycleEvents!: CycleEventsAccessory;

  private interruptedTimer: NodeJS.Timeout | null = null;

  // Heuristic tracking for progress/timeout
  private cleanActive = false;
  private cleanStartedAt: number | null = null;

  public uuid = {
    bot: this.platform.api.hap.uuid.generate(this.device.serial),
    globeLight: this.platform.api.hap.uuid.generate(this.device.serial + 'globeLight'),
    occupancySensor: this.platform.api.hap.uuid.generate(this.device.serial + 'occupancySensor'),
    drawerLevel: this.platform.api.hap.uuid.generate(this.device.serial + 'drawerLevel'),
  };

  public serialNumber = this.device.serial;
  public name = this.device.name;

  constructor(
    private readonly account: Whisker,
    public readonly device: Robot,
    private readonly platform: LitterRobotPlatform,
    private readonly log: Logger,
    private readonly config: PlatformConfig,
  ) {
    this.log.info('Litter Robot:', device.name, device.serial);
    this.globeLight = new GlobeLightAccessory(this.platform, this.account, this);
    this.occupancySensor = new OccupancySensorAccessory(this.platform, this.account, this);
    if (!this.config.disableDrawerSensor) {
      this.drawerLevel = new DrawerLevelAccessory(this.platform, this.account, this);
    }
    this.cycleEvents = new CycleEventsAccessory(this.platform, this.account, this);
  }

  public update(device: Robot): void {
    this.globeLight?.update(device.isNightLightLEDOn);
    this.occupancySensor?.update(device.robotStatus);
    if (!this.config.disableDrawerSensor) {
      this.drawerLevel?.update(device.DFILevelPercent);
    }
    this.handleRobotUpdate(device);
  }

  private get debugEnabled(): boolean {
    const cfg = this.config as any;
    return Boolean(cfg?.debug || cfg?.debugMode);
  }

  private handleRobotUpdate(device: Robot) {
    const raw = (device.robotStatus ?? '').toString();
    const code = this.normalizeStatusCode(raw);

    if (this.debugEnabled) {
      this.log.info('[DEBUG] robotStatus raw', this.name, raw);
      this.log.info('[DEBUG] mapped status', this.name, '→', code || '∅');
    }
    if (!code) return;

    const prev = this.cycleEvents.lastStatusCode;

    // Track cleaning window & fallback timeout
    if (STATUS_IN_PROGRESS.has(code)) {
      if (!this.cleanActive) {
        this.cleanActive = true;
        this.cleanStartedAt = Date.now();
        if (this.debugEnabled) this.log.info('[DEBUG] cleaning started (armed)', this.name);
      } else {
        const cfg = this.config as any;
        const limitMin = Math.max(1, Number(cfg?.ccpMaxMinutes ?? 15)); // default 15 min
        if (this.cleanStartedAt && Date.now() - this.cleanStartedAt > limitMin * 60_000) {
          // Fallback: long-running clean -> treat as interrupted timeout
          if (this.debugEnabled) this.log.info('[DEBUG] CLEAN exceeded %d min → interrupted (fallback)', limitMin);
          this.fireInterrupted(); // fires timeout path too (if configured)
          // Do not reset cleanActive here; wait for rdy or explicit ccc
        }
      }
    }

    // Completed paths
    if (STATUS_COMPLETE.has(code)) {
      this.fireCompletedAndClear();
    } else if (STATUS_READY.has(code) && (prev === 'ccp' || this.cleanActive)) {
      // Treat ccp → rdy as completion (common cloud behavior)
      if (this.debugEnabled) this.log.info('[DEBUG] cleaning ended (idle after progress)', this.name);
      this.fireCompletedAndClear();
    }

    // Interrupted/fault-like codes
    if (INTERRUPT_LIKE.has(code)) {
      this.fireInterrupted();
    }

    if (prev !== code) {
      if (this.debugEnabled) this.log.info('[DEBUG] status transition', this.name, `${prev ?? '∅'} → ${code}`);
      this.cycleEvents.lastStatusCode = code;
    }
  }

  /**
   * Normalize arbitrary backend text into canonical HA codes.
   * Strategy:
   * 1) If input already equals a canonical code, accept it.
   * 2) Strip the device name prefix (many backends prepend it).
   * 3) Keyword→code dictionary (generic; no explicit ROBOT_* constants).
   * 4) Final heuristics as safety net.
   */
  private normalizeStatusCode(s: string): string {
    let v = (s ?? '').toString().trim();
    if (!v) return '';

    // If it's already a canonical code
    const low = v.toLowerCase();
    if (CODE_LABELS[low]) return low;

    // Strip a leading "<name> " prefix if present (e.g., "The PoopMobile XYZ")
    if (this.name && v.toLowerCase().startsWith(this.name.toLowerCase())) {
      v = v.slice(this.name.length).trim();
    }

    const t = v.toLowerCase();

    // Generic keyword → canonical mapping (no explicit ROBOT_* references)
    const KEYWORD_MAP: Array<[string | RegExp, string]> = [
      // completion
      [/complete|completed|finish|finished|done/, 'ccc'],
      // in-progress
      [/clean(ing)?|cycle in progress|in\s*progress|cycling/, 'ccp'],
      // ready/idle
      [/\bidle\b|ready|standby/, 'rdy'],
      // interrupted/paused/fault-ish
      [/interrupt|paused?|stopp?ed/, 'csi'],
      [/cat\s*sensor.*fault/, 'csf'],
      [/drawer.*full/, 'dfs'],
      [/pinch.*detect/, 'pd'],
      [/bonnet.*removed/, 'br'],
      [/home position.*fault|hpf/, 'hpf'],
      [/dump.*position.*fault|dpf/, 'dpf'],
      [/over\s*torque.*fault|otf/, 'otf'],
      [/powering\s*up/, 'pwru'],
      [/powering\s*down/, 'pwrd'],
      [/offline/, 'offline'],
    ];

    for (const [pat, code] of KEYWORD_MAP) {
      if ((pat instanceof RegExp && pat.test(t)) || (typeof pat === 'string' && t.includes(pat))) {
        return code;
      }
    }

    // Final safety net
    if (t.includes('fault')) return 'csf';
    if (t.includes('pause')) return 'p';
    if (t.includes('off')) return 'off';

    return ''; // unknown/ignore
  }

  // === Event helpers ===

  private fireInterrupted() {
    this.cycleEvents.setInterrupted();
    // start/refresh timeout window
    const cfg = this.config as any;
    const mins = Math.max(0, Number(cfg?.interruptedTimeoutMinutes ?? 5));
    if (this.interruptedTimer) clearTimeout(this.interruptedTimer);
    if (mins > 0) {
      this.interruptedTimer = setTimeout(() => {
        if (this.debugEnabled) this.log.info('[DEBUG] interrupted timer expired → firing timeout');
        this.cycleEvents.pressInterruptedTimeout();
      }, mins * 60_000);
      if (this.debugEnabled) this.log.info('[DEBUG] interrupted timer started: %d min', mins);
    }
  }

  private fireCompletedAndClear() {
    this.cycleEvents.pressCompleted();
    this.cycleEvents.clearInterrupted();
    if (this.interruptedTimer) {
      clearTimeout(this.interruptedTimer);
      this.interruptedTimer = null;
    }
    this.cleanActive = false;
    this.cleanStartedAt = null;
  }
}
