import type { API } from 'homebridge';
import { PLATFORM_NAME } from './settings';
import { LitterRobotPlatform } from './platform';

/** Homebridge entrypoint hook */
export = (api: API): void => {
  api.registerPlatform(PLATFORM_NAME, LitterRobotPlatform);
};
