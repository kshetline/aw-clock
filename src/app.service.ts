import { CurrentTemperatureHumidity } from './current-temp-manager';
import { Settings } from './settings';
import { TimeInfo } from '../server/src/shared-types';

export interface AppService {
  forecastHasBeenUpdated(): void;
  getAmPm(): boolean;
  getCurrentTime(bias?: number): number;
  getIndoorOption(): string;
  getOutdoorOption(): string;
  getTimeInfo(bias?: number): TimeInfo;
  getApiServer(): string;
  isTimeAccelerated(): boolean;
  proxySensorUpdate(): Promise<boolean>;
  sensorDeadAir(isDead?: boolean): boolean;
  updateCurrentTemp(cth: CurrentTemperatureHumidity): void;
  updateTime(hour: number, minute: number, forceRefresh: boolean): void;
  updateSettings(newSettings: Settings);
  updateSunriseAndSunset(rise: string, set: string);
  updateMarqueeState(isScrolling: boolean);
}
