import { Service, PlatformAccessory } from 'homebridge';
import { LitterRobot } from '../litterRobot';
import { LitterRobotPlatform } from '../platform';
import Whisker from '../api/Whisker';

export class OccupancySensorAccessory {
  private service: Service;
  private accessory: PlatformAccessory;
  private name: string;
  private uuid: string;

  private readonly characteristic = this.platform.Characteristic.OccupancyDetected;

  // Map API/status strings → HomeKit occupancy value
  private readonly STATUS_MAP: Record<string, number> = {
    ROBOT_CAT_DETECT_DELAY: this.characteristic.OCCUPANCY_DETECTED,
    ROBOT_IDLE: this.characteristic.OCCUPANCY_NOT_DETECTED,
  };

  private state = {
    isOccupied: this.characteristic.OCCUPANCY_NOT_DETECTED,
  };

  constructor(
    private readonly platform: LitterRobotPlatform,
    private readonly account: Whisker,
    private readonly robot: LitterRobot,
  ) {
    this.name = `${this.robot.name} Cat Sensor`;
    this.uuid = this.robot.uuid.occupancySensor;

    this.accessory = this.platform.getOrCreateAccessory(this.uuid, this.name);

    this.service =
      this.accessory.getService(this.platform.Service.OccupancySensor) ??
      this.accessory.addService(this.platform.Service.OccupancySensor);

    this.service
      .getCharacteristic(this.platform.Characteristic.OccupancyDetected)
      .onGet(this.handleOccupancyDetectedGet.bind(this));
  }

  /** Update from device payload */
  public update(catDetectValue: string): void {
    const key = (catDetectValue ?? '').toString().trim().toUpperCase();
    const newValue =
      this.STATUS_MAP[key] ?? this.characteristic.OCCUPANCY_NOT_DETECTED;

    if (this.state.isOccupied !== newValue) {
      this.platform.log.debug('Updating %s Occupancy -> %s', this.name, newValue ? 'DETECTED' : 'NOT_DETECTED');
      this.state.isOccupied = newValue;
      this.service.updateCharacteristic(this.platform.Characteristic.OccupancyDetected, newValue);
    }
  }

  /** GET handler for OccupancyDetected */
  private handleOccupancyDetectedGet(): number {
    this.platform.log.debug('Triggered GET OccupancyDetected');
    return this.state.isOccupied;
  }
}
