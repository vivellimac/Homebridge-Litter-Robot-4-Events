import { LitterRobotPlatform } from './platform';
import Whisker from './api/Whisker';
import { Logger, PlatformConfig } from 'homebridge';
import { GlobeLightAccessory } from './accessories/globeLight';
import { OccupancySensorAccessory } from './accessories/occupancySensor';
import { DrawerLevelAccessory } from './accessories/drawerLevel';
import { CycleEventsAccessory } from './accessories/cycleEvents';
import { Robot } from './api/Whisker.types';

const STATUS_COMPLETE = new Set(['ccc']);
const STATUS_INTERRUPTED = new Set(['csi', 'csf']);

export class LitterRobot {
  private globeLight: GlobeLightAccessory;
  private occupancySensor: OccupancySensorAccessory;
  private drawerLevel?: DrawerLevelAccessory;
  private cycleEvents!: CycleEventsAccessory;

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

  private normalizeStatusCode(s: string): string {
    const v = (s ?? '').toString().trim().toLowerCase();
    if (!v) return '';
    if (['ccc', 'csi', 'csf', 'ccp', 'rdy', 'df1', 'df2', 'dfs'].includes(v)) return v;
    if (v.includes('complete')) return 'ccc';
    if (v.includes('interrupted')) return 'csi';
    if (v.includes('cat sensor') && v.includes('fault')) return 'csf';
    if (v.includes('in progress') || v.includes('cleaning')) return 'ccp';
    if (v.includes('ready')) return 'rdy';
    return v;
  }

  private handleRobotUpdate(device: Robot) {
    const raw = (device.robotStatus ?? '').toString();
    const code = this.normalizeStatusCode(raw);
    if (!code) return;
    const prev = this.cycleEvents.lastStatusCode;
    if (code !== prev) {
      this.onStatusChanged(code, prev);
      this.cycleEvents.lastStatusCode = code;
    }
  }

  private onStatusChanged(newCode: string, oldCode?: string) {
    this.log.info(`LR4 ${this.name} status ${oldCode ?? 'n/a'} → ${newCode}`);
    if (STATUS_COMPLETE.has(newCode)) {
      this.cycleEvents.pressCompleted();
      return;
    }
    if (STATUS_INTERRUPTED.has(newCode)) {
      this.cycleEvents.pressInterrupted();
      return;
    }
  }
}
