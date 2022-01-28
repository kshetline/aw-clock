import { CurrentTemperatureHumidity, TimeFormat } from './shared-types';
import { Settings } from './settings';
import { TimeInfo } from '../server/src/shared-types';

export interface AppService {
  forecastHasBeenUpdated(): void;
  getApiServer(): string;
  getTimeFormat(): TimeFormat;
  getCurrentTime(bias?: number): number;
  getIndoorOption(): string;
  getOutdoorOption(): string;
  getTimeInfo(bias?: number): TimeInfo;
  getWeatherOption(): string;
  isTimeAccelerated(): boolean;
  proxySensorUpdate(): Promise<boolean>;
  resetGpsState(): void;
  sensorDeadAir(isDead?: boolean): boolean;
  settings: Settings;
  toggleSunMoon(): void;
  updateCurrentTemp(cth: CurrentTemperatureHumidity): void;
  updateTime(hour: number, minute: number, forceRefresh: boolean): void;
  updateSettings(newSettings: Settings): void;
  updateSunriseAndSunset(rise: string, set: string): void;
  updateMarqueeState(isScrolling: boolean): void;
}
