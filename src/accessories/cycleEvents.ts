import { PlatformAccessory, Service } from 'homebridge';
import { LitterRobotPlatform } from '../platform';
import Whisker from '../api/Whisker';
import { LitterRobot } from '../litterRobot';

export class CycleEventsAccessory {
  private accessory: PlatformAccessory;
  private completedSwitch: Service;
  private interruptedSwitch: Service;

  constructor(
    private readonly platform: LitterRobotPlatform,
    private readonly account: Whisker,
    private readonly robot: LitterRobot,
  ) {
    const name = `${robot.name} • Cycle Events`;
    const uuid = this.platform.api.hap.uuid.generate(robot.serialNumber + '-cycle-events');

    this.accessory = this.platform.getOrCreateAccessory(uuid, name);
    this.accessory.category = this.platform.api.hap.Categories.SENSOR;

    this.completedSwitch =
      this.accessory.getService('Cycle Completed') ??
      this.accessory.addService(
        this.platform.Service.StatelessProgrammableSwitch,
        'Cycle Completed',
        'cycle-completed',
      );

    this.interruptedSwitch =
      this.accessory.getService('Cycle Interrupted') ??
      this.accessory.addService(
        this.platform.Service.StatelessProgrammableSwitch,
        'Cycle Interrupted',
        'cycle-interrupted',
      );

    const E = this.platform.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS;
    this.completedSwitch.setCharacteristic(this.platform.Characteristic.ProgrammableSwitchEvent, E);
    this.interruptedSwitch.setCharacteristic(this.platform.Characteristic.ProgrammableSwitchEvent, E);

    this.accessory.getService(this.platform.Service.AccessoryInformation)
      ?.setCharacteristic(this.platform.Characteristic.Manufacturer, 'Whisker')
      .setCharacteristic(this.platform.Characteristic.Model, 'Litter-Robot 4')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.robot.serialNumber);
  }

  pressCompleted() {
    if (this.platform?.config?.debug) this.platform.log.info('[DEBUG] HK event → Cycle Completed');
    this.completedSwitch.updateCharacteristic(
      this.platform.Characteristic.ProgrammableSwitchEvent,
      this.platform.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
    );
  }

  pressInterrupted() {
    if (this.platform?.config?.debug) this.platform.log.info('[DEBUG] HK event → Cycle Interrupted');
    this.interruptedSwitch.updateCharacteristic(
      this.platform.Characteristic.ProgrammableSwitchEvent,
      this.platform.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
    );
  }

  get lastStatusCode(): string | undefined {
    return this.accessory.context.lastStatusCode as string | undefined;
  }
  set lastStatusCode(code: string | undefined) {
    this.accessory.context.lastStatusCode = code;
  }
}
