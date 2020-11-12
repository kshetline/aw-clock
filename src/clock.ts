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

// Started by using https://codepen.io/dudleystorey/pen/HLBki, but this has grown and changed *quite* a bit from there.

import { AppService } from './app.service';
import $ from 'jquery';
import { DateAndTime, getDayOfWeek, getLastDateInMonthGregorian, KsDateTime, KsTimeZone } from 'ks-date-time-zone';
import { cos_deg, floor, interpolate, irandom, max, min, sin_deg } from 'ks-math';
import { getCssValue, isIE, isRaspbian, padLeft } from 'ks-util';
import { CurrentDelta, GpsData } from '../server/src/shared-types';
import { setSignalLevel } from './util';

export enum TimeFormat { HR24, AMPM, UTC }

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

const SECOND_HAND_ANIMATION_TIME = 200;
const MAX_RANDOM_LEAP_SECOND_POLL_DELAY = 180_000; // Three minutes
const LEAP_SECOND_RETRY_DELAY = 300_000; // 5 minutes

const MILLIS_PER_DAY = 86_400_000;
const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface SVGAnimationElement extends HTMLElement {
  beginElement: () => void;
}

export const CLOCK_CENTER = 50;

const CLOCK_RADIUS = 41;
const CLOCK_TEXT_RADIUS = 33.5;
const CONSTELLATION_RADIUS = 24;

export class Clock {
  private readonly secHand: HTMLElement;
  private readonly minHand: HTMLElement;
  private readonly hourHand: HTMLElement;
  private readonly forecastStart: HTMLElement;
  private readonly forecastEnd: HTMLElement;
  private readonly hands: HTMLElement;
  private readonly gpsMeter: HTMLElement;

  private sweep: SVGAnimationElement;
  private zoneCaption: HTMLElement;
  private hub: HTMLElement;
  private dayOfWeekCaption: HTMLElement;
  private dateCaption: HTMLElement;
  private monthCaption: HTMLElement;
  private yearCaption: HTMLElement;
  private utcDate: HTMLElement;
  private timeCaption: HTMLElement;
  private gpsIcon: HTMLElement;
  private dut1Label: HTMLElement;
  private dut1Caption: HTMLElement;
  private dtaiLabel: HTMLElement;
  private dtaiCaption: HTMLElement;
  private dayHeaders: HTMLElement[];
  private clock: HTMLElement;

  private readonly hasBeginElement: boolean;

  private gpsActive = false;
  private gpsAvailable = false;
  private lastSecRotation = 0;
  private lastMinute = -1;
  private lastTick = -1;
  private inMinuteOfLeapSecond = false;
  private pendingLeapSecondForMonth = 0;
  private firstLeapSecondPoll = true;
  private lastLeapSecondCheckDay = -1;
  private upcomingLeapSecond: CurrentDelta;
  private dut1PositionAdjustmentNeeded = true;

  private _timeFormat = TimeFormat.UTC;
  private _hideSeconds = false;

  public timezone = KsTimeZone.OS_ZONE;
  public hasCompletingAnimation = false;

  constructor(private appService: AppService) {
    this.secHand = document.getElementById('sec-hand');
    this.sweep = document.getElementById('sweep') as SVGAnimationElement;
    this.minHand = document.getElementById('min-hand');
    this.hourHand = document.getElementById('hour-hand');
    this.forecastStart = document.getElementById('hourly-forecast-start');
    this.forecastEnd = document.getElementById('hourly-forecast-end');
    this.hands = document.getElementById('hands');
    this.zoneCaption = document.getElementById('timezone');
    this.hub = document.getElementById('hub');
    this.dayOfWeekCaption = document.getElementById('day-of-week');
    this.dateCaption = document.getElementById('date');
    this.monthCaption = document.getElementById('month');
    this.yearCaption = document.getElementById('year');
    this.utcDate = document.getElementById('utc-date');
    this.timeCaption = document.getElementById('time');
    this.gpsIcon = document.getElementById('gps-icon');
    this.gpsMeter = document.getElementById('gps-meter');
    this.dut1Label = document.getElementById('dut1-label');
    this.dut1Caption = document.getElementById('dut1');
    this.dtaiLabel = document.getElementById('dtai-label');
    this.dtaiCaption = document.getElementById('dtai');
    this.dayHeaders = (Array.from(document.getElementsByClassName('forecast-day-header')) as HTMLElement[])
      .filter(h => !h.id.includes('dayN'))
      .sort((a, b) => parseFloat(a.id.substr(3)) - parseFloat(b.id.substr(3)));

    this.hasBeginElement = !!this.sweep.beginElement;

    this.decorateClockFace();

    if (isIE())
      $('#clock-container').addClass('clock-container-ie-fix');
  }

