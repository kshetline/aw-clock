// Using `import` instead causes webpack to fail, at least with some older versions of Node.js.
const { version } = require('../package.json');

// It's annoying that TypeScript doesn't itself provide a way to create a runtime list of
// the allowed keys for an interface, so for now, I'll have to settle for repeating things.

export const CommonConditionsKeys = ['time', 'summary', 'icon', 'humidity', 'cloudCover', 'precipIntensity', 'precipIntensityMax',
                                     'precipProbability', 'precipType', 'pressure', 'pressureTrend', 'temperature',
                                     'windDirection', 'windGust', 'windPhrase', 'windSpeed', 'aqiEu', 'aqiUs', 'aqComps'];
let altVersion = '';

try {
  if (typeof process !== 'undefined')
    altVersion = process.env.AWC_FAKE_CURRENT_VERSION;
  else if (typeof window !== 'undefined')
    altVersion = (window.location.href.match(/[?&]fake-ver=(.*?)(&|$)/)[0] || '').substring(10);
}
catch {}

export const AWC_VERSION = altVersion || version;
export const BACK_IN_TIME_THRESHOLD = 4000;

// The following interfaces represent common interfaces to which all weather services will be
// translated, but most closely coincides with Weather Underground data, especially the icon code.

export enum PressureTrend { FALLING = -1, STEADY, RISING }

export interface AirQualitySource {
  aqiEu?: number;
  aqiUs?: number
}

export interface AirQualityValues extends AirQualitySource {
  raw: number; // In μg/m³
}

export interface AirQualityRawComponents { // All in μg/m³
  co: number;
  no2: number;
  o3: number;
  so2?: number;
  pm2_5: number;
  pm10: number;
}

export interface AirQualityComponents {
  co: AirQualityValues;
  no2: AirQualityValues;
  o3: AirQualityValues;
  so2?: AirQualityValues;
  pm2_5: AirQualityValues;
  pm10: AirQualityValues;
}

export interface AirQualityItem extends AirQualitySource {
  aqComps?: AirQualityComponents,
  time: number
}

export interface AirQualityForecast {
  current: {
    aqiEu?: number;
    aqiUs?: number;
    aqComps?: AirQualityRawComponents,
    time: number
  },
  hours: AirQualityItem[];
  unavailable?: boolean;
}

export interface CommonConditions extends AirQualitySource {
  time: number;                   // Seconds since 1970-01-01 00:00 UTC (not counting leap seconds)
  summary: string;
  icon: string;
  humidity: number;               // 0-1
  cloudCover: number;             // 0-1
  precipIntensity?: number        // In inch/hour or cm/hour
  precipIntensityMax?: number;    // In inch/hour or cm/hour
  precipProbability?: number;     // 0-1
  precipType?: string;            // 'mixed', 'rain', 'sleet', 'snow'
  precipTypeFromHour?: boolean;
  pressure?: number;              // inHg or Hectopascals (millibars), at sea level
  pressureTrend?: PressureTrend,
  windDirection?: number;         // 0-360 degrees, N = 0. E = 90, S = 180, W = 270
  temperature?: number;           // °C or °F
  windGust?: number;              // In kph or mph
  windPhrase?: string;
  windSpeed?: number;             // In kph or mph
  aqComps?: AirQualityComponents;
}

export const CurrentConditionsKeys = [...CommonConditionsKeys, 'feelsLikeTemperature'];

export interface CurrentConditions extends CommonConditions {
  feelsLikeTemperature: number; // °C or °F
}

export interface HourlyConditions extends AirQualitySource {
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
  aqComps?: AirQualityComponents;
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

export interface DailySummaryConditions {
  summary?: string;
  data: DailyConditions[];
}

export interface Alert {
  description: string;
  expires: number;    // See CommonConditions
  id?: string;
  severity: 'info' | 'advisory' | 'watch' | 'warning';
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
  knots?: boolean;
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
  serverError?: string;
}

export interface GpsData {
  altitude?: number; // in meters
  averageSNR?: number; // in dBHz
  city?: string;
  error?: string;
  estimatedPositionError?: number; // max of epx and epy, in meters.
  fix: number; // 0 = invalid, 1 = GPS, 2 = DGPS
  goodGpsReach?: boolean; // Did at least one of the last time polls have good PPS?
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

export interface AwcDefaults {
  allowAdmin: boolean;
  city?: string;
  currentVersion: string;
  indoorOption: string;
  ip: string;
  latestVersion: string;
  latestVersionInfo?: string;
  latitude?: number;
  longitude?: number;
  outdoorOption: string;
  services?: string;
  updateAvailable: boolean;
}
