import { purgeCache, requestJson } from './request-cache';
import { Request } from 'express';
import { toBoolean, toNumber } from 'ks-util';
import { Alert, ForecastData } from './shared-types';
import { checkForecastIntegrity, escapeForRegex, fToC, inchesToCm } from './util';

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

interface WeatherBitAlert {
  title: string;
  description: string;
  severity: string; // "Advisory", "Watch", or "Warning".
  effective_utc: string;
  effective_local: string;
  expires_utc: string;
  expires_local: string;
  uri: string
  regions: string[];
}

interface WeatherBitAlerts {
  alerts: WeatherBitAlert[];
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
  const currentOnly = toBoolean(req.query.co, false, true);
  // Because of the way Weatherbit.io data is cached some weirdly inconsistent results come back for the same
  // forecast time and place, simply because different units (imperial or metric) are requested. So we'll always
  // request imperial (where temperatures have greater granularity, since °F are smaller than °C) and convert
  // to metric as needed.
  const baseUrl = `https://weatherbit-v1-mashape.p.rapidapi.com/*?lat=${req.query.lat}&lon=${req.query.lon}&units=I`;
  const headers = {
    'x-rapidapi-host': 'weatherbit-v1-mashape.p.rapidapi.com',
    'x-rapidapi-key': process.env.AWC_WEATHERBIT_API_KEY
  };
  const options = { headers };
  let url = '';

  try {
    // noinspection JSUnusedAssignment
    const currentWeather = (await requestJson(240, url = baseUrl.replace('*', 'current'), options)) as WeatherBitCurrent;
    let hourlyForecast: WeatherBitHourly;
    let dailyForecast: WeatherBitDaily;
    let alerts: WeatherBitAlerts;

    if (!currentOnly) {
      // noinspection JSUnusedAssignment (actually, this is used... IF there's an error)
      hourlyForecast = (await requestJson(3600, url = baseUrl.replace('*', 'forecast/hourly') + '&hours=30', options)) as WeatherBitHourly;
      // noinspection JSUnusedAssignment
      dailyForecast = (await requestJson(21600, url = baseUrl.replace('*', 'forecast/daily') + '&days=9', options)) as WeatherBitDaily;
      // Alert text isn't sensitive to the `units` parameter. Text comes back using whatever format
      // and units the alerts were issued using by the local weather authorities.
      // noinspection JSUnusedAssignment
      alerts = (await requestJson(2600, url = baseUrl.replace('*', 'alerts'), options)) as WeatherBitAlerts;
    }

    const forecast = convertForecast(currentWeather, hourlyForecast, dailyForecast, alerts, isMetric);

    if (checkForecastIntegrity(forecast, currentOnly))
      return forecast;

    const parts = baseUrl.split('*');
    const pattern = new RegExp('^' + escapeForRegex(parts[0]) + '.+' + escapeForRegex(parts[1]));

    purgeCache(pattern);

    return new Error('Error retrieving Weatherbit.io data');
  }
  catch (err) {
    return new Error(`Error connecting to Weatherbit.io: ${url}, ${err}`);
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

function conditionalCelsius(f: number, isMetric: boolean): number {
  return isMetric ? fToC(f) : f;
}

function conditionalCm(i: number, isMetric: boolean): number {
  return isMetric ? inchesToCm(i) : i;
}

function convertForecast(current: WeatherBitCurrent, hourly: WeatherBitHourly, daily: WeatherBitDaily,
    alerts: WeatherBitAlerts, isMetric: boolean): ForecastData {
  const currentData = current.data[0];
  const forecast: ForecastData = { source: 'weatherbit', isMetric, timezone: currentData.timezone };

  forecast.city = `${current.data[0].city_name}, ${current.data[0].state_code}, ${current.data[0].country_code}`;

  forecast.currently = {
    cloudCover: currentData.clouds / 100,
    feelsLikeTemperature: conditionalCelsius(currentData.app_temp, isMetric),
    humidity: currentData.rh / 100,
    icon: convertIcon(currentData.weather?.icon, currentData.clouds),
    precipIntensity: conditionalCm(currentData.precip, isMetric),
    precipType: getPrecipType(currentData.weather.code),
    summary: currentData.weather?.description,
    temperature: conditionalCelsius(currentData.temp, isMetric),
    time: currentData.ts
  };

  forecast.hourly = [];

  if (hourly) {
    hourly.data.forEach(hour => forecast.hourly.push({
      cloudCover: hour.clouds / 100,
      icon: convertIcon(hour.weather?.icon, hour.clouds),
      precipProbability: hour.pop / 100,
      precipType: getPrecipType(hour.weather?.code),
      temperature: conditionalCelsius(hour.temp, isMetric),
      time: hour.ts
    }));
  }

  forecast.daily = { data: [] };

  if (daily) {
    daily.data.forEach(day => forecast.daily.data.push({
      cloudCover: day.clouds / 100,
      humidity: day.rh / 100,
      icon: convertIcon(day.weather?.icon, day.clouds),
      narrativeDay: day.weather?.description,
      precipAccumulation: conditionalCm(day.precip, isMetric),
      precipProbability: day.pop / 100,
      precipType: getPrecipType(day.weather?.code),
      summary: day.weather?.description,
      temperatureHigh: conditionalCelsius(day.high_temp, isMetric),
      temperatureLow: conditionalCelsius(day.low_temp, isMetric),
      time: day.ts
    }));
  }

  forecast.alerts = [];

  if (alerts) {
    const now = Date.now();
    const alertsByTitle = new Map<string, WeatherBitAlert>();

    // Filter out expired and duplicate alerts
    alerts.alerts.forEach(alert => {
      const title = alert.title;
      const alertEffective = Date.parse(alert.effective_utc);
      const alertExpired = Date.parse(alert.expires_utc);

      if (alertExpired > now && (!alertsByTitle.has(title) || Date.parse(alertsByTitle.get(title).effective_utc) > alertEffective))
        alertsByTitle.set(title, alert);
    });

    alertsByTitle.forEach(alert => forecast.alerts.push({
      description: alert.description,
      expires: Date.parse(alert.expires_utc) / 1000,
      severity: alert.severity.toLowerCase() as Alert['severity'],
      time: Date.parse(alert.effective_utc) / 1000,
      title: alert.title,
      url: alert.uri
    }));
  }

  return forecast;
}
