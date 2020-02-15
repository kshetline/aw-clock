import { Settings } from './settings';
import { TimeInfo } from '../server/src/time-poller';

export interface CurrentConditions {
  temperature: number;
  humidity: number;
}

export interface AppService {
  forecastHasBeenUpdated(): void;
  getCurrentTime(bias?: number): number;
  getForecastCurrentConditions(): CurrentConditions;
  getIndoorOption(): string;
  getOutdoorOption(): string;
  getSensorCurrentConditions(): CurrentConditions;
  getTimeInfo(bias?: number): TimeInfo;
  getWeatherServer(): string;
  isTimeAccelerated(): boolean;
  setForecastCurrentConditions(conditions: CurrentConditions): void;
  setSensorCurrentConditions(conditions: CurrentConditions): void;
  updateTime(hour: number, minute: number, forceRefresh: boolean): void;
  updateSettings(newSettings: Settings);
  updateSunriseAndSunset(rise: string, set: string);
  updateMarqueeState(isScrolling: boolean);
}
