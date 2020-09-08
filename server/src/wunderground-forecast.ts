import { purgeCache, requestJson, requestText } from './request-cache';
import { Request, Router } from 'express';
import { Alert, ForecastData } from './shared-types';
import { checkForecastIntegrity } from './util';

export const router = Router();

export async function getForecast(req: Request): Promise<ForecastData | Error> {
  try {
    const url = `https://www.wunderground.com/forecast/${req.query.lat},${req.query.lon}`;
    const items = await getContent(req, url);

    if (!items)
      return { source: 'wunderground', unavailable: true };

    const celsius = (req.query.du === 'c');
    const intermediateForecast: any = { alerts: [] };
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
      else if (/\/alerts\/detail\?/.test(item.url) && item.value?.alertDetail)
        intermediateForecast.alerts.push(item.value?.alertDetail);
    }

    if (!intermediateForecast.location)
      return new Error('Error parsing Weather Underground data');

    const forecast = convertForecast(intermediateForecast, celsius);

    if (checkForecastIntegrity(forecast))
      return forecast;

    purgeCache(url);

    return new Error('Error retrieving Weather Underground data');
  }
  catch (err) {
    return new Error('Error connecting to Weather Underground: ' + err);
  }
}

async function getContent(req: Request, url: string): Promise<any> {
  let result: any = null;
  const content = await requestText(240, url, {
    followRedirects: true,
    headers: {
      'Accept-Language': 'en-US,en;q=0.5',
      'User-Agent': req.headers['user-agent']
    }
  });
  const $ = /<script\b.+\bid="app-root-state"[^>]*>(.+?)<\/script>/is.exec(content);

  if ($) {
    result = JSON.parse(decodeWeirdJson($[1]))['wu-next-state-key'];
    result = (typeof result === 'object' ? result : null);
  }

  return result;
}

function decodeWeirdJson(s: string): string {
  // What would otherwise be normal JSON data is weirdly encoded using something like HTML entities, but all
  // single letter codes, for ampersands, double quotes, '>', and '<'. The quotes in particular make the content
  // unreadable as JSON without first being decoded.
  return s.split(/(&\w;)/g).map((s, i) => {
    if (i % 2 === 0)
      return s;

    switch (s) {
      case '&a;': return '&';
      case '&q;': return '"';
      case '&g;': return '>';
      case '&l;': return '<';
      case '&s;': return '’'; // right single quote
      default: return s;
    }
  }).join('');
}

async function adjustUnits(forecast: any, item: any, category: string, celsius: boolean): Promise<void> {
  if (/&units=e&/.test(item.url)) {
    if (celsius)
      forecast[category] = await requestJson(240, item.url.replace('&units=e&', '&units=m&'));
    else
      forecast[category] = item.value;
  }
  else if (celsius)
    forecast[category] = item.value;
  else
    forecast[category] = await requestJson(240, item.url.replace('&units=m&', '&units=e&'));
}

function getIcon(iconCode: number): string {
  if (0 <= iconCode && iconCode <= 47)
    return iconCode.toString().padStart(2, '0');
  else
    return 'unknown';
}

function convertForecast(wuForecast: any, isMetric: boolean): ForecastData {
  const forecast: ForecastData = { source: 'wunderground' } as ForecastData;

  forecast.latitude = wuForecast.location.latitude;
  forecast.longitude = wuForecast.location.longitude;
  forecast.timezone = wuForecast.location.ianaTimeZone;
  forecast.isMetric = isMetric;

  if (!wuForecast.currently || !wuForecast.hourly || !wuForecast.daily) {
    forecast.unavailable = true;
    return forecast;
  }

  const wc = wuForecast.currently;
  const wh = wuForecast.hourly;
  const location = wuForecast.location;

  forecast.city = location && `${location.city}, ${location.adminDistrictCode}, ${location.countryCode}`;
  convertCurrent(forecast, wc, wh);
  convertHourly(forecast, wh);
  convertDaily(forecast, wc, wuForecast.daily);
  convertAlerts(forecast, wuForecast.alerts);

  return forecast;
}

