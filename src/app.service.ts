import { CurrentTemperatureHumidity, TimeFormat } from './shared-types';
import { Settings } from './settings';
import { AwcDefaults, TimeInfo } from '../server/src/shared-types';
import { Timezone } from '@tubular/time';

export interface AppService {
  forecastHasBeenUpdated(): void;
  getApiServer(): string;
  getCurrentTime(bias?: number): number;
  getIndoorOption(): string;
  getLatestDefaults(): AwcDefaults;
  getOutdoorOption(): string;
  getTimeFormat(): TimeFormat;
  getTimeInfo(bias?: number): TimeInfo;
  getWeatherOption(): string;
  isTimeAccelerated(): boolean;
  proxySensorUpdate(): Promise<boolean>;
  resetGpsState(): void;
  sensorDeadAir(isDead?: boolean): boolean;
  showConstellations: boolean;
  showSkyColors: boolean;
  skyFacing: number;
  timezone: Timezone;
  toggleSunMoon(): void;
  updateCurrentTemp(cth: CurrentTemperatureHumidity): void;
  updateTime(hour: number, minute: number, forceRefresh: boolean): void;
  updateSettings(newSettings: Settings): void;
  updateSunriseAndSunset(rise: string, set: string): void;
  updateMarqueeState(isScrolling: boolean): void;
}
