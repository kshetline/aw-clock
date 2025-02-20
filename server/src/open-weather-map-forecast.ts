import { Request } from 'express';
import { AirQualityForecast } from './shared-types';
import { purgeCache, requestJson } from './request-cache';
import { calculateAqiEu, calculateAqiUs, filterError } from './awcs-util';

function checkIntegrity(forecast: AirQualityForecast): boolean {
  if (!forecast?.list || forecast.list.length === 0)
    return false;

  for (const item of forecast.list) {
    if (item?.main?.aqi != null) {
      item.aqi = item.main.aqi;
      delete item.main;
    }

    if (item.aqi == null || item.components == null || item.aqi < 1 || item.aqi > 5)
      return false;

    item.aqiUs = calculateAqiUs(item.components);
    item.aqiEu = calculateAqiEu(item.components);
  }

  return true;
}

export async function getForecast(req: Request): Promise<AirQualityForecast | Error> {
  const url = 'https://api.openweathermap.org/data/2.5/air_pollution/forecast' +
    `?lat=${req.query.lat}&lon=${req.query.lon}` +
    `&appid=${process.env.AWC_OPEN_WEATHER_MAP_API_KEY}`;

  try {
    const forecast = (await requestJson(3600, url)) as AirQualityForecast;

    if (checkIntegrity(forecast))
      return forecast;

    purgeCache(url);
    return new Error('Error retrieving Open Weather Map data');
  }
  catch (err) {
    purgeCache(url);
    return new Error('Error connecting to Open Weather Map: ' + filterError(err));
  }
}
