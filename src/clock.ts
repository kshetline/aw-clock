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

// Started by using https://codepen.io/dudleystorey/pen/HLBki, but this has grown and changed quite a bit from there.

import { DateAndTime, getDayOfWeek, getLastDateInMonthGregorian, KsDateTime, KsTimeZone } from 'ks-date-time-zone';
import { isIE, isRaspbian, padLeft } from 'ks-util';
import { AppService } from './app.service';
import { CurrentDelta } from '../server/src/tai-utc';
import * as $ from 'jquery';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

const SECOND_HAND_ANIMATION_TIME = 200;
const LEAP_SECOND_RETRY_DELAY = 300000; // 5 minutes

const MILLIS_PER_DAY = 86400000;
const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface SVGAnimationElement extends HTMLElement {
  beginElement: () => void;
}

export class Clock {
  private readonly secHand: HTMLElement;
  private readonly minHand: HTMLElement;
  private readonly hourHand: HTMLElement;
  private readonly hands: HTMLElement;

  private sweep: SVGAnimationElement;
  private zoneCaption: HTMLElement;
  private hub: HTMLElement;
  private dayOfWeekCaption: HTMLElement;
  private dateCaption: HTMLElement;
  private monthCaption: HTMLElement;
  private yearCaption: HTMLElement;
  private timeCaption: HTMLElement;
  private day2Caption: HTMLElement;
  private day3Caption: HTMLElement;
  private clock: HTMLElement;

  private readonly hasBeginElement: boolean;

  private lastSecRotation = 0;
  private lastMinute = -1;
  private lastTick = -1;
  private inMinuteOfLeapSecond = false;
  private pendingLeapSecondForMonth = 0;
  private lastLeapSecondCheckDay = -1;
  private upcomingLeapSecond: CurrentDelta;

  private _amPm = false;
  private _hideSeconds = false;

  public timezone = KsTimeZone.OS_ZONE;
  public hasCompletingAnimation = false;

  constructor(private appService: AppService) {
    this.secHand = document.getElementById('sec-hand');
    this.sweep = document.getElementById('sweep') as SVGAnimationElement;
    this.minHand = document.getElementById('min-hand');
    this.hourHand = document.getElementById('hour-hand');
    this.hands = document.getElementById('hands');
    this.zoneCaption = document.getElementById('timezone');
    this.hub = document.getElementById('hub');
    this.dayOfWeekCaption = document.getElementById('day-of-week');
    this.dateCaption = document.getElementById('date');
    this.monthCaption = document.getElementById('month');
    this.yearCaption = document.getElementById('year');
    this.timeCaption = document.getElementById('time');
    this.day2Caption = document.getElementById('day2-caption');
    this.day3Caption = document.getElementById('day3-caption');

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

  get amPm(): boolean { return this._amPm; }
  set amPm(value: boolean) {
    if (this._amPm !== value) {
      this._amPm = value;
      this.adjustTimeFontSize();
    }
  }

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
    const radius = 41;
    const textRadius = 33.5;
    const constellationRadius = 24;
    const center = 50;
    const centerStr = center.toString();
    const planetTracks = document.getElementById('planet-tracks');
    const risenTracks = document.getElementById('risen-tracks');

    this.clock = document.getElementById('clock');

    for (let deg = 0; deg <= 360; deg += 6) { // 61 dots created, not just 60, so there's one for a possible leap second.
      const i = deg / 6;
      const x1 = center + radius * Math.cos(Math.PI * (deg - 90) / 180);
      const y1 = center + radius * Math.sin(Math.PI * (deg - 90) / 180);
      const tickMark = document.createElementNS(SVG_NAMESPACE, 'circle');

      tickMark.setAttributeNS(null, 'cx', x1.toString());
      tickMark.setAttributeNS(null, 'cy', y1.toString());
      tickMark.setAttributeNS(null, 'r', (i % 5 === 0 && i !== 60 ? 1 : 0.333).toString());
      tickMark.setAttributeNS(null, 'fill', 'white');
      tickMark.setAttributeNS(null, 'fill-opacity', '1');

      if (i > 55) {
        tickMark.setAttribute('id', 'dot-' + i);
        tickMark.classList.add('moving-dot');
      }

      this.clock.appendChild(tickMark);

      if (deg % 30 === 0) {
        const h = (deg === 270 ? 12 : ((deg + 90) % 360) / 30);
        const x2 = center + textRadius * Math.cos(Math.PI * deg / 180);
        const y2 = center + textRadius * Math.sin(Math.PI * deg / 180);
        const text2 = document.createElementNS(SVG_NAMESPACE, 'text');

        text2.setAttributeNS(null, 'x', x2.toString());
        text2.setAttributeNS(null, 'y', y2.toString());
        text2.setAttributeNS(null, 'dy', '3.5');
        text2.classList.add('clock-face');
        text2.textContent = h.toString();
        this.clock.insertBefore(text2, this.hands);

        const x3 = center + constellationRadius * Math.cos(Math.PI * (-deg - 15) / 180);
        const y3 = center + constellationRadius * Math.sin(Math.PI * (-deg - 15) / 180);
        const text3 = document.createElementNS(SVG_NAMESPACE, 'text');

        text3.setAttributeNS(null, 'x', x3.toString());
        text3.setAttributeNS(null, 'y', y3.toString());
        text3.setAttributeNS(null, 'dy', '1');
        text3.classList.add('constellation');
        text3.textContent = String.fromCodePoint(0x2648 + deg / 30);
        planetTracks.appendChild(text3);
      }
    }

    const planetSymbols = [0x263C, 0x263D, 0x0263F, 0x2640, 0x2642, 0x2643, 0x2644];
    const planetIds = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn'];

    planetSymbols.forEach((planet, index) => {
      const x = center + 10 + index * 2;
      const dy = 0.75 + (index % 2) * 2;
      const rect = document.createElementNS(SVG_NAMESPACE, 'rect');
      const text = document.createElementNS(SVG_NAMESPACE, 'text');
      const path = document.createElementNS(SVG_NAMESPACE, 'path');

      rect.setAttributeNS(null, 'x', (x - 0.9).toString());
      rect.setAttributeNS(null, 'y', (center + dy - 2).toString());
      rect.setAttributeNS(null, 'width', '1.8');
      rect.setAttributeNS(null, 'height', '2.7');
      rect.setAttributeNS(null, 'fill', 'black');
      planetTracks.appendChild(rect);

      text.setAttributeNS(null, 'x', x.toString());
      text.setAttributeNS(null, 'y', centerStr);
      text.setAttributeNS(null, 'dy', dy.toString());
      text.classList.add('constellation');
      text.textContent = String.fromCodePoint(planet);
      planetTracks.appendChild(text);

      path.setAttributeNS(null, 'fill', 'none');
      path.setAttributeNS(null, 'visibility', 'inherited');
      path.classList.add('risen-track');
      path.id = `risen-${planetIds[index]}`;
      risenTracks.appendChild(path);
    });
  }

