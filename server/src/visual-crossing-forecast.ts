// noinspection SpellCheckingInspection
/* cspell:disable */
import { purgeCache, requestJson } from './request-cache';
import { Request } from 'express';
import {
  /* Alert, AlertKeys, */ CommonConditions, CommonConditionsKeys, CurrentConditions, CurrentConditionsKeys, DailyConditions, DailyConditionsKeys,
  DailySummaryConditions, ForecastData, ForecastDataKeys, HourlyConditions, PressureTrend
} from './shared-types';
import { checkForecastIntegrity, filterError } from './awcs-util';
import { clone, push } from '@tubular/util';

interface VCAlerts {
}

interface VCCommonConditions {
  cloudcover: number;
  conditions: string;
  datetime: string;
  datatimeEpoch: number;
  description: string;
  humidity: number;
  icon: string;
  precip: number;
  precipcover: number;
  precipprob: number;
  preciptype: string;
  pressure: number;
  snow: number;
  snowdepth: number;
  windir: number;
  windgust: number;
  windspeed: number;
}

interface VCCurrentConditions extends VCCommonConditions {
  feelslike: number;
  temp: number;
}

const VCDailyConditionsKeys = push(clone(DailyConditionsKeys), 'hours').filter(key => key !== 'narrativeEvening');

interface VCHourlyConditions extends VCCommonConditions {
}

interface VCDailyConditions extends VCCommonConditions {
  hours: VCHourlyConditions[],
  tempmax: number;
  tempmin: number;
}

