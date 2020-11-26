import { requestJson } from 'by-request';
import { getForecast as getDsForecast, THE_END_OF_DAYS } from './darksky-forecast';
import { Request, Response, Router } from 'express';
import { jsonOrJsonp, noCache, timeStamp } from './util';
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

  // None of these promises *should* throw any errors. Errors should be returned as values, not thrown.
  // But it seems that sometimes errors are getting thrown, and this is resulting in no weather data
  // being returned. So I'm going to try catching errors anyway, and if any are caught, giving up on
  // having all forecast queries done simultaneously, instead processing queries one at a time.

  let forecasts: (Error | ForecastData)[];

  try {
    forecasts = await Promise.all(promises);
  }
  catch (err) {
    console.error('%s: Unexpected forecast error:', timeStamp(), err);
    forecasts = [];

    for (let i = 0; i < promises.length; ++i) {
      try {
        forecasts[i] = await promises[i];
      }
      catch (err2) {
        forecasts[i] = err2;
        console.error('%s: Unexpected forecast error:', timeStamp(), err2);
      }
    }
  }

  let forecast = forecasts[
    ({ darksky: darkSkyIndex, weatherbit: weatherBitIndex } as any)[process.env.AWC_PREFERRED_WS] ?? 0];
  const darkSkyForecast = !(forecasts[darkSkyIndex] instanceof Error) && forecasts[darkSkyIndex] as ForecastData;

  for (let replaceIndex = 0; replaceIndex < forecasts.length && (!forecast || forecast instanceof Error); ++replaceIndex)
    forecast = forecasts[replaceIndex];

  if (forecast instanceof Error && !process.env.AWC_WEATHERBIT_API_KEY) {
    const url = `http://weather.shetline.com/wbproxy?lat=${req.query.lat}&lon=${req.query.lon}&du=${req.query.du || 'f'}` +
      (req.query.id ? `id=${req.query.id}` : '');

    try {
      forecast = (await requestJson(url)) as ForecastData;
    }
    catch (e) {
      forecast = e;
    }
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
