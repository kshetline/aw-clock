import { requestJson } from 'by-request';
import { Request } from 'express';
import { toNumber } from 'ks-util';
import { ForecastData } from './shared-types';

interface WeatherBitCurrent {
  data: {
    state_code: string;
    city_name: string;
    country_code: string;
    timezone: string;
    lat: number;
    lon: number;
    temp: number;
    app_temp: number;
    rh: number;
    clouds: number;
    precip: number;
    weather: {
      icon: string;
      code: string;
      description: string;
    },
    datetime: string;
    ts: number;
  }[];
}

interface WeatherBitHourly {
  data: {
    app_temp: number;
    snow_depth: number;
    pop: number;
    clouds: number;
    pod: string;
    weather: {
      icon: string;
      code: string;
      description: string;
    },
    precip: number;
    timestamp_local: string;
    timestamp_utc: string;
    temp: number;
    ts: number;
  }[];
  state_code: string;
  city_name: string;
  country_code: string;
  lat: number;
  lon: number;
  time_zone: string;
}

interface WeatherBitDaily {
  data: {
    high_temp: number;
    low_temp: number;
    max_temp: number;
    min_temp: number;
    app_temp: number;
    rh: number;
    snow_depth: number;
    pop: number;
    clouds: number;
    weather: {
      icon: string;
      code: string;
      description: string;
    },
    precip: number;
    valid_date: string;
    temp: number;
    ts: number;
  }[];
  state_code: string;
  city_name: string;
  country_code: string;
  lat: number;
  lon: number;
  time_zone: string;
}

interface WeatherBitAlerts {
  alerts: {
    title: string;
    description: string;
    severity: string; // "Advisory", "Watch", or "Warning".
    effective_utc: string;
    effective_local: string;
    expires_utc: string;
    expires_local: string;
    uri: string
    regions: string[];
  }[];
  state_code: string;
  city_name: string;
  country_code: string;
  lat: number;
  lon: number;
  time_zone: string;
}

/* eslint-disable object-property-newline */
const icons: Record<string, string> = {
  t01d: '37;38', t01n: '47;38', t02d: '37;38', t02n: '47;38', t03d: '37;38', t03n: '47;38',
  t04d: '37;38', t04n: '47;38', t05d: '37;38', t05n: '47;38',

  d01d: '39', d01n: '39', d02d: '39', d02n: '39', d03d: '39', d03n: '39',

  f01d: '18', f01n: '18',

  r01d: '39', r01n: '39', r02d: '40', r02n: '40', r03d: '40', r03n: '40',
  r04d: '45d', r04n: '45', r05d: '45d', r05n: '45', r06d: '45d', r06n: '45',

  s01d: '41', s01n: '46', s02d: '16', s02n: '16', s03d: '16', s03n: '16',
  s04d: '07', s04n: '07', s05d: '06', s05n: '06', s06d: '06', s06n: '06',

  a01d: 'mist', a01n: 'mist', a02d: 'smoke', a02n: 'smoke', a03d: 'haze', a03n: 'haze',
  a04d: 'dust', a04n: 'dust', a05d: 'fog', a05n: 'fog', a06d: 'frz-fog', a06n: 'frz-fog',

  c01d: '36', c01n: '31', c02d: '30', c02n: '33', c03d: '28', c03n: '27',
  c04d: '26', c04n: '26',

  u00d: '40', u00n: '40',
};
/* eslint-enable object-property-newline */

export async function getForecast(req: Request): Promise<ForecastData | Error> {
  const isMetric = (req.query.du === 'c');
  const baseUrl = 'https://weatherbit-v1-mashape.p.rapidapi.com/*' +
    `?lat=${req.query.lat}&lon=${req.query.lon}&units=${isMetric ? 'M' : 'I'}`;
  const headers = {
    'x-rapidapi-host': 'weatherbit-v1-mashape.p.rapidapi.com',
    'x-rapidapi-key': process.env.AWC_WEATHERBIT_API_KEY
  };
  const options = { headers };

  try {
    const currentWeather = (await requestJson(baseUrl.replace('*', 'current'), options)) as WeatherBitCurrent;
    const hourlyForecast = (await requestJson(baseUrl.replace('*', 'forecast/hourly') + '&hours=30', options)) as WeatherBitHourly;
    const dailyForecast = (await requestJson(baseUrl.replace('*', 'forecast/daily') + '&days=9', options)) as WeatherBitDaily;
    const alerts = (await requestJson(baseUrl.replace('*', 'alerts'), options)) as WeatherBitAlerts;

    return convertForecast(currentWeather, hourlyForecast, dailyForecast, alerts, isMetric);
  }
  catch (err) {
    return new Error('Error connecting to Dark Sky: ' + err);
  }
}

function convertIcon(iconCode: string, cloudCover: number): string {
  let icon = icons[iconCode] ?? 'unknown';

  if (icon.includes(';'))
    icon = icon.split(';')[cloudCover >= 80 ? 1 : 0];

  return icon;
}

function getPrecipType(code: string): string {
  const c = toNumber(code);

  if ((600 <= c && c <= 602) || (621 <= c && c <= 623))
    return 'snow';
  else if (c === 610)
    return 'mixed';
  else if (c === 611 || c === 612)
    return 'sleet';

  return 'rain';
}

function convertForecast(current: WeatherBitCurrent, hourly: WeatherBitHourly, daily: WeatherBitDaily,
    alerts: WeatherBitAlerts, isMetric: boolean): ForecastData {
  const currentData = current.data[0];
  const forecast: ForecastData = { source: 'weatherbit', isMetric, timezone: currentData.timezone };

  forecast.currently = {
    cloudCover: currentData.clouds / 100,
    feelsLikeTemperature: currentData.app_temp,
    humidity: currentData.rh,
    icon: convertIcon(currentData.weather?.icon, currentData.clouds),
    precipIntensity: currentData.precip,
    precipType: getPrecipType(currentData.weather.code),
    summary: currentData.weather?.description,
    temperature: currentData.temp,
    time: currentData.ts
  };

  forecast.hourly = [];
  hourly.data.forEach(hour => forecast.hourly.push({
    cloudCover: hour.clouds / 100,
    icon: convertIcon(hour.weather?.icon, hour.clouds),
    precipType: getPrecipType(hour.weather?.code),
    temperature: hour.temp,
    time: hour.ts
  }));

  forecast.daily = { data: [] };
  daily.data.forEach(day => forecast.daily.data.push({
    cloudCover: day.clouds / 100,
    humidity: day.rh,
    icon: convertIcon(day.weather?.icon, day.clouds),
    precipAccumulation: day.precip / (isMetric ? 10 : 1),
    precipProbability: day.pop / 100,
    precipType: getPrecipType(day.weather?.code),
    summary: currentData.weather?.description,
    temperatureHigh: day.high_temp,
    temperatureLow: day.low_temp,
    time: day.ts
  }));

  forecast.alerts = [];

  return forecast;
}
