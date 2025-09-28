import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';
import util from 'node:util';

import Whisker from './api/Whisker';
import { Robot } from './api/Whisker.types';
import { LitterRobot } from './litterRobot';
import { PLUGIN_NAME, PLATFORM_NAME } from './settings';

interface PluginConfig extends PlatformConfig {
  debug?: boolean;
  username?: string;
  password?: string;
  token?: string;
  baseUrl?: string;
}

type UUID = string;

type AccessoryContext = {
  robotId?: string;
};

function safeInspect(value: unknown, depth = 6): string {
  try {
    return util.inspect(value, { depth, colors: false });
  } catch {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
}

function getRobotId(robot: Robot): string | undefined {
  const r = robot as unknown as Record<string, unknown>;
  const keys = ['id', 'serial', 'device_id', 'robotId'];
  for (const k of keys) {
    const v = r[k];
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return undefined;
}

function getRobotName(robot: Robot, fallbackId?: string): string {
  const r = robot as unknown as Record<string, unknown>;
  if (typeof r.name === 'string' && r.name.trim().length > 0) return r.name;
  return `Litter-Robot${fallbackId ? ` ${fallbackId}` : ''}`;
}

export class LitterRobotPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: PlatformAccessory[] = [];
  public readonly debugEnabled: boolean;
  public readonly d: (msg: string | unknown, ...args: unknown[]) => void;

  public readonly whisker?: Whisker;

  constructor(
    public readonly log: Logger,
    public readonly config: PluginConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    this.debugEnabled = Boolean(this.config?.debug);
    this.d = (msg: string | unknown, ...args: unknown[]) => {
      if (this.debugEnabled) {
        if (typeof msg === 'string') {
          this.log.info(`[DEBUG] ${msg}`, ...args);
        } else {
          this.log.info(`[DEBUG] ${safeInspect(msg)}`);
        }
      } else {
        if (typeof msg === 'string') {
          this.log.debug(msg, ...args);
        } else {
          this.log.debug(safeInspect(msg, 4));
        }
      }
    };

    this.log.info(`${PLATFORM_NAME} initializing…`);

    let whiskerClient: Whisker | undefined;
    try {
      const { username, password, token, baseUrl } = this.config;
      if (token || (username && password)) {
        whiskerClient = new Whisker({ username, password, token, baseUrl });
      }
    } catch (e) {
      const err = e as Error;
      this.log.warn(`Whisker client init skipped or failed: ${err.message}`);
    }
    this.whisker = whiskerClient;

    this.api.on('didFinishLaunching', () => {
      this.d('didFinishLaunching – starting discovery');
      void this.discoverDevices();
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.d(`configureAccessory: restoring ${accessory.displayName} (${accessory.UUID})`);
    this.accessories.push(accessory);
  }

  public getOrCreateAccessory(
    uuid: string,
    arg2: unknown,
    arg3?: unknown,
    _arg4?: unknown,
  ): PlatformAccessory {
    let accessory = this.accessories.find((a) => a.UUID === uuid);
    if (!accessory) {
      const displayName =
        typeof arg2 === 'string'
          ? arg2
          : (typeof arg3 === 'string' ? arg3 : `LR4 ${uuid.slice(0, 6)}`);

      // Use 4-arg ctor to satisfy typings that expect 3–4 params
      accessory = new this.api.platformAccessory(
        displayName,
        uuid,
        this.api.hap.Categories.OTHER,
        undefined as unknown as Record<string, unknown>,
      );

      (accessory.context as AccessoryContext).robotId = undefined;
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
      this.d(`Registered accessory ${displayName} (${uuid})`);
    }
    return accessory;
  }

  private async discoverDevices(): Promise<void> {
    const listFn = (this.whisker as unknown as { listRobots?: () => Promise<Robot[]> })?.listRobots;
    if (!this.whisker || typeof listFn !== 'function') {
      this.d('Discovery skipped (no whisker client or listRobots not available).');
      return;
    }

    try {
      const robots: Robot[] = await listFn.call(this.whisker);
      this.d(`Found ${robots.length} robot(s)`);

      for (const robot of robots) {
        await this.registerOrUpdateRobot(robot);
      }

      const liveIds = new Set<string>();
      for (const r of robots) {
        const id = getRobotId(r);
        if (id) liveIds.add(id);
      }

      for (const acc of this.accessories) {
        const accId = (acc.context as AccessoryContext | undefined)?.robotId;
        if (accId && !liveIds.has(accId)) {
          this.log.info(`Removing stale accessory ${acc.displayName}`);
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [acc]);
        }
      }
    } catch (e) {
      const err = e as Error;
      this.log.error(`Error during Whisker discovery: ${err.message}`);
    }
  }

  public async registerOrUpdateRobot(robot: Robot): Promise<void> {
    const robotId = getRobotId(robot);
    const name = getRobotName(robot, robotId);
    if (!robotId) {
      this.log.warn(`Skipping robot without ID (name: ${name})`);
      return;
    }

    if (!this.whisker) {
      this.log.warn('Whisker client not configured; cannot register robot controller.');
      return;
    }

    this.d(`Creating controller for ${name} (${robotId})`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor: any = LitterRobot as unknown as any;
    try {
      new Ctor(this.whisker, robot, this, this.log, this.config);
    } catch {
      new Ctor(this.whisker, robot, this);
    }
  }
}
