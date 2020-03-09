// It's annoying that TypeScript doesn't itself provide a way to create a runtime list of
// the allowed keys for an interface, so for now, I'll have to settle for repeating things.

export const CommonConditionsKeys = ['time', 'summary', 'icon', 'humidity', 'cloudCover', 'precipIntensity', 'precipIntensityMax',
                                     'precipProbability', 'precipType'];

export interface CommonConditions {
  time: number;
  summary: string;
  icon: string;
  humidity: number;
  cloudCover: number;
  precipIntensity?: number
  precipIntensityMax?: number;
  precipProbability: number;
  precipType?: string;
}

export const CurrentConditionsKeys = Array.from(CommonConditionsKeys);
CurrentConditionsKeys.push('temperature', 'feelsLikeTemperature');

export interface CurrentConditions extends CommonConditions {
  temperature: number;
  feelsLikeTemperature: number;
}

export const DailyConditionsKeys = Array.from(CommonConditionsKeys);
DailyConditionsKeys.push('temperatureHigh', 'temperatureLow', 'precipAccumulation');

export interface DailyConditions extends CommonConditions {
  temperatureHigh: number;
  temperatureLow: number;
  precipAccumulation: number;
}

export const DailySummaryConditionsKeys = ['summary', 'data'];

export interface DailySummaryConditions {
  summary?: string;
  data: DailyConditions[];
}

export const AlertKeys = ['description', 'expires', 'severity', 'title', 'url'];

export interface Alert {
  description: string;
  expires: number;
  severity: 'advisory' | 'watch' | 'warning';
  time: number;
  title: string;
  url: string;
}

export const ForecastDataKeys = ['latitude', 'longitude', 'timezone', 'currently', 'daily', 'alerts', 'forecastUnavailable',
                                 'frequent', 'isMetric', 'source'];

export interface ForecastData {
  latitude: number;
  longitude: number;
  timezone: string;
  currently?: CurrentConditions;
  daily?: DailySummaryConditions;
  alerts?: Alert[];
  forecastUnavailable?: boolean;
  frequent?: boolean;
  isMetric?: boolean;
  source?: string;
}
