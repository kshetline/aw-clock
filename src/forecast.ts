import * as $ from 'jquery';
import { KsDateTime, KsTimeZone } from 'ks-date-time-zone';
import { currentTime, setMarqueeIsAnimated, updateTimezone } from './clock';
import { getTextWidth, isEdge, isIE, isRaspbian, setSvgHref } from './util';

interface CommonConditions {
  time: number;
  summary: string;
  icon: string;
  humidity: number;
  cloudCover: number;
  precipProbability: number;
  precipIntensity: number;
  precipType?: string;
}

export interface CurrentConditions extends CommonConditions {
  temperature: number;
  apparentTemperature: number;
}

export interface DailyConditions extends CommonConditions {
  temperatureHigh: number;
  temperatureLow: number;
  precipIntensityMax: number;
  precipAccumulation: number;
}

export interface DailySummaryConditions {
  summary: string;
  icon: string;
  data: DailyConditions[];
}

export interface Alert {
  description: string;
  expires: number;
  regions: string[];
  severity: 'advisory' | 'watch' | 'warning';
  time: number;
  title: string;
  url: string;
}

export interface Flags {
  'darksky-unavailable'?: boolean;
  sources: string[];
  'isd-stations'?: string[];
  units: string;
}

export interface Forecast {
  latitude: number;
  longitude: number;
  timezone: string;
  currently?: CurrentConditions;
  daily?: DailySummaryConditions;
  alerts?: Alert[];
  flags?: Flags;
  frequent?: boolean;
  isMetric?: boolean;
  amPm?: boolean;
}

let currentTemp: JQuery;
let feelsLike: JQuery;
let humidity: JQuery;
let currentIcon: JQuery;

const dayIcons: JQuery[] = [];
const dayLowHighs: JQuery[] = [];
const dayChancePrecips: JQuery[] = [];
const dayPrecipAccums: JQuery[] = [];

let marquee: JQuery;

let lastForecast: Forecast;

let weather_server;

export function initForecast() {
  currentTemp = $('#current-temp');
  feelsLike = $('#feels-like');
  humidity = $('#humidity');
  currentIcon = $('#current-icon');

  for (let i = 0; i < 4; ++i) {
    dayIcons[i] = $('#day' + i + '-icon');
    dayLowHighs[i] = $('#day' + i + '-low-high');
    dayChancePrecips[i] = $('#day' + i + '-chance-precip');
    dayPrecipAccums[i] = $('#day' + i + '-precip-accum');
  }

  marquee = $('#marquee');

  if (!isIE() && !isEdge())
    weather_server = new URL(window.location.href).searchParams.get('weather_server') || 'http://localhost:8080';
  else
    weather_server = '';

  window.addEventListener('resize', updateMarqueeAnimation);
}

export function getForecast(latitude: number, longitude: number, isMetric: boolean, userId?: string): Promise<Forecast> {
  const runningDev = (document.location.port === '4200');
  const site = (runningDev ? weather_server || '' : '');
  let url = `${site}/darksky/${latitude},${longitude}?exclude=minutely,hourly`;

  if (isMetric)
    url += '&units=ca';

  if (userId)
    url += '&id=' + encodeURI(userId);

  return new Promise((resolve, reject) => {
    $.ajax({
      url: url,
      dataType: 'json',
      success: (data: Forecast, textStatus: string, jqXHR: JQueryXHR) => {
        data.isMetric = isMetric;

        const cacheControl = jqXHR.getResponseHeader('cache-control');

        if (cacheControl) {
          const match = /max-age=(\d+)/.exec(cacheControl);

          if (match && Number(match[1]) <= 300)
            data.frequent = true;
        }

        if (data.flags['darksky-unavailable'])
          reject('Dark Sky unavailable');
        else if (!data.currently || !data.daily || !data.daily.data || data.daily.data.length === 0)
          reject('Incomplete data');
        else
          resolve(data);
      },
      error: (jqXHR: JQueryXHR, textStatus: string, errorThrown: string) => {
        reject(errorThrown);
      }
    });
  });
}

const UNKNOWN_ICON = 'assets/unknown.svg';

