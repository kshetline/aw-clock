import { purgeCache, requestJson } from './request-cache';
import { Request } from 'express';
import {
  Alert, AlertKeys,
  CommonConditions,
  CurrentConditions,
  CurrentConditionsKeys,
  DailyConditions, DailyConditionsKeys, DailySummaryConditions, DailySummaryConditionsKeys,
  ForecastData,
  ForecastDataKeys, HourlyConditions
} from './shared-types';
import { checkForecastIntegrity } from './util';

// The time (with a month of padding) when the Dark Sky API will be shut down, presuming "end of 2021"
// actually means all the way until 2021-12-31.
export const THE_END_OF_DAYS = Date.UTC(2021, 10 /* November */, 30);

interface DSCurrentConditions extends Omit<CommonConditions, 'feelsLikeTemperature'> {
  apparentTemperature: number;
}

interface DSHourlyItems extends CommonConditions {
  temperature: number;
}

interface DSHourlyConditions {
  data: DSHourlyItems[];
}

interface DarkSkyForecast extends Omit<Omit<ForecastData, 'currently'>, 'hourly'> {
  currently: DSCurrentConditions;
  hourly: DSHourlyConditions;
  flags?: any;
}

export async function getForecast(req: Request): Promise<ForecastData | Error> {
  if (Date.now() > THE_END_OF_DAYS)
    return new Error('Dark Sky API no longer available');

  const isMetric = (req.query.du === 'c');
  const url = `https://api.darksky.net/forecast/${process.env.AWC_DARK_SKY_API_KEY}/` +
    `${req.query.lat},${req.query.lon}?exclude=minutely${isMetric ? '&units=ca' : ''}`;

  try {
    const origForecast = (await requestJson(240, url)) as DarkSkyForecast;
    const forecast = convertForecast(origForecast, isMetric);

    if (checkForecastIntegrity(forecast))
      return forecast;

    purgeCache(url);

    return new Error('Error retrieving Dark Sky data');
  }
  catch (err) {
    return new Error('Error connecting to Dark Sky: ' + err);
  }
}

const iconNames = ['clear-day', 'clear-night', 'wind', 'fog', 'partly-cloudy-day', 'partly-cloudy-night',
                   'cloudy', 'rain', 'sleet', 'snow'];
const iconCodes = ['32', '31', '19', 'fog', '28', '27',
                   '26', '12', '05', '13'];

function getIcon(conditions: CommonConditions, isMetric: boolean, ignorePrecipProbability = false): string {
  const iconIndex = iconNames.indexOf(conditions.icon);
  let icon = (iconIndex >= 0 ? iconCodes[iconIndex] : '');
  const summary = conditions.summary ? conditions.summary.toLowerCase() : '';
  let precipIntensity = conditions.precipIntensity ?? 0;
  let precipAccumulation = (conditions as DailyConditions).precipAccumulation || 0;

  // Metric precipitation rate is in mm/hr, and needs to be converted to inches/hr.
  // Accumulated precipitation is in cm, and needs to be converted to inches.
  if (isMetric) {
    precipIntensity /= 25.4;
    precipAccumulation /= 2.54;
  }

  // Sometimes the icon says "cloudy" or the like, but the numbers look more like rain or snow.
  // Change the icon if conditions look less favorable.
  if (!ignorePrecipProbability && iconIndex >= 0 && iconIndex <= 6 &&
      conditions.precipProbability >= 0.25 &&
      (precipIntensity >= 0.01 || (conditions.precipProbability >= 0.5 && precipIntensity > 0.0025) || precipAccumulation >= 0.25)) {
    if (conditions.precipType === 'snow')
      icon = '13';
    else if (conditions.precipType === 'sleet')
      icon = '05';
    else
      icon = '12';
  }

  // Dark Sky currently doesn't report thunderstorms as a condition by icon value. We'll try to make
  // up for that by looking at the summary.
  if (icon === '12' && (summary.indexOf('thunder') >= 0 || summary.indexOf('lightning') >= 0)) {
    icon = '38';

    if (summary.indexOf('scattered') >= 0 || summary.indexOf('isolated') >= 0)
      icon = '37';
  }
  else if (icon === '12' && precipIntensity < 0.01)
    icon = '09';

  if (conditions.cloudCover < 0.333) {
    if (icon === '28')
      icon = '30';
    else if (icon === '27')
      icon = '27';
  }

  return icon;
}

