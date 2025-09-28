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
  /** When true, dump raw API responses & full device payloads (capped). */
  debugRaw?: boolean;
};

// Accept either snake_case / camelCase and (optionally) a nested status.code
type RobotMaybe = Robot & Partial<{
  status_code: string;
  statusCode: string;
  status: { code?: string } | null;
}>;

export class LitterRobotPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  public readonly accessories: PlatformAccessory[] = [];
  public litterRobots: LitterRobot[] = [];

  private static readonly POLL_INTERVAL_MS = 5000;

  private get cfg(): PluginConfig {
    return this.config as PluginConfig;
  }

  private get debugEnabled(): boolean {
    return Boolean(this.cfg.debug);
  }

  private get rawEnabled(): boolean {
    return Boolean(this.cfg.debugRaw);
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

  /** Unified debug (surfaces clearly in HB logs when enabled) */
  public d(message: string, ...params: unknown[]): void {
    if (this.debugEnabled) {
      this.log.info(`[DEBUG] ${message}`, ...params);
    }
  }

  /** Very loud logging; only emits when debugRaw=true */
  public r(message: string, ...params: unknown[]): void {
    if (this.rawEnabled) {
      this.log.info(`[RAW] ${message}`, ...params);
    }
  }

  /** Safe JSON stringify with cap to keep HB logs responsive */
  private s(value: unknown, cap = 12000): string {
    let out: string;
    try {
      out = JSON.stringify(value);
    } catch {
      out = String(value);
    }
    if (out.length > cap) {
      return out.slice(0, cap) + `… [+${out.length - cap} bytes truncated]`;
    }
    return out;
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
    if (this.rawEnabled) {
      this.r('discover response: %s', this.s(response));
    }
    const devices = (response?.data?.data?.query ?? []) as Robot[];
    if (this.debugEnabled) {
      this.d('discovered devices -> %s', this.s(devices.map((d) => d.serial)));
    }
    for (const device of devices) {
      this.log.debug('Discovered device:', device.name, device.serial);
      this.litterRobots.push(new LitterRobot(account, device, this, this.log, this.config));
    }
  }

  public pollForUpdates(account: Whisker, interval: number): void {
    // Wide query (attempt nested compact status code if supported)
    const wide = JSON.stringify({
      query: `{
        query: getLitterRobot4ByUser(userId: "${account.accountId}") {
          serial
          name
          isNightLightLEDOn
          robotStatus
          catDetect
          DFILevelPercent
          status { code }   # optional: some schemas expose this
        }
      }`,
    });

    // Narrow query (always supported)
    const narrow = JSON.stringify({
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

    // Shared response handler
    const handle = (response: unknown, tag: 'wide' | 'narrow'): void => {
      if (this.rawEnabled) {
        const rAny = response as { data?: { errors?: unknown; data?: unknown } };
        this.r('%s response errors: %s', tag, this.s(rAny?.data?.errors));
        this.r('%s response data: %s', tag, this.s(rAny?.data?.data));
      }

      const list =
        (response as { data?: { data?: { query?: RobotMaybe[] } } })?.data?.data?.query ?? [];
      const arr = Array.isArray(list) ? list : [];
      this.d('poll -> %d device(s)', arr.length);

      for (const device of arr) {
        // Show every key we got for this device, and the full payload.
        const keys = Object.keys(device as Record<string, unknown>).join(',');
        this.r('[device keys] %s -> %s', device?.name ?? '<unnamed>', keys);

        const sc =
          device?.status?.code ??
          device?.status_code ??
          device?.statusCode ??
          null;

        // Compact payload in normal debug:
        this.d(
          '[poll] %s payload=%s',
          device?.name,
          this.s({
            serial: device?.serial,
            status: device?.robotStatus,
            status_code: sc,
            catDetect: device?.catDetect,
            dfi: device?.DFILevelPercent,
            night: device?.isNightLightLEDOn,
          }),
        );

        // Full device object when debugRaw is on:
        this.r('[device raw] %s -> %s', device?.name ?? '<unnamed>', this.s(device));
      }

      // Propagate updates to device objects.
      for (const device of arr) {
        const lr = this.litterRobots.find((b) => b.serialNumber === device.serial);
        if (lr) {
          lr.update(device as Robot);
        }
      }

      this.d('next poll in %d ms', interval);
      setTimeout(() => this.pollForUpdates(account, interval), interval);
    };

    // Try wide → fallback to narrow if errors OR empty list
    void account
      .sendCommand(wide)
      .then((resp: unknown) => {
        const r = resp as { data?: { errors?: unknown[]; data?: { query?: unknown } } } | undefined;
        const errs = r?.data?.errors ?? [];
        const q = r?.data?.data?.query as unknown;

        const hasErrors = Array.isArray(errs) && errs.length > 0;
        const isArray = Array.isArray(q);
        const isEmptyArray = isArray && q.length === 0;
        const hasNonEmptyData = isArray && q.length > 0;

        if (hasErrors) {
          this.r('wide query errors: %s', this.s(errs));
        }

        if (hasErrors || !hasNonEmptyData) {
          this.d('wide query failed/empty (errors=%s, empty=%s) → fallback',
            String(hasErrors), String(isEmptyArray));
          return account.sendCommand(narrow).then((resp2) => ({ resp, resp2 }));
        }

        return { resp, resp2: null as unknown };
      })
      .then((bundle: { resp: unknown; resp2: unknown } | undefined) => {
        if (!bundle) {
          // Should not happen; defensive.
          return;
        }
        const { resp, resp2 } = bundle;
        if (resp2) {
          handle(resp2, 'narrow');
        } else {
          handle(resp, 'wide');
        }
      })
      .catch((err: unknown) => {
        const msg = (err as Error)?.message ?? String(err);
        this.log.warn('Poll failed: %s', msg);
        setTimeout(() => this.pollForUpdates(account, interval), interval);
      });
  }
}