  private adjustTimeFontSize(): void {
    this.timeCaption.style['font-size'] = (this._amPm && !this._hideSeconds ? '7.5' : '10');
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
    const minuteOfLeapSecond = timeInfo.leapSecond && timeInfo.time % MILLIS_PER_DAY >= MILLIS_PER_DAY - 60000 &&
            wallTime.d === getLastDateInMonthGregorian(wallTime.y, wallTime.m);
    const leapSecondForMonth = (minuteOfLeapSecond && timeInfo.leapSecond) || this.checkPendingLeapSecondForMonth(wallTimeUtc);

    if (this.lastLeapSecondCheckDay !== wallTimeUtc.d) {
      this.lastLeapSecondCheckDay = wallTimeUtc.d;
      this.getLeapSecondInfo();
    }

    if (this.inMinuteOfLeapSecond !== minuteOfLeapSecond) {
      if (!minuteOfLeapSecond) {
        this.clock.classList.remove('leap-second');
        this.clock.classList.remove('neg-leap-second');
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

    if (doMechanicalSecondHandEffect)
      sweepSecondHand(this.lastSecRotation, secRotation);

    rotate(this.secHand, secRotation);
    this.lastSecRotation = secRotation;
    rotate(this.minHand, 6 * mins + 0.1 * Math.min(secs, 59));
    rotate(this.hourHand, 30 * (hour % 12) + mins / 2 + Math.min(secs, 59) / 120);
    setTimeout(() => this.tick(), 1000 - millis);

    setTimeout(() => {
      const dayOfTheWeek = getDayOfWeek(wallTime.n);

      this.dayOfWeekCaption.textContent = daysOfWeek[dayOfTheWeek].toUpperCase();
      this.dateCaption.textContent = padLeft(wallTime.d, 2, '0');
      this.monthCaption.textContent = months[wallTime.m - 1].toUpperCase();
      this.yearCaption.textContent = wallTime.y.toString();
      this.day2Caption.textContent = daysOfWeek[(dayOfTheWeek + 2) % 7];
      this.day3Caption.textContent = daysOfWeek[(dayOfTheWeek + 3) % 7];
      this.zoneCaption.textContent = this.timezone.zoneName + ' UTC' + KsTimeZone.formatUtcOffset(date.utcOffsetSeconds);

      let displayHour = hour;
      let suffix = '';
      let secsText = padLeft(secs, 2, '0');

      if (!this._hideSeconds && minuteOfLeapSecond && ((timeInfo.leapSecond > 0 && secs === 60) || (timeInfo.leapSecond < 0 && secs === 58)))
        secsText = '<tspan style="fill: #F55">' + secsText + '</tspan>';

      if (this.amPm) {
        if (displayHour === 0)
          displayHour = 12;
        else if (displayHour > 12)
          displayHour -= 12;

        suffix = (hour < 12 ? ' AM' : ' PM');
      }

      this.timeCaption.innerHTML =
        padLeft(displayHour, 2, '0') + ':' +
        padLeft(mins, 2, '0') + (this._hideSeconds ? '' : ':' + secsText) + suffix;

      if (mins !== this.lastMinute || this.lastTick + 60000 <= now) {
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
    // noinspection JSIgnoredPromiseFromCall
    $.ajax({
      url: this.appService.getWeatherServer() + '/tai-utc',
      dataType: 'json',
      success: (data: CurrentDelta) => this.upcomingLeapSecond = data,
      error: () => setTimeout(() => {
        this.upcomingLeapSecond = undefined;
        this.lastLeapSecondCheckDay = -1;
      }, LEAP_SECOND_RETRY_DELAY)
    });
  }
}
