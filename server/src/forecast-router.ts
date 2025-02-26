import { getForecast as getOwmForecast } from './air-quality-forecast';
import { getForecast as getVcForecast } from './visual-crossing-forecast';
import { Request, Response, Router } from 'express';
import { filterError, jsonOrJsonp, noCache, timeStamp } from './awcs-util';
import { AirQualityComponents, AirQualityForecast, AirQualityValues, CurrentConditions, ForecastData } from './shared-types';
import { getForecast as getWbForecast } from './weatherbit-forecast';
import { getForecast as getWuForecast } from './wunderground-forecast';
import { max } from '@tubular/math';
import { clone, forEach, toBoolean, toNumber } from '@tubular/util';
import { requestJson } from './request-cache';

export const router = Router();

function forecastBad(forecast: Error | ForecastData): boolean {
  return forecast instanceof Error || forecast.unavailable;
}

interface AQs {
  aqiUs?: number;
  aqiEu?: number;
  aqComps?: AirQualityComponents;
}

function worst(a: AirQualityComponents, b: AirQualityComponents): AirQualityComponents {
  if (b == null)
    return a;
  else if (a == null)
    a = clone(b);

  const aa = a as any;

  forEach(b as unknown as Record<string, AirQualityValues>, (key, value) => {
    aa[key] = (aa[key] == null ? value : ((aa[key].raw as number) < value.raw ? value : aa[key]));
    aa[key].aqiEu = max(aa[key].aqiEu, value.aqiEu);
    aa[key].aqiUs = max(aa[key].aqiUs, value.aqiUs);
  });

  return a;
}

function findMatchingAirQuality(forecast: AirQualityForecast, time: number, span: number): AQs {
  const aqs: AQs = {};

  for (const item of forecast.hours) {
    if (time <= item.time && item.time < time + span) {
      aqs.aqiEu = aqs.aqiEu == null ? item.aqiEu : max(item.aqiEu, aqs.aqiEu);
      aqs.aqiUs = aqs.aqiUs == null ? item.aqiUs : max(item.aqiUs, aqs.aqiUs);
      aqs.aqComps = worst(aqs.aqComps, item.aqComps);
    }
  }

  if (aqs.aqiEu != null || aqs.aqiUs != null)
    return aqs;
  else
    return null;
}

const log = toBoolean(process.env.AWC_LOG_CACHE_ACTIVITY);

