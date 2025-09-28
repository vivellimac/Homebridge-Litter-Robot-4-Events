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

// GraphQL sometimes returns snake_case or camelCase; accept either.
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

    // Use async/await to avoid dangling promises; handle errors explicitly.
    this.api.on('didFinishLaunching', async () => {
      try {
        this.log.debug('Executed didFinishLaunching callback');
        await account.authenticate();
        this.log.debug('Authenticated, discovering devices…');
        await this.discoverDevices(account);
        this.pollForUpdates(account, LitterRobotPlatform.POLL_INTERVAL_MS);
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        this.log.error('Startup failed: %s', msg);
      }
    });
  }

  private get debugEnabled(): boolean {
    return Boolean(this.cfg.debug);
  }

  /** Unified debug (surfaces clearly in HB logs when enabled) */
  public d(message: string, ...params: unknown[]): void {
    if (this.debugEnabled) {
      // Prefer info so debug lines aren’t hidden in default HB UI filters.
      this.log.info(`[DEBUG] ${message}`, ...params);
    }
  }

  public getOrCreateAccessory(uuid: string, name: string): PlatformAccessory {
    const existingAccessory = this.accessories.find((a) => a.UUID === uuid);
    if (existingAccessory) {
      const skipDrawerLevel = this.cfg.disableDrawerSensor === true;
      const secondService = existingAccessory.services[1];
      const isDrawerLevel = secondService?.constructor?.name === 'HumiditySensor';
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

  public async discoverDevices(account: Whisker): Promise<void> {
    // Keep this query light; status fields not required for discovery.
    const body = JSON.stringify({
      query: `{
        query: getLitterRobot4ByUser(userId: "${account.accountId}") {
          serial
          name
          isNightLightLEDOn
        }
      }`,
    });

    const response = await account.sendCommand(body);
    const devices = (response?.data?.data?.query ?? []) as Robot[];
    if (this.debugEnabled) {
      this.log.info('[DEBUG] discovered devices -> %s', JSON.stringify(devices.map((d) => d.serial)));
    }
    for (const device of devices) {
      this.log.debug('Discovered device:', device.name, device.serial);
      this.litterRobots.push(new LitterRobot(account, device, this, this.log, this.config));
    }
  }

  public pollForUpdates(account: Whisker, interval: number): void {
    const body = JSON.stringify({
      query: `{
        query: getLitterRobot4ByUser(userId: "${account.accountId}") {
          serial
          name
          isNightLightLEDOn
          robotStatus
          catDetect
          DFILevelPercent
          status_code
          statusCode
        }
      }`,
    });

    // Fire-and-forget loop with explicit error handling.
    void account
      .sendCommand(body)
      .then((response) => {
        const data = (response?.data?.data?.query ?? []) as RobotMaybe[];
        this.d('poll -> %d device(s)', data.length);

        for (const device of data) {
          const sc = device.status_code ?? device.statusCode ?? null;
          this.d(
            '[poll] %s payload=%s',
            device.name,
            JSON.stringify({
              serial: device.serial,
              status: device.robotStatus,
              status_code: sc,
              catDetect: device.catDetect,
              dfi: device.DFILevelPercent,
              night: device.isNightLightLEDOn,
            }),
          );
        }

        // Propagate updates to device objects.
        for (const device of data) {
          const lr = this.litterRobots.find((b) => b.serialNumber === device.serial);
          if (lr) {
            lr.update(device as Robot);
          }
        }

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