interface VisualCrossingForecast {
  alerts: VCAlerts[];
  currentConditions: VCCurrentConditions;
  days: VCDailyConditions[];
  description: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

const conditionNames: Record<string, string> = {
  time: 'datetimeEpoch',
  summary: 'description',
  cloudCover: 'cloudcover',
  precipIntensity: '', // ?
  precipIntensityMax: '', // ?
  precipProbability: 'precipcover', // ?
  precipType: 'preciptype',
  pressureTrend: '', // ?
  windDirection: 'windir',
  windGust: 'windgust',
  windPhrase: '-',
  windSpeed: 'windspeed',
  temperature: 'temp',
  feelsLikeTemperature: 'feelslike',
  narrativeDay: 'description',
  temperatureHigh: 'tempmax',
  temperatureLow: 'tempmin',
  precipAccumulation: 'precip'
};

export async function getForecast(req: Request): Promise<ForecastData | Error> {
  const isMetric = (req.query.du === 'c');
  const url = 'https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline' +
    `/${req.query.lat}%2C${req.query.lon}?unitGroup=${isMetric ? 'metric' : 'us'}&lang=en` +
    /* cspell:disable-next-line */ // noinspection SpellCheckingInspection
    `&key=${process.env.AWC_VISUAL_CROSSING_API_KEY}&include=fcst%2Cstats%2Chours%2Calerts%2Ccurrent`;

  try {
    const origForecast = (await requestJson(240, url)) as VisualCrossingForecast;
    const forecast = convertForecast(origForecast, isMetric);

    if (checkForecastIntegrity(forecast))
      return forecast;

    purgeCache(url);
    return new Error('Error retrieving Visual Crossing data');
  }
  catch (err) {
    purgeCache(url);
    return new Error('Error connecting to Visual Crossing: ' + filterError(err));
  }
}

// const iconNames = ['clear-day', 'clear-night', 'wind', 'fog', 'partly-cloudy-day', 'partly-cloudy-night',
//                    'cloudy', 'rain', 'sleet', 'snow'];
// const iconCodes = ['32', '31', '19', 'fog', '28', '27',
//                    '26', '12', '05', '13'];

// eslint-disable-next-line @typescript-eslint/no-unused-vars
// function getIcon(conditions: CommonConditions, isMetric: boolean, ignorePrecipProbability = false): string {
//   const iconIndex = iconNames.indexOf(conditions.icon);
//   let icon = (iconIndex >= 0 ? iconCodes[iconIndex] : '');
//   const summary = conditions.summary ? conditions.summary.toLowerCase() : '';
//   let precipIntensity = conditions.precipIntensity ?? 0;
//   let precipAccumulation = (conditions as DailyConditions).precipAccumulation || 0;
//
//   // Metric precipitation rate is in mm/hr, and needs to be converted to inches/hr.
//   // Accumulated precipitation is in cm, and needs to be converted to inches.
//   if (isMetric) {
//     precipIntensity /= 25.4;
//     precipAccumulation /= 2.54;
//   }
//
//   // Sometimes the icon says "cloudy" or the like, but the numbers look more like rain or snow.
//   // Change the icon if conditions look less favorable.
//   if (!ignorePrecipProbability && iconIndex >= 0 && iconIndex <= 6 &&
//       conditions.precipProbability >= 0.25 &&
//       (precipIntensity >= 0.01 || (conditions.precipProbability >= 0.5 && precipIntensity > 0.0025) || precipAccumulation >= 0.25)) {
//     if (conditions.precipType === 'snow')
//       icon = '13';
//     else if (conditions.precipType === 'sleet')
//       icon = '05';
//     else
//       icon = '12';
//   }
//
//   // Visual Crossing currently doesn't report thunderstorms as a condition by icon value. We'll try to make
//   // up for that by looking at the summary.
//   if (icon === '12' && (summary.indexOf('thunder') >= 0 || summary.indexOf('lightning') >= 0)) {
//     icon = '38';
//
//     if (summary.indexOf('scattered') >= 0 || summary.indexOf('isolated') >= 0)
//       icon = '37';
//   }
//   else if (icon === '12' && precipIntensity < 0.01)
//     icon = '09';
//
//   if (conditions.cloudCover < 0.333) {
//     if (icon === '28')
//       icon = '30';
//     else if (icon === '27')
//       icon = '27';
//   }
//
//   return icon;
// }

function convertForecast(vcForecast: VisualCrossingForecast, isMetric: boolean): ForecastData {
  const forecast: ForecastData = { source: 'visual_x', isMetric };

  Object.keys(vcForecast).forEach(key => {
    if (key === 'currentConditions')
      forecast.currently = convertConditions(vcForecast.currentConditions, CurrentConditionsKeys, isMetric) as CurrentConditions;
    else if (key === 'days')
      forecast.daily = convertDaily(vcForecast.days, isMetric, forecast);
    // else if (key === 'alerts')
    //   forecast.alerts = convertAlerts(vcForecast.alerts);
    else if (ForecastDataKeys.includes(key))
      (forecast as any)[key] = (vcForecast as any)[key];
  });

  if (forecast.hourly) {
    let tryAgainIfEqual = true;

    for (const hour of forecast.hourly) {
      if (hour.time > forecast.currently.time) {
        if (forecast.currently.pressure < hour.pressure)
          forecast.currently.pressureTrend = PressureTrend.RISING;
        else if (forecast.currently.pressure > hour.pressure)
          forecast.currently.pressureTrend = PressureTrend.FALLING;
        else {
          forecast.currently.pressureTrend = PressureTrend.STEADY;

          if (tryAgainIfEqual) {
            tryAgainIfEqual = false;
            continue;
          }
        }

        break;
      }
    }
  }

  if (!forecast.currently || !forecast.daily) // TODO: Unavailable flags?
    forecast.unavailable = true;

  return forecast;
}

function convertConditions(vcConditions: VCCommonConditions | VCCurrentConditions | VCDailyConditions | VCHourlyConditions,
                           keys: string[], isMetric: boolean, root?: ForecastData): CommonConditions {
  const conditions: CommonConditions = {} as CommonConditions;

  for (const key of keys) {
    const vcKey = conditionNames[key] || key;

    if (key === 'hours' && root && root.hourly && root.hourly.length < 48)
      root.hourly.push(...convertHourly((vcConditions as VCDailyConditions).hours, isMetric));
    // else if (key === 'icon')
    //   conditions.icon = getIcon(vcConditions, isMetric);
    else if (vcKey !== '-')
      (conditions as any)[key] = (vcConditions as any)[vcKey];
  }

  // if (!isMetric && conditions.pressure != null)
  //   conditions.pressure = hpaToInHg(conditions.pressure);
  //
  // if (isMetric && conditions.windSpeed != null) // Convert m/s to km/hour
  //   conditions.windSpeed *= 3.6;

  return conditions;
}

function convertHourly(vcHourly: VCHourlyConditions[], isMetric: boolean): HourlyConditions[] {
  let hourly: HourlyConditions[] = [];
  const now = Date.now() / 1000;

  for (const hour of vcHourly) {
    hourly.push(convertConditions(hour, CommonConditionsKeys, isMetric) as HourlyConditions);

    if (hourly.length >= 36)
      break;
  }

  hourly = hourly.filter(hour => hour.time > now - 3600);

  return hourly;
}

function convertDaily(vcDaily: VCDailyConditions[], isMetric: boolean, root: ForecastData): DailySummaryConditions {
  const daily: DailySummaryConditions = { data: [] } as DailySummaryConditions;

  if (!root.hourly)
    root.hourly = [];

  for (const day of vcDaily)
    daily.data.push(convertConditions(day, VCDailyConditionsKeys, isMetric, root) as DailyConditions);

  return daily;
}

// function convertAlerts(vcAlerts: Alert[]): Alert[] {
//   return vcAlerts.map(vcAlert => {
//     const alert: Alert = {} as Alert;
//
//     Object.keys(vcAlert).forEach(key => {
//       if (AlertKeys.includes(key))
//         (alert as any)[key] = (vcAlert as any)[key];
//
//       if (key === 'description')
//         alert.description = alert.description.replace(/ ((\* )?(WHAT|WHERE|WHEN|IMPACTS|([A-Z][A-Z ]{2,}[A-Z])))\.\.\./g,
//           '\n\n$1...').replace(/^\.{3,}/g, '');
//     });
//
//     return alert;
//   });
// }
