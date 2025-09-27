import { LitterRobotPlatform } from './platform';
import Whisker from './api/Whisker';
import { Logger, PlatformConfig } from 'homebridge';
import { GlobeLightAccessory } from './accessories/globeLight';
import { OccupancySensorAccessory } from './accessories/occupancySensor';
import { DrawerLevelAccessory } from './accessories/drawerLevel';
import { CycleEventsAccessory } from './accessories/cycleEvents';
import { Robot } from './api/Whisker.types';

type PluginConfig = PlatformConfig & {
  disableDrawerSensor?: boolean;
  debug?: boolean;
  interruptedTimeoutMinutes?: number;
  ccpMaxMinutes?: number;
};

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

const INTERRUPT_LIKE = new Set<string>([
  'csi', 'csf', 'cst', 'pd', 'p', 'hpf', 'dpf', 'dhf', 'otf', 'offline', 'sdf', 'spf', 'scf',
]);

const STATUS_COMPLETE = new Set<string>(['ccc']);
const STATUS_IN_PROGRESS = new Set<string>(['ccp']);
const STATUS_READY = new Set<string>(['rdy']);

export class LitterRobot {
  private globeLight: GlobeLightAccessory;
  private occupancySensor: OccupancySensorAccessory;
  private drawerLevel?: DrawerLevelAccessory;
  private cycleEvents: CycleEventsAccessory;

  private interruptedTimer: NodeJS.Timeout | null = null;
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

  private get cfg(): PluginConfig {
    return this.config as PluginConfig;
  }

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
    if (!this.cfg.disableDrawerSensor) {
      this.drawerLevel = new DrawerLevelAccessory(this.platform, this.account, this);
    }
    this.cycleEvents = new CycleEventsAccessory(this.platform, this.account, this);
  }

  public update(device: Robot): void {
    const nightLightOn = device.isNightLightLEDOn === true;
    const statusText = device.robotStatus ?? '';
    const dfiPercent = Number(device.DFILevelPercent ?? 0);

    this.globeLight.update(nightLightOn);
    this.occupancySensor.update(statusText);
    if (!this.cfg.disableDrawerSensor && this.drawerLevel) {
      this.drawerLevel.update(Number.isFinite(dfiPercent) ? dfiPercent : 0);
    }

    this.handleRobotUpdate(device);
  }

  private handleRobotUpdate(device: Robot): void {
    const raw = (device.robotStatus ?? '').toString();
    this.platform.d('device payload: %s', JSON.stringify(device));
    const code = this.normalizeStatusCode(raw);

    this.platform.d('robotStatus raw %s %s', this.name, raw);
    this.platform.d('mapped status %s → %s', this.name, code || '∅');
    if (!code) {
      return;
    }

    const prev = this.cycleEvents.lastStatusCode;

    if (STATUS_IN_PROGRESS.has(code)) {
      if (!this.cleanActive) {
        this.cleanActive = true;
        this.cleanStartedAt = Date.now();
        this.platform.d('cleaning started (armed) %s', this.name);
      } else {
        const limitMin = Math.max(1, Number(this.cfg.ccpMaxMinutes ?? 15));
        if (this.cleanStartedAt && Date.now() - this.cleanStartedAt > limitMin * 60_000) {
          this.platform.d('CLEAN exceeded %d min → interrupted (fallback)', limitMin);
          this.fireInterrupted();
        }
      }
    }

    if (STATUS_COMPLETE.has(code)) {
      this.fireCompletedAndClear();
    } else if (STATUS_READY.has(code) && (prev === 'ccp' || this.cleanActive)) {
      this.platform.d('cleaning ended (idle after progress) %s', this.name);
      this.fireCompletedAndClear();
    }

    if (INTERRUPT_LIKE.has(code)) {
      this.fireInterrupted();
    }

    if (prev !== code) {
      this.platform.d('status transition %s %s → %s', this.name, prev ?? '∅', code);
      this.cycleEvents.lastStatusCode = code;
    }
  }

  private normalizeStatusCode(s: string): string {
    let v = (s ?? '').toString().trim();
    if (!v) {
      return '';
    }

    const exact = v.toLowerCase();
    if (exact === 'robot_clean') return 'ccp'; // Clean in progress
    if (exact === 'robot_idle') return 'rdy'; // Ready/idle
    if (CODE_LABELS[exact]) return exact;

    if (this.name && v.toLowerCase().startsWith(this.name.toLowerCase())) {
      v = v.slice(this.name.length).trim();
    }

    const t = v.toLowerCase().replace(/[_-]+/g, ' ');

    const KEYWORD_MAP: Array<[RegExp, string]> = [
      [/(^|\s)(complete|completed|finish(ed)?|done)(\s|$)/, 'ccc'],
      [/(^|\s)(clean(ing)?|cycle in progress|in\s*progress|cycling)(\s|$)/, 'ccp'],
      [/(^|\s)(idle|ready|standby)(\s|$)/, 'rdy'],
      [/(^|\s)(interrupt|paused?|stopp?ed)(\s|$)/, 'csi'],
      [/cat\s*sensor.*fault/, 'csf'],
      [/drawer.*full/, 'dfs'],
      [/pinch.*detect/, 'pd'],
      [/bonnet.*removed/, 'br'],
      [/home position.*fault|hpf/, 'hpf'],
      [/dump.*position.*fault|dpf/, 'dpf'],
      [/over\s*torque.*fault|otf/, 'otf'],
      [/powering\s*up/, 'pwru'],
      [/powering\s*down/, 'pwrd'],
      [/(^|\s)offline(\s|$)/, 'offline'],
    ];

    for (const [pat, code] of KEYWORD_MAP) {
      if (pat.test(t)) {
        return code;
      }
    }

    if (t.includes('fault')) return 'csf';
    if (t.includes('pause')) return 'p';
    if (t.includes('off')) return 'off';

    return '';
  }

  private fireInterrupted(): void {
    this.cycleEvents.setInterrupted();
    const mins = Math.max(0, Number(this.cfg.interruptedTimeoutMinutes ?? 5));
    if (this.interruptedTimer) {
      clearTimeout(this.interruptedTimer);
    }
    if (mins > 0) {
      this.interruptedTimer = setTimeout(() => {
        this.platform.d('interrupted timer expired → firing timeout');
        this.cycleEvents.pressInterruptedTimeout();
      }, mins * 60_000);
      this.platform.d('interrupted timer started: %d min', mins);
    }
  }

  private fireCompletedAndClear(): void {
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
