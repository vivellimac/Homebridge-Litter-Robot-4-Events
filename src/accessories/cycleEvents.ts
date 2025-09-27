import { PlatformAccessory, Service } from 'homebridge';
import { LitterRobotPlatform } from '../platform';
import Whisker from '../api/Whisker';
import { LitterRobot } from '../litterRobot';

export class CycleEventsAccessory {
  private completedAccessory: PlatformAccessory;
  private interruptedAccessory: PlatformAccessory;
  private completedSwitch: Service;
  private interruptedSwitch: Service;

  constructor(
    private readonly platform: LitterRobotPlatform,
    private readonly account: Whisker,
    private readonly robot: LitterRobot,
  ) {
    // Accessory 1: Cycle Completed
    const completedName = `${robot.name} • Cycle Completed`;
    const completedUUID = this.platform.api.hap.uuid.generate(robot.serialNumber + '-cycle-completed');
    this.completedAccessory = this.platform.getOrCreateAccessory(completedUUID, completedName);
    this.completedAccessory.category = this.platform.api.hap.Categories.SENSOR;

    this.completedSwitch =
      this.completedAccessory.getService('Cycle Completed') ??
      this.completedAccessory.addService(
        this.platform.Service.StatelessProgrammableSwitch,
        'Cycle Completed',
        'cycle-completed',
      );

    this.completedSwitch.setCharacteristic(
      this.platform.Characteristic.ConfiguredName,
      'Cycle Completed',
    );
    this.completedSwitch.setCharacteristic(
      this.platform.Characteristic.ProgrammableSwitchEvent,
      this.platform.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
    );

    this.completedAccessory
      .getService(this.platform.Service.AccessoryInformation)
      ?.setCharacteristic(this.platform.Characteristic.Manufacturer, 'Whisker')
      .setCharacteristic(this.platform.Characteristic.Model, 'Litter-Robot 4')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.robot.serialNumber);

    // Accessory 2: Cycle Interrupted
    const interruptedName = `${robot.name} • Cycle Interrupted`;
    const interruptedUUID = this.platform.api.hap.uuid.generate(robot.serialNumber + '-cycle-interrupted');
    this.interruptedAccessory = this.platform.getOrCreateAccessory(interruptedUUID, interruptedName);
    this.interruptedAccessory.category = this.platform.api.hap.Categories.SENSOR;

    this.interruptedSwitch =
      this.interruptedAccessory.getService('Cycle Interrupted') ??
      this.interruptedAccessory.addService(
        this.platform.Service.StatelessProgrammableSwitch,
        'Cycle Interrupted',
        'cycle-interrupted',
      );

    this.interruptedSwitch.setCharacteristic(
      this.platform.Characteristic.ConfiguredName,
      'Cycle Interrupted',
    );
    this.interruptedSwitch.setCharacteristic(
      this.platform.Characteristic.ProgrammableSwitchEvent,
      this.platform.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
    );

    this.interruptedAccessory
      .getService(this.platform.Service.AccessoryInformation)
      ?.setCharacteristic(this.platform.Characteristic.Manufacturer, 'Whisker')
      .setCharacteristic(this.platform.Characteristic.Model, 'Litter-Robot 4')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.robot.serialNumber);
  }

  // Fire HomeKit events
  pressCompleted() {
    if (this.platform?.config?.debug)
      this.platform.log.info('[DEBUG] HK event → Cycle Completed');
    this.completedSwitch.updateCharacteristic(
      this.platform.Characteristic.ProgrammableSwitchEvent,
      this.platform.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
    );
  }

  pressInterrupted() {
    if (this.platform?.config?.debug)
      this.platform.log.info('[DEBUG] HK event → Cycle Interrupted');
    this.interruptedSwitch.updateCharacteristic(
      this.platform.Characteristic.ProgrammableSwitchEvent,
      this.platform.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
    );
  }

  // Persist last status across restarts (store on the Completed accessory context)
  get lastStatusCode(): string | undefined {
    return this.completedAccessory.context.lastStatusCode as string | undefined;
  }
  set lastStatusCode(code: string | undefined) {
    this.completedAccessory.context.lastStatusCode = code;
  }
}