  public start(): void {
    this.tick();
  }

  public triggerRefresh(): void {
    this.lastMinute = -1;
  }

  get timeFormat(): TimeFormat { return this._timeFormat; }
  set timeFormat(value: TimeFormat) {
    if (this._timeFormat !== value) {
      this._timeFormat = value;
      this.adjustTimeFontSize();
    }
  }

  // noinspection JSUnusedGlobalSymbols
  get hideSeconds(): boolean { return this._hideSeconds; }
  set hideSeconds(value: boolean) {
    if (this._hideSeconds !== value) {
      this._hideSeconds = value;
      this.adjustTimeFontSize();

      if (value) {
        this.secHand.style.visibility = 'hidden';
        this.hub.style.visibility = 'hidden';
      }
      else {
        this.secHand.style.visibility = 'visible';
        this.hub.style.visibility = 'visible';
      }
    }
  }

  private decorateClockFace(): void {
    const centerStr = CLOCK_CENTER.toString();
    const planetTracks = document.getElementById('planet-tracks');
    const nightSkyTracks = document.getElementById('night-sky-tracks');
    const risenTracks = document.getElementById('risen-tracks');
    const faceColor = getCssValue(document.getElementById('face'), 'stroke');
    let firstTick: SVGCircleElement;

    this.clock = document.getElementById('clock');

    for (let deg = 0; deg <= 360; deg += 6) { // 61 dots created, not just 60, so there's one for a possible leap second.
      const i = deg / 6;
      const big = (i % 5 === 0 && i !== 60);
      const x1 = CLOCK_CENTER + CLOCK_RADIUS * cos_deg(deg - 90);
      const y1 = CLOCK_CENTER + CLOCK_RADIUS * sin_deg(deg - 90);
      const tickMark = document.createElementNS(SVG_NAMESPACE, 'circle');

      tickMark.setAttribute('cx', x1.toString());
      tickMark.setAttribute('cy', y1.toString());
      tickMark.setAttribute('r', (big ? 1 : 0.333).toString());
      tickMark.setAttribute('fill', (big ? 'white' : faceColor));
      tickMark.setAttribute('fill-opacity', '1');

      if (i > 55) {
        tickMark.setAttribute('id', 'dot-' + i);
        tickMark.classList.add('moving-dot');
      }

      if (i === 0)
        firstTick = tickMark;

      if (i < 60)
        this.clock.appendChild(tickMark);
      else
        this.clock.insertBefore(tickMark, firstTick);

      if (deg % 30 === 0) {
        const h = (deg === 270 ? 12 : ((deg + 90) % 360) / 30);
        const x2 = CLOCK_CENTER + CLOCK_TEXT_RADIUS * cos_deg(deg);
        const y2 = CLOCK_CENTER + CLOCK_TEXT_RADIUS * sin_deg(deg);
        const text2 = document.createElementNS(SVG_NAMESPACE, 'text');

        text2.setAttribute('x', x2.toString());
        text2.setAttribute('y', y2.toString());
        text2.setAttribute('dy', '3.5');
        text2.classList.add('clock-face');
        text2.textContent = h.toString();

        if (h > 9) {
          text2.style.transform = 'scale(0.8, 1)';
          text2.setAttribute('dx', ['4', '8', '12.5'][h - 10]);
          // text2.style.transformOrigin = [10, 19, 28][h - 10] + '%'; // Didn't work on Safari

          if (h === 11)
            text2.style.letterSpacing = '-0.1em';
        }

        this.clock.insertBefore(text2, this.hands);

        const x3 = CLOCK_CENTER + CONSTELLATION_RADIUS * cos_deg(-deg - 15);
        const y3 = CLOCK_CENTER + CONSTELLATION_RADIUS * sin_deg(-deg - 15);
        const text3 = document.createElementNS(SVG_NAMESPACE, 'text');

        text3.setAttribute('x', x3.toString());
        text3.setAttribute('y', y3.toString());
        text3.setAttribute('dy', '1');
        text3.classList.add('constellation');
        text3.textContent = String.fromCodePoint(0x2648 + deg / 30); // zodiac codepoints
        planetTracks.appendChild(text3);
      }
    }

    const planetSymbols = [0x263C, 0x263D, 0x0263F, 0x2640, 0x2642, 0x2643, 0x2644];
    const planetIds = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn'];

    planetSymbols.forEach((planet, index) => {
      const x = CLOCK_CENTER + 10 + index * 2;
      const dy = 0.75 + (index % 2) * 2;
      const rect = document.createElementNS(SVG_NAMESPACE, 'rect');
      const text = document.createElementNS(SVG_NAMESPACE, 'text');
      const path = document.createElementNS(SVG_NAMESPACE, 'path');
      const nightPath = document.createElementNS(SVG_NAMESPACE, 'path');

      rect.setAttribute('x', (x - 0.9).toString());
      rect.setAttribute('y', (CLOCK_CENTER + dy - 2).toString());
      rect.setAttribute('width', '1.8');
      rect.setAttribute('height', '2.7');
      rect.setAttribute('style', 'fill: var(--clock-face-color)');
      planetTracks.appendChild(rect);

      text.setAttribute('x', x.toString());
      text.setAttribute('y', centerStr);
      text.setAttribute('dy', dy.toString());
      text.classList.add('constellation');
      text.textContent = String.fromCodePoint(planet);
      planetTracks.appendChild(text);

      path.setAttribute('fill', 'none');
      path.setAttribute('visibility', 'inherited');
      path.classList.add('risen-track');
      path.id = `risen-${planetIds[index]}`;
      risenTracks.appendChild(path);

      nightPath.setAttribute('fill', 'none');
      nightPath.setAttribute('visibility', 'inherited');
      nightPath.classList.add('night-sky-track');
      nightPath.id = `night-sky-${planetIds[index]}`;
      nightSkyTracks.appendChild(nightPath);
    });
  }

