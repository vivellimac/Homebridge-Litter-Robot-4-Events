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

type RobotMaybe = Robot & Partial<{ status_code: string; statusCode: string }>;

export class LitterRobotPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  public readonly accessories: PlatformAccessory[] = [];
  public litterRobots: LitterRobot[] = [];

  private static readonly POLL_INTERVAL_MS = 5000;

  private get cfg(): PluginConfig {
    return this.config as PluginConfig;
  }

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform:', this.config.name);

    const account = new Whisker(this.config, this.log, this.accessories, this.api);

    this.api.on('didFinishLaunching', () => {
      this.log.debug('Executed didFinishLaunching callback');
      account.authenticate().then(() => {
        this.log.debug('Authenticated, discovering devices…');
        this.discoverDevices(account).then(() => {
          this.pollForUpdates(account, LitterRobotPlatform.POLL_INTERVAL_MS);
        });
      });
    });
  }

  private get debugEnabled(): boolean {
    return Boolean(this.cfg.debug);
  }

  /** unified debug */
  public d(message: string, ...params: unknown[]): void {
    if (this.debugEnabled) {
      // use .info to surface clearly in HB logs with a [DEBUG] tag
      this.log.info(`[DEBUG] ${message}`, ...params);
    }
  }

  public getOrCreateAccessory(uuid: string, name: string): PlatformAccessory {
    const existingAccessory = this.accessories.find((a) => a.UUID === uuid);
    if (existingAccessory) {
      const skipDrawerLevel = this.cfg.disableDrawerSensor;
      const isDrawerLevel = existingAccessory.services[1]?.constructor?.name === 'HumiditySensor';
      if (skipDrawerLevel && isDrawerLevel) {
        this.log.info('Skipping DrawerLevel:', name);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
        return existingAccessory;
      }
      this.log.info('Restoring existing accessory:', name);
      return existingAccessory;
    }

    this.log.info('Adding new accessory:', name);
    const accessory = new this.api.platformAccessory(name, uuid);
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    this.accessories.push(accessory);
    return accessory;
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading accessory from cache:', accessory.displayName);
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
        this.log.info('[DEBUG] discovered devices -> %s', JSON.stringify(devices.map((d) => d.serial)));
      }
      for (const device of devices) {
        this.log.debug('Discovered device:', device.name, device.serial);
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
        this.d('poll -> %d device(s)', data.length);

        for (const device of data as RobotMaybe[]) {
          this.d('[poll] %s payload=%s', device.name, JSON.stringify({
            serial: device.serial,
            status: device.robotStatus,
            status_code: device.status_code ?? device.statusCode ?? null,
            catDetect: device.catDetect,
            dfi: device.DFILevelPercent,
            night: device.isNightLightLEDOn,
          }));
        }

        data.forEach((device: Robot) => {
          const lr = this.litterRobots.find((b) => b.serialNumber === device.serial);
          if (lr) {
            lr.update(device);
          }
        });

        this.d('next poll in %d ms', interval);
        setTimeout(() => this.pollForUpdates(account, interval), interval);
      })
      .catch((err: unknown) => {
        const msg = (err as Error)?.message ?? String(err);
        this.log.warn('Poll failed: %s', msg);
        setTimeout(() => this.pollForUpdates(account, interval), interval);
      });
  }
}
