// It's annoying that TypeScript doesn't itself provide a way to create a runtime list of
// the allowed keys for an interface, so for now, I'll have to settle for repeating things.

export const CommonConditionsKeys = ['time', 'summary', 'icon', 'humidity', 'cloudCover', 'precipIntensity', 'precipIntensityMax',
                                     'precipProbability', 'precipType'];

export const AWC_VERSION = '2.7.1';

export interface CommonConditions {
  time: number;
  summary: string;
  icon: string;
  humidity: number;
  cloudCover: number;
  precipIntensity?: number
  precipIntensityMax?: number;
  precipProbability?: number;
  precipType?: string;
}

export const CurrentConditionsKeys = [...CommonConditionsKeys, 'temperature', 'feelsLikeTemperature'];

export interface CurrentConditions extends CommonConditions {
  temperature: number;
  feelsLikeTemperature: number;
}

export interface HourlyConditions {
  cloudCover?: number;
  icon: string;
  temperature: number;
  precipType: string;
  precipProbability: number;
  time: number;
}

export const DailyConditionsKeys = [...CommonConditionsKeys,
                                    'narrativeDay', 'narrativeEvening', 'temperatureHigh', 'temperatureLow', 'precipAccumulation'];

export interface DailyConditions extends CommonConditions {
  narrativeDay?: string;
  narrativeEvening?: string;
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
  url?: string;
}

export const ForecastDataKeys = ['latitude', 'longitude', 'timezone', 'currently', 'daily', 'alerts', 'unavailable',
                                 'frequent', 'isMetric', 'source'];

export interface ForecastData {
  latitude?: number;
  longitude?: number;
  timezone?: string;
  city?: string;
  currently?: CurrentConditions;
  hourly?: HourlyConditions[];
  daily?: DailySummaryConditions;
  alerts?: Alert[];
  unavailable?: boolean;
  frequent?: boolean;
  isMetric?: boolean;
  source?: string;
}

export interface DhtSensorData {
  temperature: number;
  humidity: number;
  error?: string;
}

export interface TempHumidityItem {
  batteryLow: boolean;
  channel: string;
  humidity: number;
  reliable: boolean;
  signalQuality: number;
  temperature: number;
  time: number;
}

export interface TempHumidityData {
  A?: TempHumidityItem;
  B?: TempHumidityItem;
  C?: TempHumidityItem;
  deadAir?: boolean;
  error?: string;
}

export interface GpsData {
  altitude?: number; // in meters
  averageSNR?: number, // in dBHz
  city?: string;
  error?: string,
  estimatedPositionError?: number, // max of epx and epy, in meters.
  fix: number; // 0 = invalid, 1 = GPS, 2 = DGPS
  latitude?: number;
  longitude?: number;
  ntpFallback?: boolean;
  pps?: boolean;
  satellites?: number;
  signalQuality: number;
  timezone?: string;
}

export interface CurrentDelta {
  delta: number;
  dut1: number[] | null;
  pendingLeap: number;
  pendingLeapDate: string;
}

export interface TimeInfo {
  time: number;
  leapSecond: number;
  leapExcess: number;
  text: string;
  fromGps?: boolean;
}
