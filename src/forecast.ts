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
import { CLOCK_CENTER } from './clock';
import { CurrentTemperatureHumidity } from './current-temp-manager';
import $ from 'jquery';
import { KsDateTime, KsTimeZone } from 'ks-date-time-zone';
import { cos_deg, floor, sin_deg } from 'ks-math';
import { blendColors, doesCharacterGlyphExist, getTextWidth, isChrome, isChromium, isEdge, isIE, last, processMillis } from 'ks-util';
import { ForecastData, HourlyConditions } from '../server/src/shared-types';
import { TimeFormat } from './settings';
import { reflow } from './svg-flow';
import { convertTemp, displayHtml, formatHour, htmlEncode, localDateString, setSvgHref } from './util';

interface SVGAnimationElementPlus extends SVGAnimationElement {
  beginElement: () => void;
}

const DEFAULT_BACKGROUND = 'inherit';
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
// There's a Chrome glitch where some SVG icons are getting clipped at the edges. For some strange
// reason using a transform to scale these icons down, then larger unit sizes to scale them back up
// again, fixes the problem.
const SCALING_FIX = (isChrome() || isChromium() ? 0.875 : 1);
const HOURLY_ICON_SIZE = 3.5 / SCALING_FIX;
const HOURLY_VERT_OFFSET = 2.5;
const HOURLY_LEFT_COLUMN = 0.5;
const HOURLY_RIGHT_COLUMN = 99.5;
const HOURLY_TEMP_VERT_OFFSET = 3.5;
const HOURLY_VERT_SPACING = 6.7;
const FORECAST_UNIT_WIDTH = 39;
const RISE_SET_TOP = 25.4 / 51;
const BULLET_SPACER = ' \u2022 ';
const PCT = '<tspan class="small-percent" dy="-0.2em 0.2em">%\u200B</tspan>';
const BULLET_REGEX = new RegExp(BULLET_SPACER, 'g');
const MARQUEE_JOINER = '\u00A0\u00A0\u00A0\u25C8\u00A0\u00A0\u00A0'; // '   ◈   ', non-breaking spaces with bordered diamond
const START_ERROR_TAG = `<span style="color: ${ERROR_FOREGROUND}; background-color: ${ERROR_BACKGROUND};">&nbsp;`;
const CLOSE_ERROR_TAG = '&nbsp;</span>';
const REVERT_TO_SUN_INFO_DELAY = 60_000;
let SUBJECT_INTRO_PATTERN: RegExp;

try {
  // Firefox fails on this pattern.
  SUBJECT_INTRO_PATTERN = new RegExp('^((• )?\\p{Lu}{4,}[ \\p{Lu}]*)\\.\\.\\.(?!\\.)', 'gmu');
}
catch {
  SUBJECT_INTRO_PATTERN = /^((• )?[A-Z]{4,}[ A-Z]*)\.\.\.(?!\.)/gmu;
}

const MARQUEE_SPEED = 100; // pixels per second

const FREQUENT_THRESHOLD = 300;

const MAX_FORECAST_STALENESS = 7200000; // 2 hours
const MAX_CURRENT_TEMP_STALENESS = 1800000; // 30 minutes

const EMPTY_ICON = 'assets/empty.svg';
const UNKNOWN_ICON = 'assets/unknown.svg';
const NO_DATA: CurrentTemperatureHumidity = { forecastFeelsLike: null, forecastHumidity: null, forecastStale: null, forecastTemp: null };

const REVERT_TO_START_OF_WEEK_DELAY = 60_000; // 1 minute

export enum HourlyForecast { NONE = 'N', CIRCULAR = 'C', VERTICAL = 'V' }

function eventInside(event: MouseEvent | Touch, elem: HTMLElement): boolean {
  const rect = elem.getBoundingClientRect();
  const x = event.pageX;
  const y = event.pageY;

  return rect.x <= x && x <= rect.right && rect.y <= y && y <= rect.bottom;
}

export class Forecast {
  private readonly currentIcon: JQuery;
  private readonly darkskyLogo: JQuery;
  private readonly marqueeOuterWrapper: JQuery;
  private readonly marqueeWrapper: JQuery;
  private readonly marquee: JQuery;
  private readonly settingsBtn: JQuery;
  private readonly weatherbitLogo: JQuery;
  private readonly wundergroundLogo: JQuery;

