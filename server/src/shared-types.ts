// It's annoying that TypeScript doesn't itself provide a way to create a runtime list of
// the allowed keys for an interface, so for now, I'll have to settle for repeating things.

export const CommonConditionsKeys = ['time', 'summary', 'icon', 'humidity', 'cloudCover', 'precipIntensity', 'precipIntensityMax',
                                     'precipProbability', 'precipType', 'pressure', 'pressureTrend',
                                     'windDirection', 'windGust', 'windPhrase', 'windSpeed'];

export const AWC_VERSION = '2.8.0';

// The following interfaces represent common interfaces to which all weather services will be
// translated, but most closely coincides with Weather Underground data, especially the icon code.

export enum PressureTrend { FALLING = -1, STEADY, RISING }

export interface CommonConditions {
  time: number;                   // Seconds since 1970-01-01 00:00 UTC (not counting leap seconds)
  summary: string;
  icon: string;
  humidity: number;               // 0-1
  cloudCover: number;             // 0-1
  precipIntensity?: number        // In inch/hour or cm/hour
  precipIntensityMax?: number;    // In inch/hour or cm/hour
  precipProbability?: number;     // 0-1
  precipType?: string;            // 'mixed', 'rain', 'sleet', 'snow'
  pressure?: number;              // inHg or Hectopascals (millibars), at sea level
  pressureTrend?: PressureTrend,
  windDirection?: number;         // 0-360 degrees, N = 0. E = 90, S = 180, W = 270
  windGust?: number;              // In kph or mph
  windPhrase?: string;
  windSpeed?: number;             // In kph or mph
}

export const CurrentConditionsKeys = [...CommonConditionsKeys, 'temperature', 'feelsLikeTemperature'];

export interface CurrentConditions extends CommonConditions {
  temperature: number;          // °C or °F
  feelsLikeTemperature: number; // °C or °F
}

export interface HourlyConditions {
  cloudCover?: number;        // 0-1
  icon: string;
  temperature: number;        // °C or °F
  precipType: string;         // 'mixed', 'rain', 'sleet', 'snow'
  precipProbability: number;  // 0-1
  pressure?: number;          // Hectopascals (millibars), for both metric and imperial modes, at sea level
  time: number;               // See CommonConditions
  windDirection?: number;     // 0-360 degrees, N = 0. E = 90, S = 180, W = 270
  windGust?: number;          // In kph or mph
  windPhrase?: string;
  windSpeed?: number;         // In kph or mph
}

export const DailyConditionsKeys = [...CommonConditionsKeys,
                                    'narrativeDay', 'narrativeEvening', 'temperatureHigh', 'temperatureLow', 'precipAccumulation'];

export interface DailyConditions extends CommonConditions {
  narrativeDay?: string;
  narrativeEvening?: string;
  temperatureHigh: number;      // °C or °F
  temperatureLow: number;       // °C or °F
  precipAccumulation: number;   // inches or cm
}

export const DailySummaryConditionsKeys = ['summary', 'data'];

export interface DailySummaryConditions {
  summary?: string;
  data: DailyConditions[];
}

export const AlertKeys = ['description', 'expires', 'severity', 'title', 'url'];

export interface Alert {
  description: string;
  expires: number;    // See CommonConditions
  severity: 'advisory' | 'watch' | 'warning';
  time: number;       // See CommonConditions
  title: string;
  url?: string;
}

export const ForecastDataKeys = ['latitude', 'longitude', 'timezone', 'currently', 'daily', 'alerts', 'unavailable',
                                 'frequent', 'isMetric', 'source'];

export interface ForecastData {
  latitude?: number;  // Degrees, positive north
  longitude?: number; // Degrees, positive east
  timezone?: string;  // IANA timezone
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
