import { requestJson } from 'by-request';
import { Request } from 'express';
import {
  Alert, AlertKeys,
  CommonConditions,
  CurrentConditions,
  CurrentConditionsKeys,
  DailyConditions, DailyConditionsKeys, DailySummaryConditions, DailySummaryConditionsKeys,
  ForecastData,
  ForecastDataKeys
} from './weather-types';

interface DSCurrentConditions extends Omit<CommonConditions, 'feelsLikeTemperature'> {
  apparentTemperature: number;
}

interface DarkSkyForecast extends Omit<ForecastData, 'currently'> {
  currently: DSCurrentConditions
  flags?: any;
}

export async function getForecast(req: Request): Promise<ForecastData | Error> {
  const isMetric = (req.query.du === 'c');
  const url = `https://api.darksky.net/forecast/${process.env.AWC_DARK_SKY_API_KEY}/` +
    `${req.query.lat},${req.query.lon}?exclude=minutely,hourly${isMetric ? '&units=ca' : ''}`;

  try {
    const origForecast = (await requestJson(url)) as DarkSkyForecast;

    return convertForecast(origForecast, isMetric);
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

function convertDaily(dsDaily: DailySummaryConditions, isMetric: boolean): DailySummaryConditions {
  const daily: DailySummaryConditions = {} as DailySummaryConditions;

  Object.keys(dsDaily).forEach(key => {
    if (key === 'data')
      daily.data = dsDaily.data.map(conditions => convertConditions(conditions, DailyConditionsKeys, isMetric)) as DailyConditions[];
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
    });

    return alert;
  });
}
