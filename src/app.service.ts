import { CurrentTemperatureHumidity, TimeFormat } from './shared-types';
import { AlertFilter, HiddenAlert, Settings } from './settings';
import { AwcDefaults, TimeInfo } from '../server/src/shared-types';
import { Timezone } from '@tubular/time';

export interface AppService {
  forecastHasBeenUpdated(): void;
  getAlarmTime(): number;
  getApiServer(): string;
  getCurrentTime(bias?: number): number;
  getAlertFilters(): AlertFilter[];
  getHiddenAlerts(): HiddenAlert[];
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
  updateHiddenAlerts(hidden: HiddenAlert[]): void;
  updateTime(hour: number, minute: number, forceRefresh: boolean): void;
  updateSettings(newSettings?: Settings): void;
  updateSunriseAndSunset(rise: string, set: string): void;
  updateMarqueeState(isScrolling: boolean): void;
}
