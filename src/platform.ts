import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';

import Whisker from './api/Whisker';
import { LitterRobot } from './litterRobot';
import { PLUGIN_NAME, PLATFORM_NAME } from './settings';
import { Robot } from './api/Whisker.types';

type PluginConfig = PlatformConfig & {
  disableDrawerSensor?: boolean;
  debug?: boolean;
};

export class LitterRobotPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  public readonly accessories: PlatformAccessory[] = [];
  public litterRobots: LitterRobot[] = [];

  private static readonly POLL_INTERVAL_MS = 5000;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.warn('[LR4-Events] BUILD TAG: status-logging-min'); // runtime confirmation

    const account = new Whisker(this.config, this.log, this.accessories, this.api);

    this.api.on('didFinishLaunching', () => {
      account.authenticate().then(() => {
        this.discoverDevices(account).then(() => {
          this.pollForUpdates(account, LitterRobotPlatform.POLL_INTERVAL_MS);
        });
      });
    });
  }

  private get debugEnabled(): boolean {
    const cfg = this.config as PluginConfig;
    return Boolean(cfg?.debug);
  }

  // --- Status mapping helpers (robotStatus -> short code & label) ---

  private static readonly CODE_LABELS: Record<string, string> = {
    ccp: 'Clean Cycle In Progress',
    ccc: 'Clean Cycle Complete',
    rdy: 'Ready / Idle',
    pd: 'Pinch Detect',
    br: 'Bonnet Removed',
    hpf: 'Home Position Fault',
    dpf: 'Dump Position Fault',
    otf: 'Over Torque Fault',
    p: 'Paused',
    csi: 'Cat Sensor Interrupted',
    csf: 'Cat Sensor Fault',
    offline: 'Offline',
    dfs: 'Drawer Full',
    df2: 'Drawer Almost Full (1)',
    df1: 'Drawer Almost Full (2)',
    off: 'Off',
  };

  /** Map raw robotStatus string to our short code set */
  private mapStatusCode(raw: string): string {
    const s = String(raw ?? '').toLowerCase();

    // direct known values from app/firmware
    if (s === 'robot_clean') return 'ccp';
    if (s === 'robot_idle') return 'rdy';
    if (s.includes('clean') && s.includes('complete')) return 'ccc';

    // keyword-based mapping (covers many variants)
    if (s.includes('pinch')) return 'pd';
    if (s.includes('bonnet')) return 'br';
    if (s.includes('home') && s.includes('fault')) return 'hpf';
    if (s.includes('dump') && s.includes('fault')) return 'dpf';
    if (s.includes('torque') && s.includes('fault')) return 'otf';
    if (s.includes('pause') || s.includes('stopp') || s.includes('interrupt')) return 'p'; // generic pause/interrupt
    if (s.includes('cat') && s.includes('sensor') && s.includes('interrupt')) return 'csi';
    if (s.includes('cat') && s.includes('sensor') && s.includes('fault')) return 'csf';
    if (s.includes('offline')) return 'offline';
    if (s.includes('drawer') && s.includes('full')) return 'dfs';
    if (s.includes('off')) return 'off';

    // fallbacks
    if (s.includes('clean') && (s.includes('in progress') || s.includes('cycle'))) return 'ccp';
    if (s.includes('idle') || s.includes('ready') || s.includes('standby')) return 'rdy';

    return '';
  }

  // --- Platform basics ---

  public getOrCreateAccessory(uuid: string, name: string): PlatformAccessory {
    const existingAccessory = this.accessories.find(a => a.UUID === uuid);
    if (existingAccessory) {
      const skipDrawerLevel = (this.config as PluginConfig).disableDrawerSensor;
      const isDrawerLevel = existingAccessory.services[1]?.constructor?.name === 'HumiditySensor';
      if (skipDrawerLevel && isDrawerLevel) {
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
        return existingAccessory;
      }
      return existingAccessory;
    }

    const accessory = new this.api.platformAccessory(name, uuid);
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    this.accessories.push(accessory);
    return accessory;
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.push(accessory);
  }

  async discoverDevices(account: Whisker): Promise<void> {
    const data = JSON.stringify({
      query: `{
        query: getLitterRobot4ByUser(userId: "${account.accountId}") {
          serial
          name
          isNightLightLEDOn
        }
      }`,
    });

    return account.sendCommand(data).then((response) => {
      const devices: Robot[] = response?.data?.data?.query ?? [];
      if (this.debugEnabled) {
        this.log.info('[DEBUG] discovered devices -> %s', JSON.stringify(devices.map(d => d.serial)));
      }
      for (const device of devices) {
        this.litterRobots.push(new LitterRobot(account, device, this, this.log, this.config));
      }
    });
  }

  pollForUpdates(account: Whisker, interval: number): void {
    const command = JSON.stringify({
      query: `{
        query: getLitterRobot4ByUser(userId: "${account.accountId}") {
          serial
          name
          isNightLightLEDOn
          robotStatus
          catDetect
          DFILevelPercent
        }
      }`,
    });

    account.sendCommand(command)
      .then((response) => {
        const data: Robot[] = response?.data?.data?.query ?? [];
        if (this.debugEnabled) this.log.info('[DEBUG] poll -> %d device(s)', data.length);

        for (const device of data) {
          // --- the key debug line you asked for ---
          const raw = String(device.robotStatus ?? '');
          const code = this.mapStatusCode(raw);
          const label = LitterRobotPlatform.CODE_LABELS[code] ?? 'Unknown';

          if (this.debugEnabled) {
            this.log.info(
              '[DEBUG] status %s: raw=%s → %s (%s)',
              device.name,
              raw || '∅',
              code || '∅',
              label,
            );
          }
        }

        // hand off to device objects
        for (const device of data) {
          const lr = this.litterRobots.find(b => b.serialNumber === device.serial);
          if (lr) lr.update(device);
        }

        if (this.debugEnabled) this.log.info('[DEBUG] next poll in %d ms', interval);
        setTimeout(() => this.pollForUpdates(account, interval), interval);
      })
      .catch((err: unknown) => {
        const msg = (err as Error)?.message ?? String(err);
        this.log.warn('Poll failed: %s', msg);
        if (this.debugEnabled) this.log.info('[DEBUG] next poll in %d ms (after error)', interval);
        setTimeout(() => this.pollForUpdates(account, interval), interval);
      });
  }
}
