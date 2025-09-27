import { PlatformAccessory, Service } from 'homebridge';
import { LitterRobotPlatform } from '../platform';
import Whisker from '../api/Whisker';
import { LitterRobot } from '../litterRobot';

export class CycleEventsAccessory {
  private completedAccessory: PlatformAccessory;
  private interruptedAccessory: PlatformAccessory;
  private timeoutAccessory?: PlatformAccessory;

  private completedSwitch: Service;
  private interruptedSwitch: Service;
  private timeoutSwitch?: Service;

  private get cfg() { return this.platform.config ?? {}; }
  private get completedPulseMs() { return Math.max(0, Number(this.cfg.completedPulseSeconds ?? 1)) * 1000; }
  private get interruptedMode(): 'latch'|'pulse' { return (this.cfg.interruptedOnMode ?? 'latch') as any; }
  private get interruptedPulseMs() { return Math.max(0, Number(this.cfg.interruptedPulseSeconds ?? 1)) * 1000; }
  private get timeoutMinutes() { return Math.max(0, Number(this.cfg.interruptedTimeoutMinutes ?? 5)); }
  private get timeoutPulseMs() { return Math.max(0, Number(this.cfg.interruptedTimeoutPulseSeconds ?? 1)) * 1000; }

  constructor(
    private readonly platform: LitterRobotPlatform,
    private readonly account: Whisker,
    private readonly robot: LitterRobot,
  ) {
    // 1) Cycle Completed (momentary Switch)
    {
      const name = `${robot.name} • Cycle Completed`;
      const uuid = this.platform.api.hap.uuid.generate(robot.serialNumber + '-cycle-completed-switch');
      this.completedAccessory = this.platform.getOrCreateAccessory(uuid, name);
      this.completedAccessory.category = this.platform.api.hap.Categories.SWITCH;

      this.completedSwitch =
        this.completedAccessory.getService(this.platform.Service.Switch)
        ?? this.completedAccessory.addService(this.platform.Service.Switch, 'Cycle Completed', 'cycle-completed');

      this.completedSwitch
        .setCharacteristic(this.platform.Characteristic.ConfiguredName, 'Cycle Completed')
        .getCharacteristic(this.platform.Characteristic.On)
        .onSet(async (value) => {
          if (value) this.pulse(this.completedSwitch, this.completedPulseMs);
        })
        .updateValue(false);

      this.completedAccessory.getService(this.platform.Service.AccessoryInformation)
        ?.setCharacteristic(this.platform.Characteristic.Manufacturer, 'Whisker')
        .setCharacteristic(this.platform.Characteristic.Model, 'Litter-Robot 4')
        .setCharacteristic(this.platform.Characteristic.SerialNumber, this.robot.serialNumber);
    }

    // 2) Cycle Interrupted (latch or pulse Switch)
    {
      const name = `${robot.name} • Cycle Interrupted`;
      const uuid = this.platform.api.hap.uuid.generate(robot.serialNumber + '-cycle-interrupted-switch');
      this.interruptedAccessory = this.platform.getOrCreateAccessory(uuid, name);
      this.interruptedAccessory.category = this.platform.api.hap.Categories.SWITCH;

      this.interruptedSwitch =
        this.interruptedAccessory.getService(this.platform.Service.Switch)
        ?? this.interruptedAccessory.addService(this.platform.Service.Switch, 'Cycle Interrupted', 'cycle-interrupted');

      this.interruptedSwitch
        .setCharacteristic(this.platform.Characteristic.ConfiguredName, 'Cycle Interrupted')
        .getCharacteristic(this.platform.Characteristic.On)
        .onSet(async (value) => {
          if (!value) return; // OFF is handled by code on completion
          if (this.interruptedMode === 'pulse') {
            this.pulse(this.interruptedSwitch, this.interruptedPulseMs);
          } else {
            this.interruptedSwitch.updateCharacteristic(this.platform.Characteristic.On, true);
          }
        })
        .updateValue(false);

      this.interruptedAccessory.getService(this.platform.Service.AccessoryInformation)
        ?.setCharacteristic(this.platform.Characteristic.Manufacturer, 'Whisker')
        .setCharacteristic(this.platform.Characteristic.Model, 'Litter-Robot 4')
        .setCharacteristic(this.platform.Characteristic.SerialNumber, this.robot.serialNumber);
    }

    // 3) Interrupted Timeout (fires only if no completion in X minutes)
    if (this.timeoutMinutes > 0) {
      const name = `${robot.name} • Cycle Interrupted Timeout`;
      const uuid = this.platform.api.hap.uuid.generate(robot.serialNumber + '-cycle-interrupted-timeout-switch');
      this.timeoutAccessory = this.platform.getOrCreateAccessory(uuid, name);
      this.timeoutAccessory.category = this.platform.api.hap.Categories.SWITCH;

      this.timeoutSwitch =
        this.timeoutAccessory.getService(this.platform.Service.Switch)
        ?? this.timeoutAccessory.addService(this.platform.Service.Switch, 'Cycle Interrupted Timeout', 'cycle-timeout');

      this.timeoutSwitch
        .setCharacteristic(this.platform.Characteristic.ConfiguredName, 'Cycle Interrupted Timeout')
        .getCharacteristic(this.platform.Characteristic.On)
        .onSet(async (value) => { if (value) this.pulse(this.timeoutSwitch!, this.timeoutPulseMs); })
        .updateValue(false);

      this.timeoutAccessory.getService(this.platform.Service.AccessoryInformation)
        ?.setCharacteristic(this.platform.Characteristic.Manufacturer, 'Whisker')
        .setCharacteristic(this.platform.Characteristic.Model, 'Litter-Robot 4')
        .setCharacteristic(this.platform.Characteristic.SerialNumber, this.robot.serialNumber);
    }
  }

  // Event hooks called by LitterRobot
  pressCompleted() {
    if (this.platform?.config?.debug) this.platform.log.info('[DEBUG] HK switch → Cycle Completed (pulse)');
    this.pulse(this.completedSwitch, this.completedPulseMs);
  }

  setInterrupted() {
    if (this.platform?.config?.debug) this.platform.log.info('[DEBUG] HK switch → Cycle Interrupted (%s)', this.interruptedMode);
    if (this.interruptedMode === 'pulse') {
      this.pulse(this.interruptedSwitch, this.interruptedPulseMs);
    } else {
      this.interruptedSwitch.updateCharacteristic(this.platform.Characteristic.On, true);
    }
  }

  clearInterrupted() {
    if (this.platform?.config?.debug) this.platform.log.info('[DEBUG] HK switch → Cycle Interrupted OFF (completion)');
    this.interruptedSwitch.updateCharacteristic(this.platform.Characteristic.On, false);
  }

  pressInterruptedTimeout() {
    if (!this.timeoutSwitch) return;
    if (this.platform?.config?.debug) this.platform.log.info('[DEBUG] HK switch → Cycle Interrupted Timeout (pulse)');
    this.pulse(this.timeoutSwitch, this.timeoutPulseMs);
  }

  // Momentary pulse helper
  private pulse(svc: Service, ms: number) {
    const On = this.platform.Characteristic.On;
    svc.updateCharacteristic(On, true);
    setTimeout(() => svc.updateCharacteristic(On, false), Math.max(0, ms));
  }

  // Persist last status code (we reuse existing context field)
  get lastStatusCode(): string | undefined {
    return this.completedAccessory.context.lastStatusCode as string | undefined;
  }
  set lastStatusCode(code: string | undefined) {
    this.completedAccessory.context.lastStatusCode = code;
  }
}