function getIcon(conditions: CommonConditions, isMetric: boolean, ignorePrecipProbability = false) {
  let icon = conditions.icon;
  const iconIndex = ['clear-day', 'clear-night', 'wind', 'fog', 'partly-cloudy-day', 'partly-cloudy-night', 'cloudy',
                     'rain', 'sleet', 'snow'].indexOf(icon);
  const summary = conditions.summary ? conditions.summary.toLowerCase() : '';
  let precipIntensity = conditions.precipIntensity;
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
    if (conditions.precipType === 'snow') {
      icon = 'snow';
    }
    else if (conditions.precipType === 'sleet') {
      icon = 'sleet';
    }
    else {
      icon = 'rain';
    }
  }

  // Dark Sky currently doesn't report thunderstorms as a condition by icon value. We'll try to make
  // up for that by looking at the summary.
  if (icon === 'rain' && (summary.indexOf('thunder') >= 0 || summary.indexOf('lightning') >= 0)) {
    icon = 'thunderstorm';

    if (summary.indexOf('scattered') >= 0 || summary.indexOf('isolated') >= 0)
      icon = 'scattered-thunderstorms-day';
  }
  else if (icon === 'rain' && precipIntensity < 0.01) {
    icon = 'light-rain';
  }

  if (conditions.cloudCover < 0.333) {
    if (icon === 'partly-cloudy-day')
      icon = 'mostly-clear-day';
    else if (icon === 'partly-cloudy-night')
      icon = 'mostly-clear-night';
  }

  return `assets/${icon}.svg`;
}

export function showUnknown(error?: string) {
  setSvgHref(currentIcon, UNKNOWN_ICON);
  currentTemp.text('\u00A0--°');
  feelsLike.text('--°');
  humidity.text('--%');

  dayIcons.forEach((dayIcon, index) => {
    setSvgHref(dayIcon, UNKNOWN_ICON);
    dayLowHighs[index].text('--°/--°');
    dayChancePrecips[index].text('--%');
    dayPrecipAccums[index].text('--');
  });

  marquee.text(error || '\u00A0');

  if (error) {
    marquee.css('background-color', '#CCC');
    marquee.css('color', 'black');
  }
  else {
    marquee.css('background-color', 'midnightblue');
    marquee.css('color', 'white');
  }

  updateMarqueeAnimation(null);
}

export function updateForecast(latitude: number, longitude: number, isMetric: boolean, amPm: boolean, userId?: string): Promise<boolean> {
  return getForecast(latitude, longitude, isMetric, userId).then(forecast => {
    forecast.amPm = amPm;
    lastForecast = forecast;
    displayForecast(forecast);

    return !!forecast.frequent;
  }).catch(error => {
    showUnknown(error);

    return undefined;
  });
}

export function refreshForecastFromCache() {
  if (lastForecast)
    displayForecast(lastForecast);
}

