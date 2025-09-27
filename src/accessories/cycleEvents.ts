import { PlatformAccessory, Service } from 'homebridge';
import { LitterRobotPlatform } from '../platform';
import Whisker from '../api/Whisker';
import { LitterRobot } from '../litterRobot';

export class CycleEventsAccessory {
  private completedAcc: PlatformAccessory;
  private interruptedAcc: PlatformAccessory;
  private timeoutAcc: PlatformAccessory;

  private completedSwitch: Service;
  private interruptedSwitch: Service;
  private timeoutSwitch: Service;

  constructor(
    private readonly platform: LitterRobotPlatform,
    private readonly account: Whisker,
    private readonly robot: LitterRobot,
  ) {
    // Completed
    {
      const name = `${robot.name} • Cycle Completed`;
      const uuid = this.platform.api.hap.uuid.generate(robot.serialNumber + '-cycle-completed-switch');
      this.completedAcc = this.platform.getOrCreateAccessory(uuid, name);
      this.completedAcc.category = this.platform.api.hap.Categories.SWITCH;

      this.completedSwitch =
        this.completedAcc.getService(this.platform.Service.Switch) ??
        this.completedAcc.addService(this.platform.Service.Switch, 'Cycle Completed', 'cycle-completed-switch');

      this.completedSwitch.getCharacteristic(this.platform.Characteristic.On)
        .onGet(() => false) // stateless-like
        .onSet(async (v) => {
          // allow manual pulse from Home app
          if (v) this.pulse(this.completedSwitch, this.completedPulseMs());
        });

      this.completedAcc.getService(this.platform.Service.AccessoryInformation)
        ?.setCharacteristic(this.platform.Characteristic.Manufacturer, 'Whisker')
        .setCharacteristic(this.platform.Characteristic.Model, 'Litter-Robot 4')
        .setCharacteristic(this.platform.Characteristic.SerialNumber, this.robot.serialNumber);
    }

    // Interrupted (latching ON until cleared)
    {
      const name = `${robot.name} • Cycle Interrupted`;
      const uuid = this.platform.api.hap.uuid.generate(robot.serialNumber + '-cycle-interrupted-switch');
      this.interruptedAcc = this.platform.getOrCreateAccessory(uuid, name);
      this.interruptedAcc.category = this.platform.api.hap.Categories.SWITCH;

      this.interruptedSwitch =
        this.interruptedAcc.getService(this.platform.Service.Switch) ??
        this.interruptedAcc.addService(this.platform.Service.Switch, 'Cycle Interrupted', 'cycle-interrupted-switch');

      this.interruptedSwitch.getCharacteristic(this.platform.Characteristic.On)
        .onGet(() => Boolean(this.interruptedAcc.context._on))
        .onSet(async (v) => {
          this.interruptedAcc.context._on = Boolean(v);
          this.interruptedSwitch.updateCharacteristic(this.platform.Characteristic.On, v);
        });

      this.interruptedAcc.getService(this.platform.Service.AccessoryInformation)
        ?.setCharacteristic(this.platform.Characteristic.Manufacturer, 'Whisker')
        .setCharacteristic(this.platform.Characteristic.Model, 'Litter-Robot 4')
        .setCharacteristic(this.platform.Characteristic.SerialNumber, this.robot.serialNumber);
    }

    // Interrupted Timeout (stateless pulse)
    {
      const name = `${robot.name} • Cycle Interrupted Timeout`;
      const uuid = this.platform.api.hap.uuid.generate(robot.serialNumber + '-cycle-interrupted-timeout-switch');
      this.timeoutAcc = this.platform.getOrCreateAccessory(uuid, name);
      this.timeoutAcc.category = this.platform.api.hap.Categories.SWITCH;

      this.timeoutSwitch =
        this.timeoutAcc.getService(this.platform.Service.Switch) ??
        this.timeoutAcc.addService(this.platform.Service.Switch, 'Cycle Interrupted Timeout', 'cycle-interrupted-timeout-switch');

      this.timeoutSwitch.getCharacteristic(this.platform.Characteristic.On)
        .onGet(() => false)
        .onSet(async (v) => {
          if (v) this.pulse(this.timeoutSwitch, this.timeoutPulseMs());
        });

      this.timeoutAcc.getService(this.platform.Service.AccessoryInformation)
        ?.setCharacteristic(this.platform.Characteristic.Manufacturer, 'Whisker')
        .setCharacteristic(this.platform.Characteristic.Model, 'Litter-Robot 4')
        .setCharacteristic(this.platform.Characteristic.SerialNumber, this.robot.serialNumber);
    }
  }

  // ---- Public API consumed by litterRobot.ts ----

  pressCompleted() {
    this.pulse(this.completedSwitch, this.completedPulseMs());
  }

  setInterrupted() {
    this.interruptedAcc.context._on = true;
    this.interruptedSwitch.updateCharacteristic(this.platform.Characteristic.On, true);
  }

  clearInterrupted() {
    this.interruptedAcc.context._on = false;
    this.interruptedSwitch.updateCharacteristic(this.platform.Characteristic.On, false);
  }

  pressInterruptedTimeout() {
    this.pulse(this.timeoutSwitch, this.timeoutPulseMs());
  }

  // Persist last code across restarts on the Completed accessory
  get lastStatusCode(): string | undefined {
    return this.completedAcc.context.lastStatusCode as string | undefined;
  }
  set lastStatusCode(code: string | undefined) {
    this.completedAcc.context.lastStatusCode = code;
  }

  // ---- Helpers ----

  private pulse(service: Service, ms: number) {
    service.updateCharacteristic(this.platform.Characteristic.On, true);
    setTimeout(() => {
      service.updateCharacteristic(this.platform.Characteristic.On, false);
    }, Math.max(200, ms)); // minimum 200ms so Home notices
  }

  private completedPulseMs(): number {
    const cfg = this.platform.config as any;
    const sec = Number(cfg?.completedPulseSeconds ?? 1);
    return Math.max(0, sec) * 1000;
  }

  private timeoutPulseMs(): number {
    const cfg = this.platform.config as any;
    const sec = Number(cfg?.interruptedTimeoutPulseSeconds ?? 1);
    return Math.max(0, sec) * 1000;
  }
}
