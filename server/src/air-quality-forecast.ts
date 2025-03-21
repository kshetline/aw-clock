import { Request } from 'express';
import { AirQualityForecast } from './shared-types';
import { purgeCache, requestJson } from './request-cache';
import { filterError } from './awcs-util';
import { forEach } from '@tubular/util';

interface AirQualityRaw {
  current: {
    time: string,
    european_aqi: number,
    us_aqi: number,
    pm10: number,
    pm2_5: number,
    carbon_monoxide: number,
    nitrogen_dioxide: number,
    sulphur_dioxide: number,
    ozone: number
  },
  hourly: {
    time: string[],
    pm10: number[],
    pm2_5: number[],
    carbon_monoxide: number[],
    nitrogen_dioxide: number[],
    sulphur_dioxide: number[],
    ozone: number[],
    european_aqi: number[],
    european_aqi_pm2_5: number[],
    european_aqi_pm10: number[],
    european_aqi_nitrogen_dioxide: number[],
    european_aqi_ozone: number[],
    european_aqi_sulphur_dioxide: number[],
    us_aqi: number[],
    us_aqi_aqi_pm2_5: number[],
    us_aqi_aqi_pm10: number[],
    us_aqi_aqi_nitrogen_dioxide: number[],
    us_aqi_aqi_carbon_monoxide: number[],
    us_aqi_aqi_ozone: number[],
    us_aqi_sulphur_dioxide: number[]
  }
}

const nameMap: Record<string, string> = {
  carbon_monoxide: 'co',
  nitrogen_dioxide: 'no2',
  ozone: 'o3',
  sulphur_dioxide: 'so2',
  pm2_5: 'pm2_5',
  pm10: 'pm10',
  european_aqi: 'aqiEu',
  us_aqi: 'aqiUs'
};

function translateNames(data: any, omitAqi = false): any {
  const result: Record<string, number> = {};

  forEach(data as Record<string, number>, (key, value) => {
    if (nameMap[key] && (!omitAqi || !key.endsWith('_aqi')))
      result[nameMap[key]] = value;
  });

  return result;
}

function checkIntegrity(forecast: AirQualityRaw): boolean {
  return forecast &&
         forecast.current?.time && forecast?.current.european_aqi != null && forecast?.current.us_aqi != null &&
         forecast.hourly?.time?.length > 1;
}

export async function getForecast(req: Request): Promise<AirQualityForecast | Error> {
  const url = 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' +
    `${req.query.lat}&longitude=${req.query.lon}` +
    '&current=european_aqi,us_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone' +
    '&hourly=pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,' +
      'european_aqi,european_aqi_pm2_5,european_aqi_pm10,european_aqi_nitrogen_dioxide,european_aqi_ozone,european_aqi_sulphur_dioxide,' +
      'us_aqi,us_aqi_pm2_5,us_aqi_pm10,us_aqi_nitrogen_dioxide,us_aqi_carbon_monoxide,us_aqi_ozone,us_aqi_sulphur_dioxide' +
    '&timezone=GMT';

  try {
    // If deflate encoding is allow it suffers from a decompression error for some unknown reason.
    const rawForecast = (await requestJson(1800, url, { headers: { 'Accept-Encoding': 'gzip, br, zstd' } })) as AirQualityRaw;

    if (checkIntegrity(rawForecast)) {
      const forecast = {
        hours: rawForecast.hourly.time.map(t => ({ time: new Date(t + 'Z').getTime() / 1000 }))
      } as AirQualityForecast;

      forecast.current = {
        aqiEu: rawForecast.current.european_aqi,
        aqiUs: rawForecast.current.us_aqi,
        aqComps: translateNames(rawForecast.current, true),
        time: new Date(rawForecast.current.time + 'Z').getTime() / 1000
      };

      forEach(rawForecast.hourly, (key, value) => {
        let isEuAqi = false;
        let isUsAqi = false;

        if (key.startsWith('european_aqi_')) {
          isEuAqi = true;
          key = key.substring(13);
        }
        else if (key.startsWith('us_aqi_')) {
          isUsAqi = true;
          key = key.substring(7);
        }

        const newKey = nameMap[key];

        if (newKey === 'aqiUs' || newKey === 'aqiEu')
          value.forEach((v, i) => (forecast.hours[i] as any)[newKey] = v);
        else if (newKey) {
          value.forEach((v, i) => {
            const hour = forecast.hours[i] as any;

            if (!hour.aqComps)
              hour.aqComps = {};

            if (!hour.aqComps[newKey])
              hour.aqComps[newKey] = {};

            if (isEuAqi)
              hour.aqComps[newKey].aqiEu = v;
            else if (isUsAqi)
              hour.aqComps[newKey].aqiUs = v;
            else
              hour.aqComps[newKey].raw = v;
          });
        }
      });

      return forecast;
    }

    purgeCache(url);
    return new Error('Error retrieving Open-Meteo air quality data');
  }
  catch (err) {
    purgeCache(url);
    return new Error('Error connecting to Open-Meteo: ' + filterError(err));
  }
}
