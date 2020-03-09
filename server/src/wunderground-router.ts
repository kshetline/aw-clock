import { requestJson, requestText } from 'by-request';
import { jsonOrJsonp } from './common';
import { Request, Response, Router } from 'express';
import { ForecastData } from './forecast-types';
import { noCache } from './util';

export const router = Router();

router.get('/', async (req: Request, res: Response) => {
  noCache(res);

  try {
    const content = await requestText(`https://www.wunderground.com/forecast/${req.query.lat},${req.query.lon}`, {
      followRedirects: true,
      headers: {
        'Accept-Language': 'en-US,en;q=0.5',
        'User-Agent': req.headers['user-agent']
      }
    });
    const $ = /<script\b.+\bid="app-root-state"[^>]*>(.+?)<\/script>/is.exec(content);

    if (!$) {
      parseError(res);
      return;
    }

    const decoded = decodeWeirdJson($[1]);
    const originalForecast = JSON.parse(decoded);
    const celsius = (req.query.du === 'c');
    const intermediateForecast: any = { alerts: [] };
    const items = originalForecast['wu-next-state-key'];

    if (!items) {
      parseError(res);
      return;
    }

    const itemsArray = Object.keys(items).map(key => items[key]);

    for (const item of itemsArray) {
      if (!item.value || !item.url)
        continue;

      if (/\/location\/point\?/.test(item.url))
        intermediateForecast.location = item.value?.location ?? item.value;
      else if (/\/wx\/observations\/current\?/.test(item.url))
        await adjustUnits(intermediateForecast, item, 'currently', celsius);
      else if (/\/wx\/forecast\/hourly\/15day\?/.test(item.url))
        await adjustUnits(intermediateForecast, item, 'hourly', celsius);
      else if (/\/wx\/forecast\/daily\/10day\?/.test(item.url))
        await adjustUnits(intermediateForecast, item, 'daily', celsius);
      else if (/\/alerts\/detail\?/.test(item.url) && item.value)
        intermediateForecast.alerts.push(item.value);
    }

    if (!intermediateForecast.location || !intermediateForecast.currently || !intermediateForecast.hourly || !intermediateForecast.daily) {
      parseError(res);
      return;
    }

    const forecast: ForecastData = convertForecast(intermediateForecast);

    forecast.isMetric = celsius;
    jsonOrJsonp(req, res, forecast);
  }
  catch (err) {
    res.status(500).send('Error connecting to Weather Underground: ' + err);
  }
});

function decodeWeirdJson(s: string): string {
  // What would otherwise be normal JSON data is weirdly encoded using something like HTML entities, but all
  // single letter codes, for ampersands, double quotes, '>', and '<'. The quotes in particular make the content
  // unreadable as JSON without first being decoded.
  return s.split(/(&\w+;)/g).map((s, i) => {
    if (i % 2 === 0)
      return s;
    else if (s === '&a;')
      return '&';
    else if (s === '&q;')
      return '"';
    else if (s === '&g;')
      return '>';
    else if (s === '&l;')
      return '<';
    else
      return s;
  }).join('');
}

function parseError(res: Response): void {
  res.status(500).send('Error parsing Weather Underground data');
}

async function adjustUnits(forecast: any, item: any, category: string, celsius: boolean): Promise<void> {
  if (/&units=e&/.test(item.url)) {
    if (celsius)
      forecast[category] = await requestJson(item.url.replace('&units=e&', '&units=m&'));
    else
      forecast[category] = item.value;
  }
  else if (celsius)
    forecast[category] = item.value;
  else
    forecast[category] = await requestJson(item.url.replace('&units=m&', '&units=e&'));
}

function getIcon(iconCode: number): string {
  if (0 <= iconCode && iconCode <= 47)
    return iconCode.toString().padStart(2, '0');
  else
    return 'unknown';
}

function convertForecast(wuForecast: any): ForecastData {
  const forecast: ForecastData = { source: 'wunderground' } as ForecastData;

  forecast.latitude = wuForecast.location.latitude;
  forecast.longitude = wuForecast.location.longitude;
  forecast.timezone = wuForecast.location.ianaTimeZone;

  const wc = wuForecast.currently;
  const wh = wuForecast.hourly;
  const wd = wuForecast.daily;

  forecast.currently = {
    time: wc.validTimeUtc,
    summary: wc.wxPhraseMedium,
    icon: getIcon(wc.iconCode),
    humidity: wc.relativeHumidity / 100,
    cloudCover: wh.cloudCover[0] / 100,
    precipProbability: wh.precipChance[0] / 100,
    precipType: wh.precipType[0],
    temperature: wc.temperature,
    feelsLikeTemperature: wc.temperatureFeelsLike
  };

  const daily: any[] = [];

  for (let i = 0; i < 10; ++i) {
    let precipType = wd.daypart[0]?.precipType[i * 2];
    const precipTypeNight = wd.daypart[0]?.precipType[i * 2 + 1];

    if (!precipType || precipTypeNight === 'snow')
      precipType = precipTypeNight;

    daily.push({
      icon: getIcon(wd.daypart[0]?.iconCode[i * 2] ?? wd.daypart[0]?.iconCode[i * 2 + 1] ?? -1),
      precipAccumulation: precipType === 'snow' ? wd.qpfSnow[i] : wd.qpf[i],
      precipIntensityMax: 0,
      precipProbability: Math.max(wd.daypart[0]?.precipChance[i * 2] ?? 0, wd.daypart[0]?.precipChance[i * 2 + 1] ?? 0) / 100,
      precipType,
      summary: wd.narrative[i],
      temperatureHigh: wd.temperatureMax[i] ?? wc.temperatureMax24Hour,
      temperatureLow: wd.temperatureMin[i] ?? wc.temperatureMin24Hour,
      time: wd.expirationTimeUtc[i]
    });
  }

  forecast.daily = {
    summary: '?',
    data: daily
  };

  forecast.alerts = [];

  return forecast;
}
