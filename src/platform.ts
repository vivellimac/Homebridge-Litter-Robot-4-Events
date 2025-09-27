import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import Whisker from './api/Whisker';
import { LitterRobot } from './litterRobot';
import { PLUGIN_NAME, PLATFORM_NAME } from './settings';
import { Robot } from './api/Whisker.types';

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
    this.log.warn('[LR4-Events] BUILD TAG: fixed-5s');

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
  return Boolean((this.config as any)?.debug);
}

/** unified debug */
public d(message: string, ...params: any[]) {
  if (this.debugEnabled) this.log.debug(message, ...params);
}

  getOrCreateAccessory(uuid: string, name: string) {
    const existingAccessory = this.accessories.find(a => a.UUID === uuid);
    if (existingAccessory) {
      const skipDrawerLevel = (this.config as any).disableDrawerSensor;
      const isDrawerLevel = existingAccessory.services[1]?.constructor?.name === 'HumiditySensor';
      if (skipDrawerLevel && isDrawerLevel) {
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
        return existingAccessory;
      }
      return existingAccessory;
    } else {
      const accessory = new this.api.platformAccessory(name, uuid);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
      return accessory;
    }
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.accessories.push(accessory);
  }

  async discoverDevices(account: Whisker) {
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
      this.d('discovered devices -> %s', JSON.stringify(devices.map(d => d.serial)));
      for (const device of devices) {
        this.litterRobots.push(new LitterRobot(account, device, this, this.log, this.config));
      }
    });
  }

  pollForUpdates(account: Whisker, interval: number) {
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

        data.forEach((device: Robot) => {
          const lr = this.litterRobots.find((b) => b.serialNumber === device.serial);
          if (lr) lr.update(device);
        });

        this.d('next poll in %d ms', interval);
        setTimeout(() => this.pollForUpdates(account, interval), interval);
      })
      .catch((err) => {
        this.log.warn('Poll failed: %s', err?.message || err);
        this.d('next poll in %d ms (after error)', interval);
        setTimeout(() => this.pollForUpdates(account, interval), interval);
      });
  }
}
