import * as $ from 'jquery';
import { KsDateTime, KsTimeZone } from 'ks-date-time-zone';
import { updateTimezone } from './clock';
import { getTextWidth, setSvgHref } from './util';

interface CommonConditions {
  time: number;
  summary: string;
  icon: string;
  humidity: number;
  pressure: number;
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
  sunriseTime: number;
  sunsetTime: number;
  moonPhase: number;
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
}

let currentTemp: JQuery;
let feelsLike: JQuery;
let humidity: JQuery;
let currentIcon: JQuery;

let todayIcon: JQuery;
let todayLowHigh: JQuery;
let todaySunrise: JQuery;
let todaySunset: JQuery;
let todayMoon: JQuery;

let tomorrowIcon: JQuery;
let tomorrowLowHigh: JQuery;
let tomorrowSunrise: JQuery;
let tomorrowSunset: JQuery;
let tomorrowMoon: JQuery;

let nextDayIcon: JQuery;
let nextDayLowHigh: JQuery;
let nextDaySunrise: JQuery;
let nextDaySunset: JQuery;
let nextDayMoon: JQuery;

let marquee: JQuery;
let timezone: JQuery;

let lastForecast: Forecast;

export function initForecast() {
  currentTemp = $('#current-temp');
  feelsLike = $('#feels-like');
  humidity = $('#humidity');
  currentIcon = $('#current-icon');

  todayIcon = $('#today-icon');
  todayLowHigh = $('#today-low-high');
  todaySunrise = $('#today-sunrise');
  todaySunset = $('#today-sunset');
  todayMoon = $('#today-moon');

  tomorrowIcon = $('#tomorrow-icon');
  tomorrowLowHigh = $('#tomorrow-low-high');
  tomorrowSunrise = $('#tomorrow-sunrise');
  tomorrowSunset = $('#tomorrow-sunset');
  tomorrowMoon = $('#tomorrow-moon');

  nextDayIcon = $('#next-day-icon');
  nextDayLowHigh = $('#next-day-low-high');
  nextDaySunrise = $('#next-day-sunrise');
  nextDaySunset = $('#next-day-sunset');
  nextDayMoon = $('#next-day-moon');

  marquee = $('#marquee');
  timezone = $('#timezone');

  window.addEventListener('resize', updateMarqueeAnimation);
}

