
import { CurrentTemperatureHumidity } from './current-temp-manager';
import { Settings } from './settings';
import { TimeInfo } from '../server/src/time-types';

export const DEV_URL = 'http://localhost:4201';

export interface AppService {
  forecastHasBeenUpdated(): void;
  getCurrentTime(bias?: number): number;
  getIndoorOption(): string;
  getOutdoorOption(): string;
  getTimeInfo(bias?: number): TimeInfo;
  getWeatherServer(): string;
  isTimeAccelerated(): boolean;
  proxySensorUpdate(): Promise<boolean>;
  sensorDeadAir(isDead?: boolean): boolean;
  updateCurrentTemp(cth: CurrentTemperatureHumidity): void;
  updateTime(hour: number, minute: number, forceRefresh: boolean): void;
  updateSettings(newSettings: Settings);
  updateSunriseAndSunset(rise: string, set: string);
  updateMarqueeState(isScrolling: boolean);
}
