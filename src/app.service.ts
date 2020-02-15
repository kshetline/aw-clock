import { Settings } from './settings';
import { TimeInfo } from '../server/src/time-poller';

export interface AppService {
  getCurrentTime(bias?: number): number;
  getIndoorOption(): string;
  getOutdoorOption(): string;
  getTimeInfo(bias?: number): TimeInfo;
  getWeatherServer(): string;
  isTimeAccelerated(): boolean;
  updateTime(hour: number, minute: number, forceRefresh: boolean): void;
  updateSettings(newSettings: Settings);
  forecastHasBeenUpdated(): void;
  updateSunriseAndSunset(rise: string, set: string);
  updateMarqueeState(isScrolling: boolean);
}
