import { TimeFormat } from './clock';
import { CurrentTemperatureHumidity } from './current-temp-manager';
import { Settings } from './settings';
import { TimeInfo } from '../server/src/shared-types';

export interface AppService {
  forecastHasBeenUpdated(): void;
  getTimeFormat(): TimeFormat;
  getCurrentTime(bias?: number): number;
  getIndoorOption(): string;
  getOutdoorOption(): string;
  getTimeInfo(bias?: number): TimeInfo;
  getApiServer(): string;
  isTimeAccelerated(): boolean;
  proxySensorUpdate(): Promise<boolean>;
  resetGpsState(): void;
  sensorDeadAir(isDead?: boolean): boolean;
  toggleSunMoon(): void;
  updateCurrentTemp(cth: CurrentTemperatureHumidity): void;
  updateTime(hour: number, minute: number, forceRefresh: boolean): void;
  updateSettings(newSettings: Settings): void;
  updateSunriseAndSunset(rise: string, set: string): void;
  updateMarqueeState(isScrolling: boolean): void;
}
