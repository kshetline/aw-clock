import { jsonOrJsonp } from './common';
import { getForecast as getDsForecast } from './darksky-forecast';
import { Request, Response, Router } from 'express';
import { ForecastData } from './forecast-types';
import { noCache } from './util';
import { getForecast as getWuForecast } from './wunderground-forecast';

export const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const frequent = (process.env.AWC_FREQUENT_ID && req.query.id === process.env.AWC_FREQUENT_ID);
  let forecast: ForecastData | Error;
  let triedDarksky = false;

  if (process.env.AWC_DARK_SKY_API_KEY && process.env.AWS_PREFERRED_WS === 'darksky') {
    forecast = await getDsForecast(req);
    triedDarksky = true;
  }
  else
    forecast = await getWuForecast(req);

  if ((forecast instanceof Error && (triedDarksky || process.env.AWC_DARK_SKY_API_KEY)) ||
      (!(forecast instanceof Error) && forecast.unavailable))
    forecast = await (triedDarksky ? getWuForecast(req) : getDsForecast(req));

  if (forecast instanceof Error)
    res.status(500).send(forecast.message);
  else {
    noCache(res);
    res.setHeader('cache-control', 'max-age=' + (frequent ? '240' : '840'));
    jsonOrJsonp(req, res, forecast);
  }
});