  private adjustTimeFontSize(): void {
    let fontSize = 10;

    if (this._timeFormat === TimeFormat.AMPM && !this._hideSeconds)
      fontSize = 8.5;
    else if (this._timeFormat === TimeFormat.UTC)
      fontSize = 6.5;

    this.timeCaption.style['font-size'] = fontSize.toString();
    this.utcDate.style.display = this._timeFormat === TimeFormat.UTC ? 'block' : 'none';
    this.dut1PositionAdjustmentNeeded = true;
  }

  private adjustTimeDecorations(): void {
    const viewWidth = (this.clock as any).viewBox?.baseVal?.width ?? 172;
    const r0 = this.clock.getBoundingClientRect();
    const scale = viewWidth / r0.width;
    const r1 = this.timeCaption.getBoundingClientRect();
    const r2 = this.dut1Label.getBoundingClientRect();
    const r3 = this.dtaiLabel.getBoundingClientRect();
    const r4 = this.gpsIcon.getBoundingClientRect();
    const labelX = (r1.x + r1.width - r0.x) * scale;
    const captionX = labelX + max(r2.width, r3.width) * scale;
    const iconX = (r1.x - r0.x) * scale - ((r4.width * scale) || 2.5) - 0.5;
    const meterX = iconX + 0.25;

    this.dut1Label.setAttribute('x', labelX.toString());
    this.dtaiLabel.setAttribute('x', labelX.toString());
    this.dut1Caption.setAttribute('x', captionX.toString());
    this.dtaiCaption.setAttribute('x', captionX.toString());
    this.gpsIcon.setAttribute('x', iconX.toString());
    this.gpsMeter.setAttribute('x', meterX.toString());
  }

