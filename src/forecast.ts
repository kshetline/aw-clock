/*
  Copyright © 2018 Kerry Shetline, kerry@shetline.com

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
import { KsDateTime, KsTimeZone } from 'ks-date-time-zone';
import { getTextWidth, isEdge, isIE, isRaspbian } from 'ks-util';
import { setSvgHref } from './util';
import { AppService } from './app.service';

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

interface CurrentConditions extends CommonConditions {
  temperature: number;
  apparentTemperature: number;
}

interface DailyConditions extends CommonConditions {
  temperatureHigh: number;
  temperatureLow: number;
  precipIntensityMax: number;
  precipAccumulation: number;
}

interface DailySummaryConditions {
  summary: string;
  icon: string;
  data: DailyConditions[];
}

interface Alert {
  description: string;
  expires: number;
  regions: string[];
  severity: 'advisory' | 'watch' | 'warning';
  time: number;
  title: string;
  url: string;
}

interface Flags {
  'darksky-unavailable'?: boolean;
  sources: string[];
  'isd-stations'?: string[];
  units: string;
}

interface ForecastData {
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

const UNKNOWN_ICON = 'assets/unknown.svg';

export class Forecast {
  private currentTemp: JQuery;
  private feelsLike: JQuery;
  private humidity: JQuery;
  private currentIcon: JQuery;
  private marquee: JQuery;

  private dayIcons: JQuery[] = [];
  private dayLowHighs: JQuery[] = [];
  private dayChancePrecips: JQuery[] = [];
  private dayPrecipAccums: JQuery[] = [];

  private weatherServer = '';

  private lastForecastData: ForecastData;
  private timezone = KsTimeZone.OS_ZONE;

  private animationStyleSheet: CSSStyleSheet;
  private keyframesIndex = 0;
  private lastMarqueeText = '';
  private slowerFrameRate = false;

  constructor(private appService: AppService) {
    this.currentTemp = $('#current-temp');
    this.feelsLike = $('#feels-like');
    this.humidity = $('#humidity');
    this.currentIcon = $('#current-icon');

    for (let i = 0; i < 4; ++i) {
      this.dayIcons[i] = $('#day' + i + '-icon');
      this.dayLowHighs[i] = $('#day' + i + '-low-high');
      this.dayChancePrecips[i] = $('#day' + i + '-chance-precip');
      this.dayPrecipAccums[i] = $('#day' + i + '-precip-accum');
    }

    this.marquee = $('#marquee');

    if (!isIE() && !isEdge())
      this.weatherServer = new URL(window.location.href).searchParams.get('weather_server') || 'http://localhost:8080';

    window.addEventListener('resize', () => this.updateMarqueeAnimation());
    $('head').append('<style id="marquee-animations" type="text/css"></style>');
    this.animationStyleSheet = ($('#marquee-animations').get(0) as HTMLStyleElement).sheet as CSSStyleSheet;

    if (isRaspbian())
      this.slowerFrameRate = true;
  }

  public update(latitude: number, longitude: number, isMetric: boolean, amPm: boolean, userId?: string): void {
    this.getForecast(latitude, longitude, isMetric, userId).then(forecastData => {
      forecastData.amPm = amPm;
      this.lastForecastData = forecastData;
      this.displayForecast(forecastData);
      this.appService.forecastHasBeenUpdated();
    }).catch(error => {
      this.showUnknown(error);
      this.appService.forecastHasBeenUpdated();
    });
  }

  public refreshFromCache(): void {
    if (this.lastForecastData)
      this.displayForecast(this.lastForecastData);
  }

  public showUnknown(error?: string): void {
    setSvgHref(this.currentIcon, UNKNOWN_ICON);
    this.currentTemp.text('\u00A0--°');
    this.feelsLike.text('--°');
    this.humidity.text('--%');

    this.dayIcons.forEach((dayIcon, index) => {
      setSvgHref(dayIcon, UNKNOWN_ICON);
      this.dayLowHighs[index].text('--°/--°');
      this.dayChancePrecips[index].text('--%');
      this.dayPrecipAccums[index].text('--');
    });

    this.marquee.text(error || '\u00A0');

    if (error) {
      this.marquee.css('background-color', '#CCC');
      this.marquee.css('color', 'black');
    }
    else {
      this.marquee.css('background-color', 'midnightblue');
      this.marquee.css('color', 'white');
    }

    this.updateMarqueeAnimation(null);
  }

  public getTimezone(): KsTimeZone {
    return this.timezone;
  }

  public getFrequent(): boolean {
    return this.lastForecastData && this.lastForecastData.frequent;
  }

  private getForecast(latitude: number, longitude: number, isMetric: boolean, userId?: string): Promise<ForecastData> {
    const runningDev = (document.location.port === '4200');
    const site = (runningDev ? this.weatherServer || '' : '');
    let url = `${site}/darksky/${latitude},${longitude}?exclude=minutely,hourly`;

    if (isMetric)
      url += '&units=ca';

    if (userId)
      url += '&id=' + encodeURI(userId);

    return new Promise((resolve, reject) => {
      $.ajax({
        url: url,
        dataType: 'json',
        success: (data: ForecastData, textStatus: string, jqXHR: JQueryXHR) => {
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

  // noinspection JSMethodCanBeStatic
  private getIcon(conditions: CommonConditions, isMetric: boolean, ignorePrecipProbability = false): string {
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

  private displayForecast(forecastData: ForecastData) {
    this.timezone = KsTimeZone.getTimeZone(forecastData.timezone);

    const now = this.appService.getCurrentTime();
    const today = new KsDateTime(now, this.timezone);
    const todayIndex = forecastData.daily.data.findIndex(cond => new KsDateTime(cond.time * 1000, this.timezone).wallTime.d === today.wallTime.d);

    if (todayIndex < 0) {
      this.showUnknown('Missing data');
    }
    else {
      setSvgHref(this.currentIcon, this.getIcon(forecastData.currently, true));
      this.currentTemp.text(`\u00A0${Math.round(forecastData.currently.temperature)}°`);
      this.feelsLike.text(`${Math.round(forecastData.currently.apparentTemperature)}°`);
      this.humidity.text(`${Math.round(forecastData.currently.humidity * 100)}%`);

      this.dayIcons.forEach((dayIcon, index) => {
        if (forecastData.daily.data.length > todayIndex + index) {
          const daily = forecastData.daily.data[todayIndex + index];

          setSvgHref(dayIcon, this.getIcon(daily, forecastData.isMetric));

          const low = Math.round(daily.temperatureLow);
          const high = Math.round(daily.temperatureHigh);

          this.dayLowHighs[index].text(`${high}°/${low}°`);

          let chancePrecip = Math.round(daily.precipProbability * 100) + '%';

          if (daily.precipType === 'snow')
            chancePrecip += '\u2744'; // snowflake
          else
            chancePrecip += '\u2614'; // umbrella with rain

          this.dayChancePrecips[index].text(chancePrecip);

          let accum = daily.precipAccumulation || 0;

          if (!accum) {
            if (forecastData.isMetric) {
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

          this.dayPrecipAccums[index].text(accum > 0 ? accum.toFixed(precision) + (forecastData.isMetric ? ' cm' : ' in') : '--');
        }
        else {
          setSvgHref(dayIcon, UNKNOWN_ICON);
          this.dayLowHighs[index].text('--°/--°');
          this.dayChancePrecips[index].text('--%');
          this.dayPrecipAccums[index].text('--');
        }
      });

      let alertText: string;
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

        this.marquee.text(alertText);
        this.marquee.css('background-color', background);
        this.marquee.css('color', color);
      }
      else {
        this.marquee.text('\u00A0');
        this.marquee.css('background-color', 'midnightblue');
        this.marquee.css('color', 'white');
      }

      this.updateMarqueeAnimation(null);
    }
  }

  private updateMarqueeAnimation(event?: Event): void {
    const newText = this.marquee.text();

    if (event === null && this.lastMarqueeText === newText)
      return;

    this.lastMarqueeText = newText;
    this.marquee.css('animation', 'none');

    const element = this.marquee[0];
    const textWidth = getTextWidth(newText, element);
    const style = window.getComputedStyle(element);
    const padding = Number(style.getPropertyValue('padding-left').replace('px', '')) +
                    Number(style.getPropertyValue('padding-right').replace('px', ''));
    const offsetWidth = element.offsetWidth;

    if (textWidth + padding <= offsetWidth) {
      this.appService.updateMarqueeState(false);
      return;
    }

    this.appService.updateMarqueeState(true);

    if (this.animationStyleSheet.cssRules.length > 0)
      this.animationStyleSheet.deleteRule(0);

    const keyframesName = 'marquee-' + this.keyframesIndex++;
    const keyframesRule = `@keyframes ${keyframesName} { 0% { text-indent: ${offsetWidth}px } 100% { text-indent: -${textWidth}px; } }`;
    const seconds = (textWidth + offsetWidth) / 100;
    // When the Raspberry Pi tries to scroll the marquee as fast as it can, the result is very jerky. It will be better
    // to have a slow but steady frame rate the Raspberry Pi can keep up with.
    const linearOrSteps = (this.slowerFrameRate ? `steps(${Math.round(seconds * 30)})` : 'linear');

    this.animationStyleSheet.insertRule(keyframesRule, 0);
    this.marquee.css('animation', `${keyframesName} ${seconds}s infinite ${linearOrSteps}`);
  }
}
