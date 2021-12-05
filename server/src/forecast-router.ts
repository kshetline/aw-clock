import { getForecast as getVcForecast } from './visual-crossing-forecast';
import { Request, Response, Router } from 'express';
import { filterError, jsonOrJsonp, noCache, timeStamp } from './awcs-util';
import { CurrentConditions, ForecastData } from './shared-types';
import { getForecast as getWbForecast } from './weatherbit-forecast';
import { getForecast as getWuForecast } from './wunderground-forecast';
import { toBoolean, toNumber } from '@tubular/util';
import { requestJson } from './request-cache';

export const router = Router();

function forecastBad(forecast: Error | ForecastData): boolean {
  return forecast instanceof Error || forecast.unavailable;
}

const log = toBoolean(process.env.AWC_LOG_CACHE_ACTIVITY);

router.get('/', async (req: Request, res: Response) => {
  const frequent = (process.env.AWC_FREQUENT_ID && req.query.id === process.env.AWC_FREQUENT_ID);
  const promises: Promise<ForecastData | Error>[] = [];
  let visualCrossingIndex = 1;
  let weatherBitIndex = 1;
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
  }
  else
    weatherBitIndex = 0;

  if (process.env.AWC_VISUAL_CROSSING_API_KEY) {
    sources += ',VC';
    promises.push(getVcForecast(req));
  }
  else
    visualCrossingIndex = 0;

  const forecasts = await Promise.all(promises);
  let usedIndex: number;
  let forecast = forecasts[usedIndex =
    ({ vc: visualCrossingIndex, weatherbit: weatherBitIndex } as any)[process.env.AWC_PREFERRED_WS] ?? 0];
  const vcForecast = !(forecasts[visualCrossingIndex] instanceof Error) && forecasts[visualCrossingIndex] as ForecastData;

  for (let replaceIndex = 0; replaceIndex < forecasts.length && (!forecast || forecastBad(forecast)); ++replaceIndex)
    forecast = forecasts[usedIndex = replaceIndex];

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