  private tick(): void {
    function rotate(elem: HTMLElement, deg: number) {
      elem.setAttribute('transform', 'rotate(' + deg + ' 50 50)');
    }

    const sweepSecondHand = (start, end) => {
      if (end < start) {
        end += 360;
      }

      this.sweep.setAttribute('from', start + ' 50 50');
      this.sweep.setAttribute('to', end + ' 50 50');
      this.sweep.setAttribute('values', start + ' 50 50; ' + (end + 2) + ' 50 50; ' + end + ' 50 50');
      this.sweep.beginElement();
    };

    const doMechanicalSecondHandEffect = this.hasBeginElement && !this.appService.isTimeAccelerated() &&
            (!isRaspbian() || !this.hasCompletingAnimation);
    const animationTime = (doMechanicalSecondHandEffect ? SECOND_HAND_ANIMATION_TIME : 0);
    const timeInfo = this.appService.getTimeInfo(animationTime);
    const now = timeInfo.time;
    const date = new KsDateTime(now, this.timezone);
    const wallTime = date.wallTime;
    const wallTimeUtc = new KsDateTime(now, KsTimeZone.UT_ZONE).wallTime;
    const secs = wallTime.sec + (timeInfo.leapExcess > 0 ? 1 : 0);
    const millis = (timeInfo.leapExcess > 0 ? timeInfo.leapExcess - 1 : wallTime.millis);
    let secRotation = 6 * secs;
    const mins = wallTime.min;
    const hour = wallTime.hrs;
    const minuteOfLeapSecond = !!timeInfo.leapSecond && wallTimeUtc.min === 59 && timeInfo.time % MILLIS_PER_DAY >= MILLIS_PER_DAY - 60000 &&
            wallTimeUtc.d === getLastDateInMonthGregorian(wallTimeUtc.y, wallTimeUtc.m);
    const leapSecondForMonth = (minuteOfLeapSecond && timeInfo.leapSecond) || this.checkPendingLeapSecondForMonth(wallTimeUtc);

    if (this.lastLeapSecondCheckDay !== wallTimeUtc.d) {
      this.lastLeapSecondCheckDay = wallTimeUtc.d;
      this.getLeapSecondInfo();
      this.adjustTimeFontSize();
    }

    if (this.inMinuteOfLeapSecond !== minuteOfLeapSecond) {
      if (!minuteOfLeapSecond) {
        this.clock.classList.remove('leap-second');
        this.clock.classList.remove('neg-leap-second');

        if (this.upcomingLeapSecond) {
          // Use previous end-of-day TAI and dut1 values, adjusted by the last new leap second, until this info is re-polled.
          this.upcomingLeapSecond.delta += this.upcomingLeapSecond.pendingLeap;

          if (this.upcomingLeapSecond.dut1) {
            this.upcomingLeapSecond.dut1[2] += this.upcomingLeapSecond.pendingLeap;
            this.upcomingLeapSecond.dut1[0] = this.upcomingLeapSecond.dut1[2];
          }
        }
      }
      else if (timeInfo.leapSecond > 0)
        this.clock.classList.add('leap-second');
      else
        this.clock.classList.add('neg-leap-second');

      this.inMinuteOfLeapSecond = minuteOfLeapSecond;
    }

    if (minuteOfLeapSecond && secs > 55)
      secRotation = 330 + (secs - 55) * (timeInfo.leapSecond > 0 ? 5 : 7.5);

    if (this.pendingLeapSecondForMonth !== leapSecondForMonth) {
      if (!leapSecondForMonth) {
        this.monthCaption.classList.remove('month-of-leap-second');
        this.monthCaption.classList.remove('month-of-neg-leap-second');
      }
      else if (leapSecondForMonth > 0)
        this.monthCaption.classList.add('month-of-leap-second');
      else
        this.monthCaption.classList.add('month-of-neg-leap-second');

      this.pendingLeapSecondForMonth = leapSecondForMonth;
    }

    let dut1 = '±---';

    if (this.upcomingLeapSecond?.dut1) {
      const utcSec = now / 1000;
      const utc_0h = floor(utcSec / 86_400) * 86_400;
      const utc_24h = utc_0h + 86_400;
      const value = interpolate(utc_0h, utcSec, utc_24h, this.upcomingLeapSecond.dut1[0], this.upcomingLeapSecond.dut1[2]) * 1000;

      dut1 = (value >= 0 ? '+' : '') + value.toFixed(0);
    }

    this.dut1Caption.textContent = dut1 + 'ms';

    let dtai = '--';

    if (this.upcomingLeapSecond)
      dtai = this.upcomingLeapSecond.delta.toString();

    this.dtaiCaption.textContent = dtai + 's';

    if (doMechanicalSecondHandEffect)
      sweepSecondHand(this.lastSecRotation, secRotation);

    rotate(this.secHand, secRotation);
    this.lastSecRotation = secRotation;
    rotate(this.minHand, 6 * mins + 0.1 * min(secs, 59));
    rotate(this.hourHand, 30 * (hour % 12) + mins / 2 + min(secs, 59) / 120);
    rotate(this.forecastStart, 30 * (hour % 12) + 8.5);
    rotate(this.forecastEnd, 30 * (hour % 12) - 6);
    this.gpsActive = !!timeInfo.fromGps;
    this.gpsIcon.style.display = (this.gpsAvailable ? 'block' : 'none');
    this.gpsMeter.style.display = (this.gpsAvailable ? 'block' : 'none');
    setTimeout(() => this.tick(), 1000 - millis);

    setTimeout(() => {
      const dayOfTheWeek = getDayOfWeek(wallTime.n);

      this.dayOfWeekCaption.textContent = daysOfWeek[dayOfTheWeek].toUpperCase();
      this.dateCaption.textContent = padLeft(wallTime.d, 2, '0');
      this.monthCaption.textContent = months[wallTime.m - 1].toUpperCase();
      this.yearCaption.textContent = wallTime.y.toString();

      for (let i = 2; i < 7; ++i)
        this.dayHeaders[i].textContent = daysOfWeek[(dayOfTheWeek + i) % 7];

      this.zoneCaption.textContent = this.timezone.zoneName + ' UTC' + KsTimeZone.formatUtcOffset(date.utcOffsetSeconds);

      let displayHour = hour;
      let displayMins = mins;
      let suffix = '';
      let secsText = padLeft(secs, 2, '0');
      let utcDate = '';

      if (!this._hideSeconds && minuteOfLeapSecond &&
          ((timeInfo.leapSecond > 0 && secs === 60) || (timeInfo.leapSecond < 0 && secs === 58)))
        secsText = '<tspan style="fill: #F55">' + secsText + '</tspan>';

      if (this.timeFormat === TimeFormat.AMPM) {
        if (displayHour === 0)
          displayHour = 12;
        else if (displayHour > 12)
          displayHour -= 12;

        suffix = '<tspan style="font-size: 0.5em" dy="-1.4">\u2009' +
          (hour < 12 ? 'AM' : 'PM') + '</tspan>';
      }
      else if (this.timeFormat === TimeFormat.UTC) {
        displayHour = wallTimeUtc.hrs;
        displayMins = wallTimeUtc.min;

        const uDay = daysOfWeek[getDayOfWeek(wallTimeUtc.n)].toUpperCase();
        const uMonth = padLeft(wallTimeUtc.m, 2, '0');
        const uDate = padLeft(wallTimeUtc.d, 2, '0');

        utcDate = `<tspan style="fill: #9CF">UTC</tspan> ${uDay} ${wallTimeUtc.y}-${uMonth}-${uDate}`;
      }

      this.timeCaption.innerHTML =
        padLeft(displayHour, 2, '0') + ':' +
        padLeft(displayMins, 2, '0') + (this._hideSeconds ? '' : ':' + secsText) + suffix;
      this.utcDate.innerHTML = utcDate;

      if (this.dut1PositionAdjustmentNeeded) {
        this.dut1PositionAdjustmentNeeded = false;
        setTimeout(() => this.adjustTimeDecorations());
      }

      if (mins !== this.lastMinute || this.lastTick + 60_000 <= now) {
        this.checkGps();
        this.appService.updateTime(hour, mins, this.lastMinute < 0);
        this.lastMinute = mins;
        this.lastTick = now;
      }
    }, animationTime);
  }

