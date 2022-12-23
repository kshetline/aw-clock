// noinspection SpellCheckingInspection
/* cspell:disable */
import { purgeCache, requestJson } from './request-cache';
import { Request } from 'express';
import {
  Alert, CommonConditions, CommonConditionsKeys, CurrentConditions, CurrentConditionsKeys, DailyConditions, DailyConditionsKeys,
  DailySummaryConditions, ForecastData, ForecastDataKeys, HourlyConditions, PressureTrend
} from './shared-types';
import { alertCleanUp, checkForecastIntegrity, filterError, hpaToInHg, setAlertId } from './awcs-util';
import { clone, isNumber, push } from '@tubular/util';
import { floor } from '@tubular/math';

interface VCAlert {
  description: string;
  ends: string;
  event: string;
  headline: string;
  id: string;
  onset: string;
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
  preciptype: string[];
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
  alerts: VCAlert[];
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
  precipIntensity: '',
  precipIntensityMax: '',
  precipProbability: 'precipprob',
  precipType: 'preciptype',
  pressureTrend: '',
  windDirection: 'winddir',
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

function nullIfError(time: number): number | null {
  if (isNaN(time) || time == null)
    return null;
  else
    return time;
}

export async function getForecast(req: Request): Promise<ForecastData | Error> {
  const isMetric = (req.query.du === 'c');
  const url = 'https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline' +
    `/${req.query.lat}%2C${req.query.lon}?unitGroup=${isMetric ? 'metric' : 'us'}&lang=en&iconSet=icons2` +
    /* cspell:disable-next-line */ // noinspection SpellCheckingInspection
    `&key=${process.env.AWC_VISUAL_CROSSING_API_KEY}&include=fcst%2Chours%2Calerts%2Ccurrent`;

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

/* eslint-disable quote-props */
const iconMap: Record<string, string> = {
  'clear-day': '32',
  'clear-night': '31',
  'cloudy': '26',
  'fog': 'fog',
  'partly-cloudy-day': '28',
  'partly-cloudy-night': '27',
  'rain': '12',
  'showers-day': '45d',
  'showers-night': '45',
  'snow': '13',
  'snow-showers-day': '41',
  'snow-showers-night': '46',
  'thunder-rain': '03',
  'thunder-showers-day': '37',
  'thunder-showers-night': '47',
  'wind': '19'
};
/* eslint-enable quote-props */

function getIcon(conditions: VCCommonConditions): string {
  let icon = iconMap[conditions.icon] || '';
  const precip = conditions.preciptype?.sort().join();

  if (conditions.cloudcover < 33) {
    if (icon === '28')
      icon = '30';
    else if (icon === '27')
      icon = '27';
  }
  else if (conditions.cloudcover > 80) {
    switch (icon) {
      case '45d':
      case '45':
        icon = '12';
        break;

      case '41':
      case '46':
        icon = '13';
        break;

      case '37':
      case '47':
        icon = '03';
        break;
    }
  }

  if (precip === 'rain,snow' && (icon === '12' || icon === '13'))
    icon = '05';
  else if (icon === '19' && precip === 'snow')
    icon = '15';

  return icon;
}

function convertForecast(vcForecast: VisualCrossingForecast, isMetric: boolean): ForecastData {
  const forecast: ForecastData = { source: 'visual_x', isMetric };

  Object.keys(vcForecast).forEach(key => {
    if (key === 'currentConditions')
      forecast.currently = convertConditions(vcForecast.currentConditions, CurrentConditionsKeys, 0, isMetric) as CurrentConditions;
    else if (key === 'days')
      forecast.daily = convertDaily(vcForecast.days, isMetric, forecast);
    else if (key === 'alerts')
      forecast.alerts = convertAlerts(vcForecast.alerts);
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

  forecast.daily.summary = vcForecast.description;

  if (forecast.currently.precipType == null) {
    const hour = forecast.hourly[1];

    if (hour?.precipType != null) {
      forecast.currently.icon = hour.icon;
      forecast.currently.precipType = hour.precipType;
      forecast.currently.precipTypeFromHour = true;
    }
  }

  return forecast;
}

function convertConditions(vcConditions: VCCommonConditions | VCCurrentConditions | VCDailyConditions | VCHourlyConditions,
                           keys: string[], timeSpan: number, isMetric: boolean, root?: ForecastData): CommonConditions {
  const conditions: CommonConditions = {} as CommonConditions;

  for (const key of keys) {
    const vcKey = conditionNames[key] || key;

    if (key === 'hours' && root && root.hourly && root.hourly.length < 48)
      root.hourly.push(...convertHourly((vcConditions as VCDailyConditions).hours, isMetric));
    // eslint-disable-next-line no-prototype-builtins
    else if (vcKey !== '-' && vcConditions.hasOwnProperty(vcKey)) {
      if (key === 'precipType') {
        conditions.precipType = vcConditions.preciptype?.sort().join();

        if (conditions.precipType && vcConditions.precip && timeSpan)
          conditions.precipIntensity = conditions.precipIntensityMax = vcConditions.precip / timeSpan;
      }
      else if (key === 'icon')
        conditions.icon = getIcon(vcConditions);
      else {
        const value = (vcConditions as any)[vcKey];

        (conditions as any)[key] = value;

        if (isNumber(value) && /\b(cloudCover|humidity|precipProbability)\b/.test(key))
          (conditions as any)[key] = value / 100;
      }
    }
  }

  if (!isMetric && conditions.pressure != null)
    conditions.pressure = hpaToInHg(conditions.pressure);

  if (vcConditions.snow ?? conditions.precipType === 'snow')
    (conditions as DailyConditions).precipAccumulation = vcConditions.snow;

  return conditions;
}

function convertHourly(vcHourly: VCHourlyConditions[], isMetric: boolean): HourlyConditions[] {
  const hourly: HourlyConditions[] = [];
  const now = Date.now() / 1000;

  for (const hour of vcHourly) {
    hourly.push(convertConditions(hour, CommonConditionsKeys, 1, isMetric) as HourlyConditions);

    if (hourly.length >= 36)
      break;
  }

  return hourly.filter(hour => hour.time > now - 3600);
}

function convertDaily(vcDaily: VCDailyConditions[], isMetric: boolean, root: ForecastData): DailySummaryConditions {
  const daily: DailySummaryConditions = { data: [] } as DailySummaryConditions;

  if (!root.hourly)
    root.hourly = [];

  for (const day of vcDaily)
    daily.data.push(convertConditions(day, VCDailyConditionsKeys, 24, isMetric, root) as DailyConditions);

  return daily;
}

function convertAlerts(vcAlerts: VCAlert[]): Alert[] {
  return vcAlerts.map(vcAlert => {
    const alert: Alert = {} as Alert;
    const event = vcAlert.event + ',' + vcAlert.headline;

    if (/\bwarning\b/i.test(event))
      alert.severity = 'warning';
    else if (/\bwatch\b/i.test(event))
      alert.severity = 'watch';
    else
      alert.severity = 'advisory';

    alert.title = vcAlert.headline;
    alert.description = alertCleanUp(vcAlert.description);
    alert.time = nullIfError(floor(new Date(vcAlert.onset).getTime() / 1000));
    alert.expires = nullIfError(floor(new Date(vcAlert.ends).getTime() / 1000));

    return setAlertId(alert);
  });
}
