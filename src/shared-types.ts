export enum HourlyForecast { NONE = 'N', CIRCULAR = 'C', VERTICAL = 'V' }

export enum TimeFormat { HR24, AMPM, UTC }

export interface CurrentTemperatureHumidity {
  forecastFeelsLike?: number;
  forecastHumidity?: number;
  forecastStale?: boolean;
  forecastTemp?: number;
  indoorHumidity?: number;
  indoorTemp?: number;
  outdoorHumidity?: number;
  outdoorTemp?: number;
  sensorTempDetail?: string;
  celsius?: boolean;
}

export interface Rect {
  x: number;
  y: number;
  h: number;
  w: number;
}