  private dayIcons: JQuery[] = [];
  private dayLowHighs: JQuery[] = [];
  private dayChancePrecips: JQuery[] = [];
  private dayPrecipAccums: JQuery[] = [];
  private hourIcons: SVGImageElement[] = [];
  private hourTemps: SVGTextElement[] = [];
  private hourPops: SVGTextElement[] = [];
  private forecastMarkers: JQuery;

  private readonly weatherServer: string;

  private _hourlyForecast = HourlyForecast.CIRCULAR;
  private lastForecastData: ForecastData;
  private todayIndex = 0;
  private cachedHourly: HourlyConditions[] = [];
  private lastForecastTime = 0;
  private timezone = KsTimeZone.OS_ZONE;
  private showingStartOfWeek = true;
  private showingHourTemps = true;
  private hourInfoTimer: any;

  private marqueeText = ' ';
  private marqueeDialogText = '';
  private marqueeBackground = DEFAULT_BACKGROUND;
  private animationStart: number;
  private animationWidth: number;
  private animationDuration: number;
  private animationRequestId = 0;
  private rainGlyph: string;
  private snowGlyph: string;

  constructor(private appService: AppService) {
    this.currentIcon = $('#current-icon');

    for (let i = 0; i < 7; ++i) {
      this.dayIcons[i] = $('#day' + i + '-icon');
      this.dayLowHighs[i] = $('#day' + i + '-low-high');
      this.dayChancePrecips[i] = $('#day' + i + '-chance-precip');
      this.dayPrecipAccums[i] = $('#day' + i + '-precip-accum');
    }

    this.darkskyLogo = $('#darksky-logo');
    this.settingsBtn = $('#settings-btn');
    this.weatherbitLogo = $('#weatherbit-logo');
    this.wundergroundLogo = $('#wunderground-logo');

    this.marqueeOuterWrapper = $('#marquee-outer-wrapper');
    this.marqueeWrapper = $('#marquee-wrapper');
    this.marquee = $('#marquee');
    this.marqueeBackground = $('body').css('--background-color');
    this.forecastMarkers = $('#hourly-forecast-start, #hourly-forecast-end');

    this.marqueeWrapper.on('click', () => this.showMarqueeDialog());

    if (!isIE() && !isEdge())
      this.weatherServer = appService.getApiServer();
    else
      this.weatherServer = '';

    this.decorateClockFace();
    this.detectGestures();

    window.addEventListener('resize', () => this.updateMarqueeAnimation(null));
  }

