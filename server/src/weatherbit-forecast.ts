import { requestJson } from 'by-request';
import { Request } from 'express';
import {
  // Alert, AlertKeys,
  // CommonConditions,
  // CurrentConditions,
  // CurrentConditionsKeys,
  // DailyConditions, DailyConditionsKeys, DailySummaryConditions, DailySummaryConditionsKeys,
  ForecastData,
//  ForecastDataKeys, HourlyConditions
} from './shared-types';

interface WeatherBitCurrent {
  data: {
    state_code: string;
    city_name: string;
    country_code: string;
    time_zone: string;
    lat: number;
    lon: number;
    temp: number;
    app_temp: number;
    rh: number;
    clouds: number;
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

    console.log(JSON.stringify(currentWeather, null, 2));
    console.log(JSON.stringify(hourlyForecast, null, 2));
    console.log(JSON.stringify(dailyForecast, null, 2));
    console.log(JSON.stringify(alerts, null, 2));
    return null;
    // return convertForecast(origForecast, isMetric);
  }
  catch (err) {
    return new Error('Error connecting to Dark Sky: ' + err);
  }
}