router.get('/', async (req: Request, res: Response) => {
  const frequent = (process.env.AWC_FREQUENT_ID && req.query.id === process.env.AWC_FREQUENT_ID);
  const promises: Promise<ForecastData | AirQualityForecast | Error>[] = [];
  let visualCrossingIndex = 1;
  let weatherBitIndex = 1;
  let airQualityIndex = 1;
  let sources = 'WU';

  noCache(res);
  res.setHeader('cache-control', 'max-age=' + (frequent ? '240' : '840'));
  req.query.lat = req.query.lat && toNumber(req.query.lat).toFixed(4);
  req.query.lon = req.query.lon && toNumber(req.query.lon).toFixed(4);
  promises.push(getWuForecast(req));

  if (process.env.AWC_WEATHERBIT_API_KEY) {
    promises.push(getWbForecast(req));
    sources += ',WB';
    ++visualCrossingIndex;
    ++airQualityIndex;
  }
  else
    weatherBitIndex = 0;

  if (process.env.AWC_VISUAL_CROSSING_API_KEY) {
    sources += ',VC';
    promises.push(getVcForecast(req));
    ++airQualityIndex;
  }
  else
    visualCrossingIndex = 0;

  sources += ',OW';
  promises.push(getOwmForecast(req));

  const forecasts = await Promise.all(promises);
  const pref = (req.query.pws || process.env.AWC_PREFERRED_WS || '').toString().substr(0, 2);
  let usedIndex: number;
  let forecast = forecasts[usedIndex =
    ({ vc: visualCrossingIndex, vi: visualCrossingIndex, wb: weatherBitIndex, we: weatherBitIndex } as any)[pref] ?? 0] as ForecastData;
  const vcForecast = !(forecasts[visualCrossingIndex] instanceof Error) && forecasts[visualCrossingIndex] as ForecastData;

  for (let replaceIndex = 0; replaceIndex < forecasts.length && (!forecast || forecastBad(forecast)); ++replaceIndex)
    forecast = forecasts[usedIndex = replaceIndex] as ForecastData;

  if (airQualityIndex && !(forecasts[airQualityIndex] instanceof Error)) {
    const airQuality = forecasts[airQualityIndex] as AirQualityForecast;
    const aqs = findMatchingAirQuality(airQuality, Date.now() / 1000, 3600);

    if (aqs) {
      forecast.currently.aqiEu = aqs.aqiEu;
      forecast.currently.aqiUs = aqs.aqiUs;
      forecast.currently.aqComps = aqs.aqComps;
    }

    for (const hour of forecast.hourly) {
      const aqs = findMatchingAirQuality(airQuality, hour.time, 3600);

      if (aqs) {
        hour.aqiEu = aqs.aqiEu;
        hour.aqiUs = aqs.aqiUs;
        hour.aqComps = aqs.aqComps;
      }
    }

    for (const day of forecast.daily.data) {
      const aqs = findMatchingAirQuality(airQuality, day.time, 86400);

      if (aqs) {
        day.aqiEu = aqs.aqiEu;
        day.aqiUs = aqs.aqiUs;
        day.aqComps = aqs.aqComps;
      }
    }
  }

  console.log(timeStamp(), sources, usedIndex, forecasts.map(f => forecastResultCode(f)).join(''));

  if (log) {
    for (const forecast of forecasts) {
      if (forecast instanceof Error)
        console.error('    ' + filterError(forecast));
      else if (forecast.unavailable)
        console.error('    unavailable');
    }
  }

  if (forecastBad(forecast) && !process.env.AWC_WEATHERBIT_API_KEY) {
    const host = process.env.AWC_PROXY_HOST || 'https://weather.shetline.com';
    const url = `${host}/wbproxy?lat=${req.query.lat}&lon=${req.query.lon}&du=${req.query.du || 'f'}` +
      (req.query.id ? `&id=${req.query.id}` : '');

    try {
      forecast = (await requestJson(240, url, { timeout: 60000 })) as ForecastData;
    }
    catch (e) {
      forecast = e;
    }
  }

  if (forecast instanceof Error)
    res.status(500).send(forecast.message);
  else if (forecast.unavailable)
    res.status(500).send('Forecast unavailable');
  else {
    if (forecast.currently.precipTypeFromHour) {
      const host = process.env.AWC_PROXY_HOST || 'https://weather.shetline.com';
      const url = `${host}/owmproxy?lat=${req.query.lat}&lon=${req.query.lon}&du=${req.query.du || 'f'}` +
        (req.query.id ? `&id=${req.query.id}` : '');
      let conditions: CurrentConditions;

      try {
        conditions = await requestJson(240, url, { timeout: 60000 });
      }
      catch {}

      if (conditions) {
        forecast.currently.icon = conditions.icon;
        forecast.currently.precipType = conditions.precipType;
        delete forecast.currently.precipTypeFromHour;
      }
    }

    // Even if Weather Underground is preferred, if Visual Crossing is available use its better summary.
    if (forecast === forecasts[0] && forecasts.length > 1 && vcForecast?.daily?.summary)
      forecast.daily.summary = vcForecast.daily.summary;

    jsonOrJsonp(req, res, forecast);
  }
});

function forecastResultCode(forecast: Error | ForecastData): string {
  if (forecast instanceof Error) {
    const msg = forecast.message ?? forecast.toString();

    if (/\btimeout\b'/i.test(msg))
      return 'T';
    else
      return 'X';
  }

  return forecast.unavailable ? '-' : '*';
}
