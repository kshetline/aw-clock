import { requestJson } from 'by-request';
import { getForecast as getDsForecast, THE_END_OF_DAYS } from './darksky-forecast';
import { Request, Response, Router } from 'express';
import { jsonOrJsonp, noCache } from './util';
import { ForecastData } from './shared-types';
import { getForecast as getWbForecast } from './weatherbit-forecast';
import { getForecast as getWuForecast } from './wunderground-forecast';

export const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const frequent = (process.env.AWC_FREQUENT_ID && req.query.id === process.env.AWC_FREQUENT_ID);
  const promises: Promise<ForecastData | Error>[] = [];
  let darkSkyIndex = 1;
  let weatherBitIndex = 1;

  promises.push(getWuForecast(req));

  if (process.env.AWC_WEATHERBIT_API_KEY) {
    promises.push(getWbForecast(req));
    ++darkSkyIndex;
  }
  else
    weatherBitIndex = 0;

  if (process.env.AWC_DARK_SKY_API_KEY && Date.now() < THE_END_OF_DAYS)
    promises.push(getDsForecast(req));
  else
    darkSkyIndex = 0;

  const forecasts = await Promise.all(promises);
  let forecast = forecasts[
    ({ darksky: darkSkyIndex, weatherbit: weatherBitIndex } as any)[process.env.AWC_PREFERRED_WS] ?? 0];
  const darkSkyForecast = !(forecasts[darkSkyIndex] instanceof Error) && forecasts[darkSkyIndex] as ForecastData;

  for (let replaceIndex = 0; replaceIndex < forecasts.length && (!forecast || forecast instanceof Error); ++replaceIndex)
    forecast = forecasts[replaceIndex];

  if (forecast instanceof Error && !process.env.AWC_WEATHERBIT_API_KEY) {
    const url = `http://weather.shetline.com/wbproxy?lat=${req.query.lat}&lon=${req.query.lon}&du=${req.query.du}` +
      (req.query.id ? `id=${req.query.id}` : '');

    forecast = (await requestJson(url)) as ForecastData | Error;
  }

  if (forecast instanceof Error) {
    res.status(500).send(forecast.message);
  }
  else {
    // Even if Weather Underground is preferred, if Dark Sky is available, use its better summary.
    if (forecast === forecasts[0] && forecasts.length > 1 && darkSkyForecast?.daily?.summary)
      forecast.daily.summary = darkSkyForecast.daily.summary;

    noCache(res);
    res.setHeader('cache-control', 'max-age=' + (frequent ? '240' : '840'));
    jsonOrJsonp(req, res, forecast);
  }
});