export function displayForecast(forecast: Forecast) {
  const now = currentTime();
  const zone = KsTimeZone.getTimeZone(forecast.timezone);
  const today = new KsDateTime(now, zone);
  const todayIndex = forecast.daily.data.findIndex(cond => new KsDateTime(cond.time * 1000, zone).wallTime.d === today.wallTime.d);

  updateTimezone(zone);

  if (todayIndex < 0) {
    showUnknown('Missing data');
  }
  else {
    setSvgHref(currentIcon, getIcon(forecast.currently, true));
    currentTemp.text(`\u00A0${Math.round(forecast.currently.temperature)}°`);
    feelsLike.text(`${Math.round(forecast.currently.apparentTemperature)}°`);
    humidity.text(`${Math.round(forecast.currently.humidity * 100)}%`);

    dayIcons.forEach((dayIcon, index) => {
      if (forecast.daily.data.length > todayIndex + index) {
        const daily = forecast.daily.data[todayIndex + index];

        setSvgHref(dayIcon, getIcon(daily, forecast.isMetric));

        const low = Math.round(daily.temperatureLow);
        const high = Math.round(daily.temperatureHigh);

        dayLowHighs[index].text(`${high}°/${low}°`);

        let chancePrecip = Math.round(daily.precipProbability * 100) + '%';

        if (daily.precipType === 'snow')
          chancePrecip += '\u2744'; // snowflake
        else
          chancePrecip += '\u2614'; // umbrella with rain

        dayChancePrecips[index].text(chancePrecip);

        let accum = daily.precipAccumulation || 0;

        if (!accum) {
          if (forecast.isMetric) {
            accum = daily.precipIntensity * 2.4; // mm/hr -> cm/day

            if (daily.precipType === 'snow' && accum < 0.5 || accum < 0.05)
              accum = 0;
          }
          else {
            accum = daily.precipIntensity * 24; // in/hr -> in/day

            if (daily.precipType === 'snow' && accum < 0.2 || accum < 0.02)
              accum = 0;
          }
        }

        const precision = (accum < 0.995 ? 2 : (accum < 9.95 ? 1 : 0));

        dayPrecipAccums[index].text(accum > 0 ? accum.toFixed(precision) + (forecast.isMetric ? ' cm' : ' in') : '--');
      }
      else {
        setSvgHref(dayIcon, UNKNOWN_ICON);
        dayLowHighs[index].text('--°/--°');
        dayChancePrecips[index].text('--%');
        dayPrecipAccums[index].text('--');
      }
    });

    let alertText: string;
    let maxSeverity = 0;
    const alerts: string[] = [];

    if (forecast.daily.summary)
      alerts.push(forecast.daily.summary);

    if (forecast.alerts) {
      forecast.alerts.forEach(alert => {
        const expires = alert.expires * 1000;

        if (expires >= now) {
          const severities = ['advisory', 'watch', 'warning'];
          maxSeverity = Math.max(severities.indexOf(alert.severity) + 1, maxSeverity);
          alerts.push(alert.title + ': ' + alert.description);
        }
      });
    }

    alertText = alerts.join(' \u2022 '); // Bullet

    if (alertText) {
      let background;
      let color;

      switch (maxSeverity) {
        case 0:
          background = 'midnightblue';
          color = 'white';
        break;

        case 1:
          background = 'cyan';
          color = 'black';
        break;

        case 2:
          background = 'orange';
          color = 'black';
        break;

        case 3:
          background = 'red';
          color = 'white';
        break;
      }

      marquee.text(alertText);
      marquee.css('background-color', background);
      marquee.css('color', color);
    }
    else {
      marquee.text('\u00A0');
      marquee.css('background-color', 'midnightblue');
      marquee.css('color', 'white');
    }

    updateMarqueeAnimation(null);
  }
}

let animationStyleSheet: CSSStyleSheet;
let keyframesIndex = 0;
let lastMarqueeText = '';
const slowerFrameRate = isRaspbian();

function updateMarqueeAnimation(event?: Event) {
  const newText = marquee.text();

  if (event === null && lastMarqueeText === newText)
    return;

  lastMarqueeText = newText;
  marquee.css('animation', 'none');

  const element = marquee[0];
  const textWidth = getTextWidth(newText, element);
  const style = window.getComputedStyle(element);
  const padding = Number(style.getPropertyValue('padding-left').replace('px', '')) +
                  Number(style.getPropertyValue('padding-right').replace('px', ''));
  const offsetWidth = element.offsetWidth;

  if (textWidth + padding <= offsetWidth) {
    setMarqueeIsAnimated(false);
    return;
  }

  setMarqueeIsAnimated(true);

  if (!animationStyleSheet) {
    $('head').append('<style id="marquee-animations" type="text/css"></style>');
    animationStyleSheet = ($('#marquee-animations').get(0) as HTMLStyleElement).sheet as CSSStyleSheet;
  }

  if (animationStyleSheet.cssRules.length > 0)
    animationStyleSheet.deleteRule(0);

  const keyframesName = 'marquee-' + keyframesIndex++;
  const keyframesRule = `@keyframes ${keyframesName} { 0% { text-indent: ${offsetWidth}px } 100% { text-indent: -${textWidth}px; } }`;
  const seconds = (textWidth + offsetWidth) / 100;
  // When the Raspberry Pi tries to scroll the marquee as fast as it can, the result is very jerky. It will be better
  // to have a slow but steady frame rate the Raspberry Pi can keep up with.
  const linearOrSteps = (slowerFrameRate ? `steps(${Math.round(seconds * 30)})` : 'linear');

  animationStyleSheet.insertRule(keyframesRule, 0);
  marquee.css('animation', `${keyframesName} ${seconds}s infinite ${linearOrSteps}`);
}