export function getForecast(latitude: number, longitude: number): Promise<Forecast> {
  const url = `https://weather.shetline.com/darksky/${latitude},${longitude}?exclude=minutely,hourly`;

  return new Promise((resolve, reject) => {
    $.ajax({
      url: url,
      dataType: 'json',
      success: (data: Forecast) => {
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
const EMPTY_ICON = 'assets/empty.svg';

function getIcon(conditions: CommonConditions, ignorePrecipProbability = false) {
  let icon = conditions.icon;
  const iconIndex = ['clear-day', 'clear-night', 'wind', 'fog', 'partly-cloudy-day', 'partly-cloudy-night', 'cloudy',
                     'rain', 'sleet', 'snow'].indexOf(icon);
  const summary = conditions.summary ? conditions.summary.toLowerCase() : '';
  const precipIntensityMax = (conditions as any).precipIntensityMax || 0;

  if (icon === 'rain' && summary.indexOf('thunder') >= 0) {
    icon = 'thunderstorm';

    if (summary.indexOf('scattered') >= 0 || summary.indexOf('isolated') >= 0)
      icon = 'scattered-thunderstorms-day';
  }
  else if (icon === 'rain' && (precipIntensityMax < 0.1 || precipIntensityMax === 0 && conditions.precipIntensity < 0.1)) {
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

function pad(n) {
  return (n < 10 ? '0' : '') + n;
}

function getMoonPhaseIcon(phase: number) {
  return `assets/moon/phase-${pad(Math.round(phase * 28) % 28)}.svg`;
}

function formatTime(zone: KsTimeZone, unixSeconds: number) {
  const date = new KsDateTime(unixSeconds * 1000, zone).wallTime;

  return pad(date.hrs) + ':' + pad(date.min);
}

export function showUnknown(error?: string) {
  setSvgHref(currentIcon, UNKNOWN_ICON);
  currentTemp.text('\u00A0--°');
  feelsLike.text('--°');
  humidity.text('--%');

  setSvgHref(todayIcon, UNKNOWN_ICON);
  todayLowHigh.text('--°/--°');
  todaySunrise.text('--:--');
  todaySunset.text('--:--');
  setSvgHref(todayMoon, EMPTY_ICON);

  setSvgHref(tomorrowIcon, UNKNOWN_ICON);
  tomorrowLowHigh.text('--°/--°');
  tomorrowSunrise.text('--:--');
  tomorrowSunset.text('--:--');
  setSvgHref(tomorrowMoon, EMPTY_ICON);

  setSvgHref(nextDayIcon, UNKNOWN_ICON);
  nextDayLowHigh.text('--°/--°');
  nextDaySunrise.text('--:--');
  nextDaySunset.text('--:--');
  setSvgHref(nextDayMoon, EMPTY_ICON);

  marquee.text(error || '\u00A0');
  timezone.text('');

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

export function updateForecast(latitude: number, longitude: number) {
  getForecast(latitude, longitude).then(forecast => {
    lastForecast = forecast;
    displayForecast(forecast);
  }).catch(error => {
    showUnknown(error);
  });
}

export function refreshForecastFromCache() {
  if (lastForecast)
    displayForecast(lastForecast);
}

export function displayForecast(forecast: Forecast) {
  let low: number;
  let high: number;
  const now = Date.now();
  const zone = KsTimeZone.getTimeZone(forecast.timezone);
  const today = new KsDateTime(now, zone).wallTime.d;
  const todayIndex = forecast.daily.data.findIndex(cond => new KsDateTime(cond.time * 1000, zone).wallTime.d === today);

  updateTimezone(zone);
  timezone.text(forecast.timezone);

  if (todayIndex < 0) {
    showUnknown('Missing data');
  }
  else {
    setSvgHref(currentIcon, getIcon(forecast.currently, true));
    currentTemp.text(`\u00A0${Math.round(forecast.currently.temperature)}°`);
    feelsLike.text(`${Math.round(forecast.currently.apparentTemperature)}°`);
    humidity.text(`${Math.round(forecast.currently.humidity * 100)}%`);

    setSvgHref(todayIcon, getIcon(forecast.daily.data[todayIndex]));
    low = Math.round(forecast.daily.data[todayIndex].temperatureLow);
    high = Math.round(forecast.daily.data[todayIndex].temperatureHigh);
    todayLowHigh.text(`${high}°/${low}°`);
    todaySunrise.text(formatTime(zone, forecast.daily.data[todayIndex].sunriseTime));
    todaySunset.text(formatTime(zone, forecast.daily.data[todayIndex].sunsetTime));
    setSvgHref(todayMoon, getMoonPhaseIcon(forecast.daily.data[todayIndex].moonPhase));

    if (forecast.daily.data.length > todayIndex + 1) {
      setSvgHref(tomorrowIcon, getIcon(forecast.daily.data[todayIndex + 1]));
      low = Math.round(forecast.daily.data[todayIndex + 1].temperatureLow);
      high = Math.round(forecast.daily.data[todayIndex + 1].temperatureHigh);
      tomorrowLowHigh.text(`${high}°/${low}°`);
      tomorrowSunrise.text(formatTime(zone, forecast.daily.data[todayIndex + 1].sunriseTime));
      tomorrowSunset.text(formatTime(zone, forecast.daily.data[todayIndex + 1].sunsetTime));
      setSvgHref(tomorrowMoon, getMoonPhaseIcon(forecast.daily.data[todayIndex + 1].moonPhase));
    } else {
      setSvgHref(tomorrowIcon, UNKNOWN_ICON);
      tomorrowLowHigh.text('--°/--°');
      tomorrowSunrise.text('--:--');
      tomorrowSunset.text('--:--');
      setSvgHref(tomorrowMoon, EMPTY_ICON);
    }

    if (forecast.daily.data.length > todayIndex + 2) {
      setSvgHref(nextDayIcon, getIcon(forecast.daily.data[todayIndex + 2]));
      low = Math.round(forecast.daily.data[todayIndex + 2].temperatureLow);
      high = Math.round(forecast.daily.data[todayIndex + 2].temperatureHigh);
      nextDayLowHigh.text(`${high}°/${low}°`);
      nextDaySunrise.text(formatTime(zone, forecast.daily.data[todayIndex + 2].sunriseTime));
      nextDaySunset.text(formatTime(zone, forecast.daily.data[todayIndex + 2].sunsetTime));
      setSvgHref(nextDayMoon, getMoonPhaseIcon(forecast.daily.data[todayIndex + 2].moonPhase));
    }
    else {
      setSvgHref(nextDayIcon, UNKNOWN_ICON);
      nextDayLowHigh.text('--°/--°');
      nextDaySunrise.text('--:--');
      nextDaySunset.text('--:--');
      setSvgHref(nextDayMoon, EMPTY_ICON);
    }

    let alertText = '';
    let maxSeverity = 0;

    if (forecast.alerts) {
      const alerts: string[] = [];

      forecast.alerts.forEach(alert => {
        const expires = alert.expires * 1000;

        if (expires >= now) {
          const severities = ['advisory', 'watch', 'warning'];
          maxSeverity = Math.max(severities.indexOf(alert.severity) + 1, maxSeverity);
          alerts.push(alert.title + ': ' + alert.description);
        }
      });

      alertText = alerts.join(' \u2022 '); // Bullet
    }

    if (alertText && maxSeverity > 0) {
      let background;
      let color;

      switch (maxSeverity) {
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
      marquee.text(forecast.daily.summary || '\u00A0');
      marquee.css('background-color', 'midnightblue');
      marquee.css('color', 'white');
    }

    updateMarqueeAnimation(null);
  }
}

let animationStyleSheet: CSSStyleSheet;
let keyframesIndex = 0;
let lastMarqueeText = '';

function updateMarqueeAnimation(event?: Event) {
  const newText = marquee.text();

  if (event === null && lastMarqueeText === newText)
    return;

  lastMarqueeText = newText;
  marquee.css('animation', 'none');

  const element = marquee[0];
  const textWidth = getTextWidth(newText, element);
  const padding = Number(window.getComputedStyle(element).getPropertyValue('padding-left').replace('px', '')) +
                  Number(window.getComputedStyle(element).getPropertyValue('padding-right').replace('px', ''));
  const offsetWidth = element.offsetWidth;

  if (textWidth + padding <= offsetWidth)
    return;

  if (!animationStyleSheet) {
    $('head').append('<style id="marquee-animations" type="text/css"></style>');
    animationStyleSheet = ($('#marquee-animations').get(0) as HTMLStyleElement).sheet as CSSStyleSheet;
  }

  if (animationStyleSheet.cssRules.length > 0)
    animationStyleSheet.deleteRule(0);

  const keyframesName = 'marquee-' + keyframesIndex++;
  const keyframesRule = `@keyframes ${keyframesName} { 0% { text-indent: ${offsetWidth}px } 100% { text-indent: -${textWidth}px; } }`;
  const seconds = (textWidth + offsetWidth) / 100;

  animationStyleSheet.insertRule(keyframesRule, 0);
  marquee.css('animation', `${keyframesName} ${seconds}s linear infinite`);
}