function convertForecast(dsForecast: DarkSkyForecast, isMetric: boolean): ForecastData {
  const forecast: ForecastData = { source: 'darksky', isMetric };

  Object.keys(dsForecast).forEach(key => {
    if (key === 'currently')
      forecast.currently = convertConditions(dsForecast.currently, CurrentConditionsKeys, isMetric) as CurrentConditions;
    else if (key === 'hourly')
      forecast.hourly = convertHourly(dsForecast.hourly, isMetric);
    else if (key === 'daily')
      forecast.daily = convertDaily(dsForecast.daily, isMetric);
    else if (key === 'alerts')
      forecast.alerts = convertAlerts(dsForecast.alerts);
    else if (ForecastDataKeys.includes(key))
      (forecast as any)[key] = (dsForecast as any)[key];
  });

  if ((dsForecast.flags && dsForecast.flags['darksky-unavailable']) || !forecast.currently || !forecast.daily)
    forecast.unavailable = true;

  return forecast;
}

function convertConditions(dsConditions: CommonConditions, keys: string[], isMetric: boolean): CommonConditions {
  const conditions: CommonConditions = {} as CommonConditions;

  Object.keys(dsConditions).forEach(key => {
    if (key === 'icon')
      conditions.icon = getIcon(dsConditions, isMetric);
    else if (key === 'apparentTemperature')
      (conditions as CurrentConditions).feelsLikeTemperature = (dsConditions as DSCurrentConditions).apparentTemperature;
    else if (keys.includes(key))
      (conditions as any)[key] = (dsConditions as any)[key];
  });

  return conditions;
}

function convertHourly(dsHourly: DSHourlyConditions, isMetric: boolean): HourlyConditions[] {
  const hourly: HourlyConditions[] = [];

  if (dsHourly.data) {
    for (const hour of dsHourly.data) {
      hourly.push({
        icon: getIcon(hour, isMetric),
        temperature: hour.temperature,
        precipProbability: hour.precipProbability,
        precipType: hour.icon === 'snow' || /\bsnow\b/i.test(hour.summary || '') ? 'snow' :
          hour.icon === 'rain' ? 'rain' : '',
        time: hour.time
      });

      if (hourly.length >= 36)
        break;
    }
  }

  return hourly;
}

function convertDaily(dsDaily: DailySummaryConditions, isMetric: boolean): DailySummaryConditions {
  const daily: DailySummaryConditions = {} as DailySummaryConditions;

  Object.keys(dsDaily).forEach(key => {
    if (key === 'data') {
      daily.data = dsDaily.data.map(conditions => convertConditions(conditions, DailyConditionsKeys, isMetric)) as DailyConditions[];
      daily.data.forEach((day, index) => day.narrativeDay = dsDaily.data[index].summary);
    }
    else if (DailySummaryConditionsKeys.includes(key))
      (daily as any)[key] = (dsDaily as any)[key];
  });

  return daily;
}

function convertAlerts(dsAlerts: Alert[]): Alert[] {
  return dsAlerts.map(dsAlert => {
    const alert: Alert = {} as Alert;

    Object.keys(dsAlert).forEach(key => {
      if (AlertKeys.includes(key))
        (alert as any)[key] = (dsAlert as any)[key];

      if (key === 'description')
        alert.description = alert.description.replace(/ (\* (WHAT|WHERE|WHEN|IMPACTS)|PRECAUTIONARY.*?ACTIONS)\.\.\./g,
          '\n\n$1...');
    });

    return alert;
  });
}
