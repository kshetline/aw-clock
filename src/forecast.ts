/*
  Copyright © 2018-2020 Kerry Shetline, kerry@shetline.com

  MIT license: https://opensource.org/licenses/MIT

  Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
  documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
  rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
  persons to whom the Software is furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
  Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
  WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
  COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
  OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

import { AppService } from './app.service';
import { CurrentTemperatureHumidity } from './current-temp-manager';
import * as $ from 'jquery';
import { KsDateTime, KsTimeZone } from 'ks-date-time-zone';
import { doesCharacterGlyphExist, getTextWidth, isEdge, isIE } from 'ks-util';
import { reflow } from './svg-flow';
import { htmlEncode, setSvgHref } from './util';
import { ForecastData, HourlyConditions } from '../server/src/weather-types';
import { cos_deg, sin_deg } from 'ks-math';
import { CLOCK_CENTER } from './clock';

const DEFAULT_BACKGROUND = 'midnightblue';
const DEFAULT_FOREGROUND = 'white';
const ERROR_BACKGROUND = '#CCC';
const ERROR_FOREGROUND = 'black';
const ADVISORY_BACKGROUND = 'cyan';
const ADVISORY_FOREGROUND = 'black';
const WATCH_BACKGROUND = 'orange';
const WATCH_FOREGROUND = 'black';
const WARNING_BACKGROUND = 'red';
const WARNING_FOREGROUND = 'white';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const CLOCK_ICON_RADIUS = 38;
const CLOCK_ICON_INNER_RADIUS = 31;
const CLOCK_TEMPS_RADIUS = 34.5;
const CLOCK_TEMPS_INNER_RADIUS = 27;
const CLOCK_ICON_SIZE = 3.5;
const START_ERROR_TAG = `<span style="color: ${ERROR_FOREGROUND}; background-color: ${ERROR_BACKGROUND};">&nbsp;`;
const CLOSE_ERROR_TAG = '&nbsp;</span>';

const MARQUEE_SPEED = 100; // pixels per second

const FREQUENT_THRESHOLD = 300;

const MAX_FORECAST_STALENESS = 7200000; // 2 hours
const MAX_CURRENT_TEMP_STALENESS = 1800000; // 30 minutes

const EMPTY_ICON = 'assets/empty.svg';
const UNKNOWN_ICON = 'assets/unknown.svg';
const NO_DATA: CurrentTemperatureHumidity = { forecastFeelsLike: null, forecastHumidity: null, forecastStale: null, forecastTemp: null };

export class Forecast {
  private readonly currentIcon: JQuery;
  private readonly darkskyLogo: JQuery;
  private readonly marqueeOuterWrapper: JQuery;
  private readonly marqueeWrapper: JQuery;
  private readonly marquee: JQuery;
  private readonly settingsBtn: JQuery;
  private readonly weatherLogo: JQuery;
  private readonly wundergroundLogo: JQuery;

  private dayIcons: JQuery[] = [];
  private dayLowHighs: JQuery[] = [];
  private dayChancePrecips: JQuery[] = [];
  private dayPrecipAccums: JQuery[] = [];
  private hourIcons: SVGImageElement[] = [];
  private hourTemps: SVGTextElement[] = [];

  private readonly weatherServer: string;

  private _hideHourlyForecast = false;
  private lastForecastData: ForecastData;
  private cachedHourly: HourlyConditions[] = [];
  private lastForecastTime = 0;
  private timezone = KsTimeZone.OS_ZONE;

  private marqueeText = ' ';
  private marqueeJoiner = '\u00A0\u00A0\u00A0\u25C8\u00A0\u00A0\u00A0'; // '   ◈   ', non-breaking spaces with bordered diamond
  private animationStart: number;
  private animationWidth: number;
  private animationDuration: number;
  private animationRequestId = 0;
  private rainGlyph: string;
  private snowGlyph: string;

  constructor(private appService: AppService) {
    this.currentIcon = $('#current-icon');

    for (let i = 0; i < 4; ++i) {
      this.dayIcons[i] = $('#day' + i + '-icon');
      this.dayLowHighs[i] = $('#day' + i + '-low-high');
      this.dayChancePrecips[i] = $('#day' + i + '-chance-precip');
      this.dayPrecipAccums[i] = $('#day' + i + '-precip-accum');
    }

    this.darkskyLogo = $('#darksky-logo');
    this.settingsBtn = $('#settings-btn');
    this.weatherLogo = $('.weather-logo');
    this.wundergroundLogo = $('#wunderground-logo');

    this.marqueeOuterWrapper = $('#marquee-outer-wrapper');
    this.marqueeWrapper = $('#marquee-wrapper');
    this.marquee = $('#marquee');

    if (!isIE() && !isEdge())
      this.weatherServer = appService.getWeatherServer();
    else
      this.weatherServer = '';

    this.decorateClockFace();

    window.addEventListener('resize', () => this.updateMarqueeAnimation(null));
  }

  private decorateClockFace(): void {
    const clock = document.getElementById('clock');

    for (let i = 0; i < 24; ++i) {
      const deg = i * 30 + 15;
      let r = (i < 12 ? CLOCK_ICON_RADIUS : CLOCK_ICON_INNER_RADIUS);
      let x = CLOCK_CENTER + r * cos_deg(deg - 90);
      let y = CLOCK_CENTER + r * sin_deg(deg - 90);
      const hourIcon = document.createElementNS(SVG_NAMESPACE, 'image');
      const hourTemp = document.createElementNS(SVG_NAMESPACE, 'text');

      hourIcon.setAttribute('x', (x - CLOCK_ICON_SIZE / 2).toString());
      hourIcon.setAttribute('y', (y - CLOCK_ICON_SIZE / 2).toString());
      hourIcon.setAttribute('height', CLOCK_ICON_SIZE.toString());
      hourIcon.setAttribute('width', CLOCK_ICON_SIZE.toString());
      hourIcon.setAttribute('href', EMPTY_ICON);
      hourIcon.style.opacity = '0.6';

      clock.appendChild(hourIcon);
      this.hourIcons[i] = hourIcon;

      r = (i < 12 ? CLOCK_TEMPS_RADIUS : CLOCK_TEMPS_INNER_RADIUS);
      x = CLOCK_CENTER + r * cos_deg(deg - 90);
      y = CLOCK_CENTER + r * sin_deg(deg - 90);
      hourTemp.setAttribute('x', x.toString());
      hourTemp.setAttribute('y', y.toString());
      hourTemp.setAttribute('dy', '0.5em');
      hourTemp.classList.add('clock-temps');
      hourTemp.style.opacity = '0.6';

      clock.appendChild(hourTemp);
      this.hourTemps[i] = hourTemp;
    }
  }

  public update(latitude: number, longitude: number, isMetric: boolean, userId?: string): void {
    this.getForecast(latitude, longitude, isMetric, userId).then((forecastData: ForecastData) => {
      this.updateHourlyCache(forecastData);
      this.lastForecastData = forecastData;
      this.lastForecastTime = performance.now();
      this.appService.updateCurrentTemp({ forecastStale: false });
      this.displayForecast(forecastData);

      const ds = (forecastData.source === 'darksky');
      const wu = (forecastData.source === 'wunderground');
      const buttonWidth = this.settingsBtn.width();
      const logoWidth = (ds ? 118 : (wu ? 183 : 8)) + 10;

      this.darkskyLogo.css('display', ds ? 'inline-block' : 'none');
      this.wundergroundLogo.css('display', wu ? 'inline-block' : 'none');
      this.marqueeOuterWrapper.css('right', (buttonWidth + logoWidth) + 'px');
      this.settingsBtn.css('margin-right', ds || wu ? 0 : 8);

      this.appService.forecastHasBeenUpdated();
    }).catch(error => {
      const now = performance.now();

      if (!this.lastForecastData || now >= this.lastForecastTime + MAX_FORECAST_STALENESS) {
        this.appService.updateCurrentTemp(NO_DATA);
        this.showUnknown(error.toString());
      }
      else {
        if (now >= this.lastForecastTime + MAX_CURRENT_TEMP_STALENESS)
          this.appService.updateCurrentTemp(NO_DATA);

        this.appService.updateCurrentTemp({ forecastStale: true });
        this.displayForecast(this.lastForecastData);
      }

      this.appService.forecastHasBeenUpdated();
    });
  }

  public refreshFromCache(): void {
    if (this.lastForecastData)
      this.displayForecast(this.lastForecastData);
  }

  public clearCache(): void {
    this.lastForecastData = undefined;
    this.cachedHourly = [];
  }

  // noinspection JSUnusedGlobalSymbols
  get hideHourlyForecast(): boolean { return this._hideHourlyForecast; }
  set hideHourlyForecast(value: boolean) {
    if (this._hideHourlyForecast !== value) {
      this._hideHourlyForecast = value;
      this.hourIcons.forEach(icon => icon.style.display = value ? 'none' : 'block');
      this.hourTemps.forEach(temp => temp.style.display = value ? 'none' : 'block');
    }
  }

  private updateHourlyCache(forecastData: ForecastData): void {
    const now = this.appService.getCurrentTime() / 1000;
    let earliestNew = forecastData.hourly[0]?.time ?? 0;
    let inserted = 0;

    this.cachedHourly = this.cachedHourly.filter(hour => hour.time > now - 7200 && hour.time < now);

    if (now < earliestNew) {
      this.cachedHourly.forEach(hour => {
        if (hour.time < earliestNew) {
          forecastData.hourly.splice(0, 0, hour);
          ++inserted;
        }
      });
    }

    earliestNew = forecastData.hourly[0]?.time ?? 0;

    // Still nothing to cover the current hour? Fake it from current conditions.
    if (now < earliestNew && forecastData?.currently)
      forecastData.hourly.splice(0, 0, {
        icon: forecastData.currently.icon,
        precipType: forecastData.currently.precipType,
        temperature: forecastData.currently.temperature,
        time: Math.floor(now / 3600) * 3600
      });

    for (let i = inserted; i < forecastData.hourly.length; ++i) {
      if (forecastData.hourly[i].time < now + 7200)
        this.cachedHourly.push(forecastData.hourly[i]);
      else
        break;
    }
  }

  public showUnknown(error?: string): void {
    setSvgHref(this.currentIcon, UNKNOWN_ICON);
    this.appService.updateCurrentTemp(NO_DATA);
    this.hourIcons.forEach(icon => icon.setAttribute('href', EMPTY_ICON));
    this.hourTemps.forEach(icon => icon.textContent = '');

    this.dayIcons.forEach((dayIcon, index) => {
      setSvgHref(dayIcon, UNKNOWN_ICON);
      this.dayLowHighs[index].text('--°/--°');
      this.dayChancePrecips[index].text('--%');
      this.dayPrecipAccums[index].text('--');
    });

    if (error) {
      this.marqueeOuterWrapper.css('background-color', ERROR_BACKGROUND);
      this.marqueeOuterWrapper.css('color', ERROR_FOREGROUND);
    }
    else {
      this.marqueeOuterWrapper.css('background-color', DEFAULT_BACKGROUND);
      this.marqueeOuterWrapper.css('color', DEFAULT_FOREGROUND);
    }

    this.updateMarqueeAnimation(error || '\u00A0');
  }

  public getTimezone(): KsTimeZone {
    return this.timezone;
  }

  public getFrequent(): boolean {
    return !!this.lastForecastData?.frequent;
  }

  private getForecast(latitude: number, longitude: number, isMetric: boolean, userId?: string): Promise<ForecastData> {
    let url = `${this.weatherServer}/forecast/?lat=${latitude}&lon=${longitude}&du=${isMetric ? 'c' : 'f'}`;

    if (userId)
      url += '&id=' + encodeURI(userId);

    return new Promise((resolve, reject) => {
      // noinspection JSIgnoredPromiseFromCall
      $.ajax({
        url,
        dataType: 'json',
        success: (data: ForecastData, textStatus: string, jqXHR: JQueryXHR) => {
          data.isMetric = isMetric;

          const cacheControl = jqXHR.getResponseHeader('cache-control');

          if (cacheControl) {
            const match = /max-age=(\d+)/.exec(cacheControl);

            if (match && Number(match[1]) <= FREQUENT_THRESHOLD)
              data.frequent = true;
          }

          if (data.unavailable)
            reject(new Error('Forecast unavailable'));
          else if (!data.currently || !data.daily || !data.daily.data || data.daily.data.length === 0)
            reject(new Error('Incomplete data'));
          else
            resolve(data);
        },
        error: (jqXHR: JQueryXHR, textStatus: string, errorThrown: string) => {
          reject(errorThrown);
        }
      });
    });
  }

  getIconSource(icon: string) {
    if (/^\d\d$/.test(icon))
      return `assets/indexed-weather/${icon}.svg`;
    else
      return `assets/${icon}.svg`;
  }

  private displayForecast(forecastData: ForecastData) {
    this.timezone = KsTimeZone.getTimeZone(forecastData.timezone);

    const now = this.appService.getCurrentTime();
    const today = new KsDateTime(now, this.timezone);
    const firstHourInfo = forecastData.hourly.findIndex(hourInfo => hourInfo.time * 1000 >= now);
    const hour = today.wallTime.hrs % 12;

    for (let i = 0; i < 24; ++i) {
      let icon = EMPTY_ICON;
      let temp = '';
      const index = (hour + i) % 24;
      const hourInfo = forecastData.hourly[i + firstHourInfo];

      if (hourInfo && firstHourInfo >= 0 && i < 23) {
        icon = this.getIconSource(hourInfo.icon);
        temp = hourInfo.temperature.toFixed(0) + '°';
      }

      this.hourIcons[index].setAttribute('href', icon);
      this.hourTemps[index].textContent = temp;
      this.hourTemps[index].style.fontSize = (temp.length > 3 ? '1.2px' : '1.6px');
    }

    const todayIndex = forecastData.daily.data.findIndex(cond => {
      const wallTime = new KsDateTime(cond.time * 1000, this.timezone).wallTime;

      return wallTime.y === today.wallTime.y && wallTime.m === today.wallTime.m && wallTime.d === today.wallTime.d;
    });

    if (todayIndex < 0) {
      this.showUnknown('Missing data');
    }
    else {
      this.appService.updateCurrentTemp({
        forecastFeelsLike: forecastData.currently.feelsLikeTemperature,
        forecastHumidity: forecastData.currently.humidity * 100,
        forecastTemp: forecastData.currently.temperature,
      });

      setSvgHref(this.currentIcon, this.getIconSource(forecastData.currently.icon));

      this.dayIcons.forEach((dayIcon, index) => {
        if (forecastData.daily.data.length > todayIndex + index) {
          const daily = forecastData.daily.data[todayIndex + index];
          const textElem = this.dayPrecipAccums[index];

          setSvgHref(dayIcon, this.getIconSource(daily.icon));

          const low = Math.round(daily.temperatureLow);
          const high = Math.round(daily.temperatureHigh);

          this.dayLowHighs[index].text(`${high}°/${low}°`);

          let chancePrecip = Math.round(daily.precipProbability * 100) + '%';

          if (!this.rainGlyph) // Raindrop emoji, or umbrella with raindrops
            this.rainGlyph = doesCharacterGlyphExist(textElem[0], '\uD83D\uDCA7') ? '\uD83D\uDCA7' : '\u2614';

          if (!this.snowGlyph) // Snowflake emoji, or more basic snowflake character
            this.snowGlyph = doesCharacterGlyphExist(textElem[0], '\u2744\uFE0F') ? '\u2744\uFE0F' : '\u2744';

          if (daily.precipType === 'snow')
            chancePrecip = this.snowGlyph + chancePrecip;
          else
            chancePrecip = this.rainGlyph + chancePrecip;

          this.dayChancePrecips[index].text(daily.precipProbability > 0.01 ? chancePrecip : '--');

          const accum = daily.precipAccumulation || 0;
          const precision = (accum < 0.995 ? 2 : (accum < 9.95 ? 1 : 0));

          textElem.text(accum > 0 ? accum.toFixed(precision) + (forecastData.isMetric ? ' cm' : ' in') : '--');
        }
        else {
          setSvgHref(dayIcon, UNKNOWN_ICON);
          this.dayLowHighs[index].text('--°/--°');
          this.dayChancePrecips[index].text('--%');
          this.dayPrecipAccums[index].text('--');
        }
      });

      this.refreshAlerts(forecastData);
    }

    setTimeout(reflow);
  }

  public refreshAlerts(forecastData = this.lastForecastData) {
    let newText;
    let maxSeverity = 0;
    const alerts: string[] = [];
    const now = this.appService.getCurrentTime();

    if (this.appService.sensorDeadAir())
      alerts.push('{{WIRELESS TEMPERATURE/HUMIDITY SIGNAL NOT PRESENT - possible disconnect or bad pin assignment}}');

    if (forecastData?.daily.summary)
      alerts.push(forecastData.daily.summary);

    if (forecastData?.alerts) {
      forecastData.alerts.forEach(alert => {
        const expires = alert.expires * 1000;

        if (expires >= now) {
          const severities = ['advisory', 'watch', 'warning'];
          maxSeverity = Math.max(severities.indexOf(alert.severity) + 1, maxSeverity);
          alerts.push(alert.title + ': ' + alert.description);
        }
      });
    }

    const alertText = alerts.join(' \u2022 '); // Bullet

    if (alertText) {
      let background;
      let color;

      switch (maxSeverity) {
        case 0:
          background = DEFAULT_BACKGROUND;
          color = DEFAULT_FOREGROUND;
          break;

        case 1:
          background = ADVISORY_BACKGROUND;
          color = ADVISORY_FOREGROUND;
          break;

        case 2:
          background = WATCH_BACKGROUND;
          color = WATCH_FOREGROUND;
          break;

        case 3:
          background = WARNING_BACKGROUND;
          color = WARNING_FOREGROUND;
          break;
      }

      newText = alertText;
      this.marqueeOuterWrapper.css('background-color', background);
      this.marqueeOuterWrapper.css('color', color);
    }
    else {
      newText = '\u00A0';
      this.marqueeOuterWrapper.css('background-color', DEFAULT_BACKGROUND);
      this.marqueeOuterWrapper.css('color', DEFAULT_FOREGROUND);
    }

    this.updateMarqueeAnimation(newText);
  }

  private updateMarqueeAnimation(newText: string): void {
    if (newText !== null) {
      if (newText === this.marqueeText)
        return;
      else
        this.marqueeText = newText;
    }
    else
      newText = this.marqueeText;

    const marqueeWidth = this.marqueeWrapper[0].offsetWidth;
    const textWidth = getTextWidth(newText.replace(/{{|}}/g, '\u00A0'), this.marquee[0]);

    newText = htmlEncode(newText).replace(/{{/g, START_ERROR_TAG).replace(/}}/g, CLOSE_ERROR_TAG);
    this.marquee.css('width', marqueeWidth + 'px');
    this.marquee.css('text-indent', '0');

    if (textWidth <= marqueeWidth) {
      this.marquee.html(newText);
      this.animationStart = 0;
      this.appService.updateMarqueeState(false);

      if (this.animationRequestId) {
        window.cancelAnimationFrame(this.animationRequestId);
        this.animationRequestId = 0;
      }

      return;
    }

    this.marquee.html(newText + this.marqueeJoiner + newText);
    this.animationStart = performance.now();
    this.animationWidth = textWidth + getTextWidth(this.marqueeJoiner, this.marquee[0]);
    this.animationDuration = this.animationWidth / MARQUEE_SPEED * 1000;
    this.animationRequestId = window.requestAnimationFrame(() => this.animate());
    this.appService.updateMarqueeState(true);
  }

  private animate(): void {
    if (!this.animationStart)
      return;

    const now = performance.now();
    const timeIntoScroll = now - this.animationStart;
    const scrollOffset = (timeIntoScroll / 1000 * MARQUEE_SPEED) % this.animationWidth;

    this.marquee.css('text-indent', `-${scrollOffset}px`);
    this.animationRequestId = window.requestAnimationFrame(() => this.animate());
  }
}