  private detectGestures(): void {
    const forecastRect = $('#forecast-rect')[0];
    const leftEdge = forecastRect.getBoundingClientRect().x;
    const topEdge = forecastRect.getBoundingClientRect().y;
    const width = forecastRect.getBoundingClientRect().width;
    const height = forecastRect.getBoundingClientRect().height;

    const dragStartThreshold = 3;
    const swipeThreshold = width * 0.114; // 80% of the distance across one day
    const animateToStart = (document.getElementById('start-of-week') as unknown as SVGAnimationElementPlus);
    const animateToEnd = (document.getElementById('end-of-week') as unknown as SVGAnimationElementPlus);
    const animateWeekDrag = (document.getElementById('drag-week') as unknown as SVGAnimationElementPlus);
    const skipToStart = document.getElementById('week-backward');
    const disabledSkipColor = skipToStart.getAttribute('fill');
    const skipToEnd = document.getElementById('week-forward');
    const enabledSkipColor = skipToEnd.getAttribute('fill');
    let dragging = false;
    let dragAnimating = false;
    let dragEndTime = 0;
    let downX: number;
    let lastX: number;
    let minMove = 0;
    let revertToStart: any;
    let swipeAnimating = false;
    let lastAnimX = 0;

    animateWeekDrag.addEventListener('beginEvent', () => dragAnimating = true);
    animateToStart.addEventListener('beginEvent', () => swipeAnimating = true);
    animateToEnd.addEventListener('beginEvent', () => swipeAnimating = true);

    animateWeekDrag.addEventListener('endEvent', () => dragAnimating = false);
    animateToStart.addEventListener('endEvent', () => {
      swipeAnimating = false;
      lastAnimX = 0;
    });
    animateToEnd.addEventListener('endEvent', () => {
      swipeAnimating = false;
      lastAnimX = -FORECAST_UNIT_WIDTH;
    });

    const mouseClick = event => {
      if (processMillis() < dragEndTime + 500 || dragAnimating || swipeAnimating)
        return;

      if ((event.pageY - topEdge) / height >= RISE_SET_TOP)
        this.appService.toggleSunMoon();
      else {
        const dayIndex = Math.floor((event.pageX - leftEdge) * 4 / width) + (this.showingStartOfWeek ? 0 : 3);

        this.showDayForecast(dayIndex);
      }
    };
    $('#forecast-week').on('click', event => mouseClick(event));
    forecastRect.addEventListener('click', event => mouseClick(event));

    $('#sunrise-set').on('click', () => this.appService.toggleSunMoon());
    $('#moonrise-set').on('click', () => this.appService.toggleSunMoon());
    $('.hour-temps, .hour-pops, .hour-icon').on('click', () => this.toggleHourInfo());

    const mouseDown = (x: number) => {
      dragging = true;
      lastX = downX = x;
      minMove = 0;
    };
    window.addEventListener('mousedown', event => eventInside(event, forecastRect) ? mouseDown(event.pageX) : null);
    window.addEventListener('touchstart', event => event.touches.length > 0 && eventInside(event.touches[0], forecastRect) ?
      mouseDown(event.touches[0].pageX) : null
    );

    const doSwipe = (dx: number) => {
      if (revertToStart) {
        clearTimeout(revertToStart);
        revertToStart = undefined;
      }

      if (swipeAnimating)
        return;
      else if (dragAnimating) {
        setTimeout(() => doSwipe(dx), 1);
        return;
      }

      if (dx < 0) {
        this.showingStartOfWeek = false;
        skipToEnd.setAttribute('fill', disabledSkipColor);
        skipToStart.setAttribute('fill', enabledSkipColor);
        $(animateToEnd).attr('from', `${lastAnimX} 0`);
        setTimeout(() => animateToEnd.beginElement());

        revertToStart = setTimeout(() => {
          revertToStart = undefined;
          doSwipe(1);
        }, REVERT_TO_START_OF_WEEK_DELAY);
      }
      else {
        this.showingStartOfWeek = true;
        skipToStart.setAttribute('fill', disabledSkipColor);
        skipToEnd.setAttribute('fill', enabledSkipColor);
        $(animateToStart).attr('from', `${lastAnimX} 0`);
        setTimeout(() => animateToStart.beginElement());
      }
    };

    const restorePosition = () => {
      if (dragAnimating) {
        setTimeout(() => restorePosition(), 1);
        return;
      }

      if (this.showingStartOfWeek) {
        $(animateToStart).attr('from', `${lastAnimX} 0`);
        animateToStart.beginElement();
      }
      else {
        $(animateToEnd).attr('from', `${lastAnimX} 0`);
        animateToEnd.beginElement();
      }
    };

    skipToEnd.addEventListener('click', () => {
      if (this.showingStartOfWeek)
        doSwipe(-1);
    });

    skipToStart.addEventListener('click', () => {
      if (!this.showingStartOfWeek)
        doSwipe(1);
    });

    const canMoveDirection = (dx: number) => (this.showingStartOfWeek && dx < 0) || (!this.showingStartOfWeek && dx > 0);

    const mouseMove = (x: number) => {
      if (!dragging || x === lastX)
        return;

      const dx = x - downX;

      minMove = Math.max(Math.abs(dx), Math.abs(minMove));
      lastX = x;

      if (canMoveDirection(dx)) {
        if (minMove >= swipeThreshold) {
          dragging = false;
          dragEndTime = processMillis();
          lastX = undefined;
          doSwipe(dx);
        }
        else if (minMove >= dragStartThreshold && !dragAnimating && !swipeAnimating) {
          const currentShift = this.showingStartOfWeek ? 0 : -FORECAST_UNIT_WIDTH;
          const dragTo = Math.min(Math.max(currentShift + dx / width * 91, -FORECAST_UNIT_WIDTH), 0);

          $(animateWeekDrag).attr('from', `${lastAnimX} 0`);
          $(animateWeekDrag).attr('to', `${dragTo} 0`);
          lastAnimX = dragTo;
          animateWeekDrag.beginElement();
        }
      }
    };
    window.addEventListener('mousemove', event => mouseMove(event.pageX));
    window.addEventListener('touchmove', event => mouseMove(event.touches[0]?.pageX ?? lastX));

    const mouseUp = (x: number) => {
      if (dragging && minMove >= 0) {
        const dx = (x ?? downX) - downX;

        if (x == null || canMoveDirection(dx)) {
          if (Math.abs(dx) >= swipeThreshold)
            doSwipe(dx);
          else if (minMove >= dragStartThreshold)
            restorePosition();
        }

        if (minMove >= dragStartThreshold)
          dragEndTime = processMillis();
      }

      dragging = false;
      lastX = undefined;
    };
    window.addEventListener('mouseup', event => mouseUp(event.pageX));
    window.addEventListener('touchend', event => mouseUp(event.touches[0]?.pageX ?? lastX));
    window.addEventListener('touchcancel', () => mouseUp(null));
  }