  private checkPendingLeapSecondForMonth(wallTimeUtc: DateAndTime): number {
    if (!this.upcomingLeapSecond?.pendingLeap)
      return 0;

    const [y, m] = this.upcomingLeapSecond.pendingLeapDate.split('-').map(n => Number(n));

    if (y === wallTimeUtc.y && m === wallTimeUtc.m)
      return this.upcomingLeapSecond.pendingLeap;
    else
      return 0;
  }

  private getLeapSecondInfo(): void {
    setTimeout(() => {
      this.firstLeapSecondPoll = false;

      // noinspection JSIgnoredPromiseFromCall
      $.ajax({
        url: this.appService.getApiServer() + '/tai-utc',
        dataType: 'json',
        success: (data: CurrentDelta) => this.upcomingLeapSecond = data,
        error: () => setTimeout(() => {
          this.upcomingLeapSecond = undefined;
          this.lastLeapSecondCheckDay = -1;
        }, LEAP_SECOND_RETRY_DELAY)
      });
      // Randomly delay polling so that multiple clock instances don't all poll at the same time every day.
    }, this.firstLeapSecondPoll ? 0 : irandom(MAX_RANDOM_LEAP_SECOND_POLL_DELAY));
  }

  private checkGps(): void {
    // noinspection JSIgnoredPromiseFromCall
    $.ajax({
      url: this.appService.getApiServer() + '/gps',
      dataType: 'json',
      success: (data: GpsData) => {
        if (data.error === 'n/a')
          this.gpsAvailable = false;
        else {
          this.gpsAvailable = true;

          if (this.gpsActive !== !!data.pps) {
            this.lastMinute = -1; // trigger quick update
            this.gpsActive = !!data.pps;
            this.appService.resetGpsState();
          }

          setSignalLevel($(this.gpsMeter), data.signalQuality > 0 ? data.signalQuality : -1);
          this.gpsIcon.style.opacity = (data.pps && data.signalQuality > 0 ? '1' : '0.33');
        }
      }
    });
  }
}
