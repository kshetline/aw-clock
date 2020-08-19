import { jsonOrJsonp } from './common';
import { getForecast as getDsForecast } from './darksky-forecast';
import { Request, Response, Router } from 'express';
import { noCache } from './util';
import { ForecastData } from './shared-types';
import { getForecast as getWuForecast } from './wunderground-forecast';

export const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const frequent = (process.env.AWC_FREQUENT_ID && req.query.id === process.env.AWC_FREQUENT_ID);
  const promises: Promise<ForecastData | Error>[] = [];

  promises.push(getWuForecast(req));

  if (process.env.AWC_DARK_SKY_API_KEY)
    promises.push(getDsForecast(req));

  const forecasts = await Promise.all(promises);
  const forecast = forecasts[Math.min(forecasts.length - 1,
    process.env.AWC_PREFERRED_WS === 'darksky' || forecasts[0] instanceof Error ? 1 : 0)];

  if (forecast instanceof Error)
    res.status(500).send(forecast.message);
  else {
    // Even if Weather Underground is preferred, if Dark Sky is available, use its better summary.
    if (forecast === forecasts[0] && forecasts.length > 1 && !(forecasts[1] instanceof Error) &&
        forecasts[1].daily.summary)
      forecast.daily.summary = forecasts[1].daily.summary;

    noCache(res);
    res.setHeader('cache-control', 'max-age=' + (frequent ? '240' : '840'));
    jsonOrJsonp(req, res, forecast);
  }
});