function convertCurrent(forecast: ForecastData, wc: any, wh: any): void {
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
}

function convertHourly(forecast: ForecastData, wh: any): void {
  forecast.hourly = [];

  const length = Math.min(36, wh.iconCode?.length ?? 0, wh.precipType?.length ?? 0, wh.qpf?.length ?? 0,
                          wh.qpfSnow?.length ?? 0, wh.temperature?.length ?? 0, wh.validTimeUtc?.length ?? 0);

  for (let i = 0; i < length; ++i) {
    let precipType = wh.precipType[i];

    if (wh.qpfSnow[i] > 0 && precipType === 'precip')
      precipType = 'snow';

    forecast.hourly.push({
      icon: getIcon(wh.iconCode[i]),
      temperature: wh.temperature[i],
      precipProbability: wh.precipChance[i] / 100,
      precipType,
      time: wh.validTimeUtc[i]
    });
  }
}

function convertDaily(forecast: ForecastData, wc: any, wd: any): void {
  const daily: any[] = [];
  const wddp = wd.daypart && wd.daypart[0];
  const length = Math.min(10, (wddp?.iconCode?.length ?? 0) / 2, (wddp?.precipChance?.length ?? 0) / 2,
    (wddp?.precipType?.length ?? 0) / 2, wd.qpf?.length ?? 0, wd.qpfSnow?.length ?? 0,
    wd.temperatureMax?.length ?? 0, wd.temperatureMin?.length ?? 0, wd.validTimeUtc?.length ?? 0);

  for (let i = 0; i < length; ++i) {
    let precipType = wddp?.precipType[i * 2];
    const precipTypeNight = wddp?.precipType[i * 2 + 1];

    if (!precipType || precipTypeNight === 'snow')
      precipType = precipTypeNight;

    let precipAccumulation = wd.qpf[i];

    if (precipType === 'snow' || (wd.qpfSnow[i] > 0 && precipType === 'precip')) {
      precipType = 'snow';
      precipAccumulation = wd.qpfSnow[i];
    }

    daily.push({
      icon: getIcon(wddp?.iconCode[i * 2] ?? wddp?.iconCode[i * 2 + 1] ?? -1),
      narrativeDay: wddp?.narrative[i * 2],
      narrativeEvening: wddp?.narrative[i * 2 + 1],
      precipAccumulation,
      precipIntensityMax: 0,
      precipProbability: Math.max(wddp?.precipChance[i * 2] ?? 0, wddp?.precipChance[i * 2 + 1] ?? 0) / 100,
      precipType,
      summary: wd.narrative[i],
      temperatureHigh: wd.temperatureMax[i] ?? wc.temperatureMax24Hour,
      temperatureLow: wd.temperatureMin[i] ?? wc.temperatureMin24Hour,
      time: wd.validTimeUtc[i]
    });
  }

  forecast.daily = {
    summary: (wd.narrative && wd.narrative[0]) ?? '',
    data: daily
  };
}

function convertAlerts(forecast: ForecastData, wa: any): void {
  forecast.alerts = wa.map((wuAlert: any) => {
    const alert: Alert = {} as Alert;

    alert.description = '';
    alert.expires = wuAlert.expireTimeUTC;
    alert.severity = 'advisory';
    alert.time = Math.floor(Date.parse(wuAlert.issueTimeLocal) / 1000);
    alert.title = wuAlert.headlineText;

    if (wuAlert.texts && wuAlert.texts[0]) {
      const text = wuAlert.texts[0];

      alert.description = ((text.overview ?? '') + ' ' + (text.description ?? '')).trim();
    }

    if (!/advisory/i.test(wuAlert.headlineText)) {
      if (/observed/i.test(wuAlert.certainty) || /warning/i.test(wuAlert.headlineText))
        alert.severity = 'warning';
      else if (/likely/i.test(wuAlert.certainty) || /watch/i.test(wuAlert.headlineText))
        alert.severity = 'watch';
    }

    return alert;
  });
}