  private decorateClockFace(): void {
    const clock = document.getElementById('clock');
    const halfIcon = HOURLY_ICON_SIZE / 2;

    for (let i = 0; i < 24; ++i) {
      const isNew = !this.hourIcons[i];
      const vertical = this.hourlyForecast === HourlyForecast.VERTICAL;
      const deg = i * 30 + 15;
      const hourIcon = isNew ? document.createElementNS(SVG_NAMESPACE, 'image') : this.hourIcons[i];
      const hourTemp = isNew ? document.createElementNS(SVG_NAMESPACE, 'text') : this.hourTemps[i];
      const hourPop = isNew ? document.createElementNS(SVG_NAMESPACE, 'text') : this.hourPops[i];
      let r, x, y;

      if (vertical) {
        x = i < 12 ? HOURLY_LEFT_COLUMN : HOURLY_RIGHT_COLUMN;
        y = (i % 12 - 6) * HOURLY_VERT_SPACING + CLOCK_CENTER + HOURLY_VERT_OFFSET;
      }
      else {
        r = (i < 12 ? CLOCK_ICON_RADIUS : CLOCK_ICON_INNER_RADIUS);
        x = CLOCK_CENTER + r * cos_deg(deg - 90);
        y = CLOCK_CENTER + r * sin_deg(deg - 90);
      }

      const setVerticalOrCircular = (elem: SVGElement) => {
        elem.classList.add(vertical ? 'vertical' : 'circular');
        elem.classList.remove(vertical ? 'circular' : 'vertical');
      };

      hourIcon.setAttribute('x', ((x - halfIcon) / SCALING_FIX).toString());
      hourIcon.setAttribute('y', ((y - halfIcon) / SCALING_FIX).toString());
      hourIcon.setAttribute('height', HOURLY_ICON_SIZE.toString());
      hourIcon.setAttribute('width', HOURLY_ICON_SIZE.toString());
      hourIcon.classList.add('hour-icon');
      setVerticalOrCircular(hourIcon);

      if (SCALING_FIX !== 1)
        hourIcon.setAttribute('transform', `scale(${SCALING_FIX})`);

      if (isNew)
        hourIcon.setAttribute('href', EMPTY_ICON);

      [hourTemp, hourPop].forEach((text, j) => {
        let y2 = y;

        if (vertical) {
          y2 += HOURLY_TEMP_VERT_OFFSET;
          text.removeAttribute('dy');
          text.setAttribute('dx', (i < 12 ? -halfIcon : halfIcon).toString());
          text.style.textAnchor = (i < 12 ? 'start' : 'end');
        }
        else {
          r = (i < 12 ? CLOCK_TEMPS_RADIUS : CLOCK_TEMPS_INNER_RADIUS);
          x = CLOCK_CENTER + r * cos_deg(deg - 90);
          y2 = CLOCK_CENTER + r * sin_deg(deg - 90);
          text.removeAttribute('dx');
          text.setAttribute('dy', '0.5em');
          text.style.textAnchor = 'middle';
        }

        text.setAttribute('x', x.toString());
        text.setAttribute('y', y2.toString());
        text.classList.add(j === 0 ? 'hour-temps' : 'hour-pops');
        text.classList.add(j === 0 ? 'hour-info-show' : 'hour-info-hide');
        setVerticalOrCircular(text);
      });

      if (isNew) {
        hourTemp.innerHTML = '';
        clock.appendChild(hourIcon);
        this.hourIcons[i] = hourIcon;
        clock.appendChild(hourTemp);
        this.hourTemps[i] = hourTemp;
        clock.appendChild(hourPop);
        this.hourPops[i] = hourPop;
      }
      else
        hourTemp.innerHTML = hourTemp.innerHTML.replace(/.*?(\b\d+°).*/, '$1');
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
      const wb = (forecastData.source === 'weatherbit');
      const wu = (forecastData.source === 'wunderground');
      const buttonWidth = this.settingsBtn.width();
      const logoWidth = (ds ? 118 : (wb || wu ? 183 : 8)) + 14;

      this.darkskyLogo.css('display', ds ? 'inline-block' : 'none');
      this.weatherbitLogo.css('display', wb ? 'inline-block' : 'none');
      this.wundergroundLogo.css('display', wu ? 'inline-block' : 'none');
      this.marqueeOuterWrapper.css('right', (buttonWidth + logoWidth) + 'px');
      this.settingsBtn.css('margin-right', ds || wu || wb ? 0 : 8);

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

  // Note: This is just for a temporary, quick update. The full forecast needs to be requested to get
  // accurate temperature values, especially when only integer temperature values have been supplied,
  // which don't allow for very good Celsius/Fahrenheit conversions.
  public swapTemperatureUnits(makeCelsius: boolean): void {
    if (this.lastForecastData && this.lastForecastData.isMetric !== makeCelsius) {
      const forecast = this.lastForecastData;
      const convert = (t: number) => convertTemp(t, makeCelsius);

      if (forecast.currently) {
        forecast.currently.feelsLikeTemperature = convert(forecast.currently.feelsLikeTemperature);
        forecast.currently.temperature = convert(forecast.currently.temperature);
      }

      if (forecast.hourly)
        forecast.hourly.forEach(hour => hour.temperature = convert(hour.temperature));

      this.cachedHourly = [];

      if (forecast.daily?.data)
        forecast.daily.data.forEach(day => {
          day.temperatureLow = convert(day.temperatureLow);
          day.temperatureHigh = convert(day.temperatureHigh);
        });

      forecast.isMetric = makeCelsius;
      this.displayForecast(forecast);
    }
  }

  public clearCache(): void {
    this.lastForecastData = undefined;
    this.cachedHourly = [];
  }

  // noinspection JSUnusedGlobalSymbols
  get hourlyForecast(): HourlyForecast { return this._hourlyForecast; }
  set hourlyForecast(value: HourlyForecast) {
    if (this._hourlyForecast !== value) {
      const display = (value === HourlyForecast.NONE ? 'none' : 'block');

      this._hourlyForecast = value;
      this.hourIcons.forEach(icon => icon.style.display = display);
      this.hourTemps.forEach(temp => temp.style.display = display);
      this.hourPops.forEach(pop => pop.style.display = display);
      this.forecastMarkers.css('display', value === HourlyForecast.CIRCULAR ? 'block' : 'none');
      this.decorateClockFace();

      // Force back to hourly temps
      this.showingHourTemps = false;
      this.toggleHourInfo();
    }
  }

  private updateHourlyCache(forecastData: ForecastData): void {
    const now = this.appService.getCurrentTime() / 1000;
    let earliestNew = forecastData.hourly[0]?.time ?? Number.MAX_SAFE_INTEGER;
    let inserted = 0;

    this.cachedHourly = this.cachedHourly.filter(hour => hour.time >= now - 7200 && hour.time <= now);

    if (now < earliestNew) {
      this.cachedHourly.forEach(hour => {
        if (hour.time < earliestNew)
          forecastData.hourly.splice(inserted++, 0, hour);
      });
    }

    earliestNew = forecastData.hourly[0]?.time ?? Number.MAX_SAFE_INTEGER;

    // Still nothing to cover the current hour? Fake it from current conditions.
    if (now < earliestNew && forecastData?.currently)
      forecastData.hourly.splice(0, 0, {
        icon: forecastData.currently.icon,
        precipProbability: forecastData.currently.precipProbability,
        precipType: forecastData.currently.precipType,
        temperature: forecastData.currently.temperature,
        time: Math.floor(now / 3600) * 3600
      });

    for (let i = inserted; i < forecastData.hourly.length; ++i) {
      const t = forecastData.hourly[i].time;

      if (t <= now + 7200 && (this.cachedHourly.length === 0 || t > last(this.cachedHourly).time))
        this.cachedHourly.push(forecastData.hourly[i]);
      else
        break;
    }
  }

  public showUnknown(error?: string): void {
    setSvgHref(this.currentIcon, UNKNOWN_ICON);
    this.appService.updateCurrentTemp(NO_DATA);
    this.hourIcons.forEach(icon => icon.setAttribute('href', EMPTY_ICON));
    this.hourTemps.forEach(temp => temp.textContent = '');
    this.hourPops.forEach(pop => pop.textContent = '');

    this.dayIcons.forEach((dayIcon, index) => {
      setSvgHref(dayIcon, UNKNOWN_ICON);
      this.dayLowHighs[index].text('--°/--°');
      this.dayChancePrecips[index].html('--' + PCT);
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
          const cacheControl = jqXHR.getResponseHeader('cache-control');

          if (cacheControl && typeof data === 'object') {
            const match = /max-age=(\d+)/.exec(cacheControl);

            if (match && Number(match[1]) <= FREQUENT_THRESHOLD)
              data.frequent = true;
          }

          if (!data || typeof data !== 'object' || data.unavailable)
            reject(new Error('Forecast unavailable'));
          else if (!data.currently || !data.daily || !data.daily.data || data.daily.data.length === 0)
            reject(new Error('Incomplete data'));
          else {
            data.isMetric = isMetric;
            resolve(data);
          }
        },
        error: (jqXHR: JQueryXHR, textStatus: string, errorThrown: string) => {
          reject(errorThrown);
        }
      });
    });
  }

  getIconSource(icon: string) {
    if (/^\d\d\w*$/.test(icon))
      return `assets/indexed-weather/${icon}.svg`;
    else
      return `assets/${icon}.svg`;
  }

  private displayForecast(forecastData: ForecastData) {
    this.timezone = KsTimeZone.getTimeZone(forecastData.timezone);

    const now = this.appService.getCurrentTime();
    const today = new KsDateTime(now, this.timezone).wallTime;
    const startOfHour = new KsDateTime({ y: today.y, m: today.m, d: today.d, hrs: today.hrs, min: 0, sec: 0 }, this.timezone).utcTimeMillis;
    const firstHourIndex = forecastData.hourly.findIndex(hourInfo => hourInfo.time * 1000 >= startOfHour);
    const vertical = (this.hourlyForecast === HourlyForecast.VERTICAL);
    const timeFormat = this.appService.getTimeFormat();
    let previousStartOfHour = startOfHour - 3_600_000;

    // noinspection DuplicatedCode,DuplicatedCode
    for (let i = 0; i < 24; ++i) {
      let icon = EMPTY_ICON;
      let temp = '';
      let pop = '';
      const hourInfo = forecastData.hourly[i + firstHourIndex];
      const startOfHour = hourInfo ? hourInfo.time * 1000 : previousStartOfHour + 3_600_000;
      const hour = new KsDateTime(startOfHour, this.timezone).wallTime;
      let index: number;

      if (vertical)
        index = i;
      else {
        // Account for skipped or repeated hours caused by DST change.
        const hourDelta = hour.hrs - today.hrs + 24 * (hour.n - today.n);

        index = (hour.hrs % 12) % 12 + floor(hourDelta / 12) * 12;
      }

      if (hourInfo && firstHourIndex >= 0) {
        icon = this.getIconSource(hourInfo.icon);
        temp = hourInfo.temperature.toFixed(0) + '°';
        pop = hourInfo.precipProbability != null ? Math.round(hourInfo.precipProbability * 100) + PCT : '--' + PCT;

        if (vertical && (i <= 3 || (8 <= i && i <= 15) || i >= 20)) {
          const hourText = `<tspan class="temp-by-hour">${formatHour(hour.hrs, timeFormat === TimeFormat.AMPM, true)}</tspan>`;

          if (i < 12) {
            temp += ' ' + hourText;
            pop += ' ' + hourText;
          }
          else {
            temp = hourText + ' ' + temp;
            pop = hourText + ' ' + pop;
          }
        }
      }

      if (this.hourIcons[index])
        this.hourIcons[index].setAttribute('href', icon);

      // noinspection DuplicatedCode
      if (this.hourTemps[index]) {
        this.hourTemps[index].innerHTML = temp;
        this.hourTemps[index].style.fontSize = (!vertical && temp.length > 3 ? '1.25px' : '1.6px');
        this.hourTemps[index].style.fontStyle = (hour.d !== today.d ? 'italic' : 'normal');
      }

      // noinspection DuplicatedCode
      if (this.hourPops[index]) {
        this.hourPops[index].innerHTML = pop;
        this.hourPops[index].style.fontSize = (!vertical && pop.length - PCT.length > 2 ? '1.25px' : '1.6px');
        this.hourPops[index].style.fontStyle = (hour.d !== today.d ? 'italic' : 'normal');
      }

      previousStartOfHour = startOfHour;
    }

    this.todayIndex = forecastData.daily.data.findIndex(cond => {
      const wallTime = new KsDateTime(cond.time * 1000, this.timezone).wallTime;

      return wallTime.y === today.y && wallTime.m === today.m && wallTime.d === today.d;
    });

    if (this.todayIndex < 0)
      this.showUnknown('Missing data');
    else {
      this.appService.updateCurrentTemp({
        forecastFeelsLike: forecastData.currently.feelsLikeTemperature,
        forecastHumidity: forecastData.currently.humidity * 100,
        forecastTemp: forecastData.currently.temperature,
      });

      setSvgHref(this.currentIcon, this.getIconSource(forecastData.currently.icon));

      this.dayIcons.forEach((dayIcon, index) => {
        if (forecastData.daily.data.length > this.todayIndex + index) {
          const daily = forecastData.daily.data[this.todayIndex + index];
          const textElem = this.dayPrecipAccums[index];

          setSvgHref(dayIcon, this.getIconSource(daily.icon));

          const low = Math.round(daily.temperatureLow);
          const high = Math.round(daily.temperatureHigh);

          this.dayLowHighs[index].text(`${high}°/${low}°`);

          let chancePrecip = Math.round(daily.precipProbability * 100) + PCT;

          if (!this.rainGlyph) // Raindrop emoji, or umbrella with raindrops
            this.rainGlyph = doesCharacterGlyphExist(textElem[0], '\uD83D\uDCA7') ? '\uD83D\uDCA7' : '\u2614';

          if (!this.snowGlyph) // Snowflake emoji, or more basic snowflake character
            this.snowGlyph = doesCharacterGlyphExist(textElem[0], '\u2744\uFE0F') ? '\u2744\uFE0F' : '\u2744';

          if (daily.precipType === 'snow')
            chancePrecip = this.snowGlyph + chancePrecip;
          else
            chancePrecip = this.rainGlyph + chancePrecip;

          this.dayChancePrecips[index].html(daily.precipProbability > 0.01 ? chancePrecip : '--');

          const accum = daily.precipAccumulation || 0;
          const precision = (accum < 0.995 ? 2 : (accum < 9.95 ? 1 : 0));

          textElem.text(accum > 0 ? accum.toFixed(precision) + (forecastData.isMetric ? ' cm' : ' in') : '--');
        }
        else {
          setSvgHref(dayIcon, UNKNOWN_ICON);
          this.dayLowHighs[index].text('--°/--°');
          this.dayChancePrecips[index].html('--' + PCT);
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

    const alertText = alerts.map(a => a.replace(/\r\n|\r/g, '\n').trim()
      .replace(/\s[\s\x23-\x2F\x3A-\x40]+$/, '') // Remove seemingly random trailing characters from alerts.
      .replace(/^\* /gm, '• ') // Replace asterisks used as bullets with real bullets.
    ).join(BULLET_SPACER);

    let background;
    let color;

    if (alertText) {
      switch (maxSeverity) {
        case 0:
          background = document.defaultView.getComputedStyle(document.body, null).getPropertyValue('background-color');
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
    }
    else {
      newText = '\u00A0';
      background = DEFAULT_BACKGROUND;
      color = DEFAULT_FOREGROUND;
    }

    this.marqueeBackground = background;
    // It shouldn't be necessary to update colors for both marqueeOuterWrapper and marqueeWrapper, but Chrome doesn't seem.
    // to pass through the inheritance of the background color all of the time. Also doing foreground for good measure.
    this.marqueeOuterWrapper.css('background-color', background);
    this.marqueeWrapper.css('background-color', background);
    this.marqueeOuterWrapper.css('color', color);
    this.marqueeWrapper.css('color', color);
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

    // Try to undo hard word-wrap (too bad lookbehinds aren't reliably supported yet in web browsers).
    this.marqueeDialogText = newText.replace(BULLET_REGEX, '\n<hr>').replace(/([-a-z,])\n(?=[a-z])/gi, '$1 ')
      // No more than one blank line, and no trailing blank lines.
      .replace(/\n{3,}/g, '\n\n').trim().replace(/\n/g, '<br>\n')
      // Improve alert formatting.
      .replace(SUBJECT_INTRO_PATTERN, '$1: ');

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

    this.marquee.html(newText + MARQUEE_JOINER + newText);
    this.animationStart = performance.now();
    this.animationWidth = textWidth + getTextWidth(MARQUEE_JOINER, this.marquee[0]);
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

  private showMarqueeDialog(): void {
    const color = (this.marqueeBackground === 'inherit' ? $('body').css('--background-color') : this.marqueeBackground);

    displayHtml('big-text-dialog', this.marqueeDialogText, blendColors(color, 'white', 0.25));
  }

  private showDayForecast(dayIndex: number) {
    const day = this.todayIndex >= 0 && this.lastForecastData?.daily?.data[this.todayIndex + dayIndex];
    const narrativeDay = day?.narrativeDay;
    const narrativeEvening = day?.narrativeEvening;

    if (!narrativeDay && !narrativeEvening) {
      alert('No forecast details available');
      return;
    }

    const tempUnit = this.lastForecastData.isMetric ? 'C' : 'F';
    let text = '¬b¬' + localDateString(day.time * 1000, this.timezone) +
      `¬b; • ${day.temperatureHigh}°${tempUnit} / ${day.temperatureLow}°${tempUnit}\n\n`;

    if (narrativeDay && narrativeEvening)
      text += `${narrativeDay}\n\nEvening: ${narrativeEvening}`;
    else if (narrativeDay)
      text += narrativeDay;
    else
      text += narrativeEvening;

    text = htmlEncode(text).replace(/\n{3,}/g, '\n\n').trim().replace(/\n/g, '<br>\n')
      .replace(/¬(.+?)¬/g, '<$1>').replace(/¬(.+?);/g, '</$1>');

    displayHtml('big-text-dialog', text, '#DDF');
  }

  private toggleHourInfo(): void {
    if (this.hourInfoTimer) {
      clearTimeout(this.hourInfoTimer);
      this.hourInfoTimer = undefined;
    }

    const tempElems = $('.hour-temps');
    const popElems = $('.hour-pops');

    if (this.showingHourTemps) {
      this.showingHourTemps = false;
      tempElems.removeClass('hour-info-show');
      tempElems.addClass('hour-info-hide');
      popElems.removeClass('hour-info-hide');
      popElems.addClass('hour-info-show');

      this.hourInfoTimer = setTimeout(() => {
        this.hourInfoTimer = undefined;

        if (!this.showingHourTemps)
          this.toggleHourInfo();
      }, REVERT_TO_SUN_INFO_DELAY);
    }
    else {
      this.showingHourTemps = true;
      popElems.removeClass('hour-info-show');
      popElems.addClass('hour-info-hide');
      tempElems.removeClass('hour-info-hide');
      tempElems.addClass('hour-info-show');
    }
  }
}
