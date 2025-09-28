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
  // Accept several possible id keys without using `any`
  const r = robot as Record<string, unknown>;
  const keys = ['id', 'serial', 'device_id', 'robotId'];
  for (const k of keys) {
    const v = r[k];
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return undefined;
}

function getRobotName(robot: Robot, fallbackId?: string): string {
  const r = robot as Record<string, unknown>;
  if (typeof r.name === 'string' && r.name.trim().length > 0) return r.name;
  return `Litter-Robot${fallbackId ? ` ${fallbackId}` : ''}`;
}

export class LitterRobotPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: PlatformAccessory[] = [];
  public readonly litterRobots = new Map<UUID, LitterRobot>();

  public readonly debugEnabled: boolean;
  public readonly d: (msg: string | unknown, ...args: unknown[]) => void;

  private readonly whisker?: Whisker;

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

  private async discoverDevices(): Promise<void> {
    if (!this.whisker) {
      this.d('No Whisker client configured; discovery delegated to controllers.');
      return;
    }

    try {
      const robots: Robot[] = await this.whisker.listRobots();
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
        const ctx = (acc.context ?? {}) as AccessoryContext;
        const accId = ctx.robotId;
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

    const uuid = this.api.hap.uuid.generate(robotId);
    let accessory = this.accessories.find((a) => a.UUID === uuid);

    if (accessory) {
      this.d(`Updating existing accessory: ${name} (${robotId})`);
      accessory.displayName = name;
      (accessory.context as AccessoryContext).robotId = robotId;
      this.api.updatePlatformAccessories([accessory]);
    } else {
      this.d(`Registering new accessory: ${name} (${robotId})`);
      accessory = new this.api.platformAccessory(name, uuid);
      (accessory.context as AccessoryContext).robotId = robotId;

      const controller = new LitterRobot(this, accessory, robot);
      this.litterRobots.set(robotId, controller);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
      return;
    }

    const existing = this.litterRobots.get(robotId);
    if (!existing) {
      const controller = new LitterRobot(this, accessory, robot);
      this.litterRobots.set(robotId, controller);
    } else if (typeof (existing as unknown as { updateFromRobot?: (r: Robot) => void }).updateFromRobot === 'function') {
      (existing as unknown as { updateFromRobot: (r: Robot) => void }).updateFromRobot(robot);
    }
  }
}
