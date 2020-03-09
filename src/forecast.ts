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

import * as $ from 'jquery';
import { CurrentTemperatureHumidity } from './current-temp-manager';
import { ForecastData } from '../server/src/forecast-types';
import { KsDateTime, KsTimeZone } from 'ks-date-time-zone';
import { getTextWidth, isEdge, isIE } from 'ks-util';
import { setSvgHref } from './util';
import { AppService } from './app.service';
import { reflow } from './svg-flow';

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

const MARQUEE_SPEED = 100; // pixels per second

const FREQUENT_THRESHOLD = 300;

const MAX_FORECAST_STALENESS = 7200000; // 2 hours
const MAX_CURRENT_TEMP_STALENESS = 1800000; // 30 minutes

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

  private readonly weatherServer: string;

  private lastForecastData: ForecastData;
  private lastForecastTime = 0;
  private timezone = KsTimeZone.OS_ZONE;

  private marqueeText = '';
  private marqueeJoiner = '\u00A0\u00A0\u00A0\u25C8\u00A0\u00A0\u00A0'; // '   ◈   ', non-breaking spaces with bordered diamond
  private animationStart: number;
  private animationWidth: number;
  private animationDuration: number;
  private animationRequestId = 0;

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

    window.addEventListener('resize', () => this.updateMarqueeAnimation(null));
  }

  public update(latitude: number, longitude: number, isMetric: boolean, userId?: string): void {
    this.getForecast(latitude, longitude, isMetric, userId).then((forecastData: ForecastData) => {
      this.lastForecastData = forecastData;
      this.lastForecastTime = performance.now();
      this.appService.updateCurrentTemp({ forecastStale: false });
      this.displayForecast(forecastData);

      const ds = (forecastData.source === 'darksky');
      const wu = (forecastData.source === 'wunderground');
      const buttonWidth = this.settingsBtn.width();
      const logoWidth = (ds ? 125 : (wu ? 190 : 8)) + 10;

      this.darkskyLogo.css('display', ds ? 'inline-block' : 'none');
      this.wundergroundLogo.css('display', wu ? 'inline-block' : 'none');
      this.marqueeOuterWrapper.css('right', (buttonWidth + logoWidth) + 'px');
      this.settingsBtn.css('margin-right', ds || wu ? 0 : 8);

      this.appService.forecastHasBeenUpdated();
    }).catch(error => {
      const now = performance.now();

      if (!this.lastForecastData || now >= this.lastForecastTime + MAX_FORECAST_STALENESS) {
        this.appService.updateCurrentTemp(NO_DATA);
        this.showUnknown(error);
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

  public showUnknown(error?: string): void {
    setSvgHref(this.currentIcon, UNKNOWN_ICON);
    this.appService.updateCurrentTemp(NO_DATA);

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

          if (data.forecastUnavailable)
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
    const todayIndex = forecastData.daily.data.findIndex(cond => new KsDateTime(cond.time * 1000, this.timezone).wallTime.d === today.wallTime.d);

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

          setSvgHref(dayIcon, this.getIconSource(daily.icon));

          const low = Math.round(daily.temperatureLow);
          const high = Math.round(daily.temperatureHigh);

          this.dayLowHighs[index].text(`${high}°/${low}°`);

          let chancePrecip = Math.round(daily.precipProbability * 100) + '%';

          if (daily.precipType === 'snow')
            chancePrecip += '\u2744'; // snowflake
          else
            chancePrecip += '\u2614'; // umbrella with rain

          this.dayChancePrecips[index].text(daily.precipProbability > 0.01 ? chancePrecip : '--');

          const accum = daily.precipAccumulation || 0;
          const precision = (accum < 0.995 ? 2 : (accum < 9.95 ? 1 : 0));

          this.dayPrecipAccums[index].text(accum > 0 ? accum.toFixed(precision) + (forecastData.isMetric ? ' cm' : ' in') : '--');
        }
        else {
          setSvgHref(dayIcon, UNKNOWN_ICON);
          this.dayLowHighs[index].text('--°/--°');
          this.dayChancePrecips[index].text('--%');
          this.dayPrecipAccums[index].text('--');
        }
      });

      let newText;
      let maxSeverity = 0;
      const alerts: string[] = [];

      if (forecastData.daily.summary)
        alerts.push(forecastData.daily.summary);

      if (forecastData.alerts) {
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

    setTimeout(reflow);
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
    const textWidth = getTextWidth(newText, this.marquee[0]);

    this.marquee.css('width', marqueeWidth + 'px');
    this.marquee.css('text-indent', '0');

    if (textWidth <= marqueeWidth) {
      this.marquee.text(newText);
      this.animationStart = 0;
      this.appService.updateMarqueeState(false);

      if (this.animationRequestId) {
        window.cancelAnimationFrame(this.animationRequestId);
        this.animationRequestId = 0;
      }

      return;
    }

    this.marquee.text(newText + this.marqueeJoiner + newText);
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
