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

import {
  AstroEvent,
  AVG_SUN_MOON_RADIUS, EventFinder, HALF_MINUTE, JUPITER, MARS, MERCURY, MOON, REFRACTION_AT_HORIZON, RISE_EVENT, SATURN,
  SET_EVENT, SkyObserver, SolarSystem, SUN, UT_to_TDB, VENUS
} from 'ks-astronomy';
import { getDateFromDayNumber_SGC, KsDateTime, KsTimeZone } from 'ks-date-time-zone';
import $ from 'jquery';
import { describeArc, formatTime, setSvgHref } from './util';
import { AppService } from './app.service';
import { padLeft } from 'ks-util';
import { mod } from 'ks-math';

const solarSystem = new SolarSystem();
const eventFinder = new EventFinder();
const planets = [SUN, MOON, MERCURY, VENUS, MARS, JUPITER, SATURN];
const planetIds = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn'];

const REVERT_TO_SUN_INFO_DELAY = 60_000; // 1 minute

function getMoonPhaseIcon(phase: number) {
  return `assets/moon/phase-${padLeft(Math.round(phase / 360 * 28) % 28, 2, '0')}.svg`;
}

export class Ephemeris {
  private planetTracks: JQuery;
  private planetSymbols: JQuery;
  private risenTracks: JQuery;
  private rises: JQuery[][] = [];
  private sets: JQuery[][] = [];
  private extras: JQuery[][] = [];
  private moons: JQuery[] = [];
  private phaseTimes: JQuery[] = [];
  private esTimes: JQuery[] = [];
  private planetElems: JQuery[] = [];
  private sunElems: JQuery;
  private moonElems: JQuery;

  private _hidePlanets = false;
  private nowShowing = SUN;
  private moonInfoTimer: any;

  constructor(private appService: AppService) {
    planetIds.forEach((planet, index) => {
      this.planetElems[index] = $('#' + planetIds[index]);
    });

    this.planetTracks = $('#planet-tracks');
    this.planetSymbols = $('#planets');
    this.risenTracks = $('#risen-tracks');
    this.sunElems = $('.sun-info');
    this.moonElems = $('.moon-info');

    this.rises[SUN] = [];
    this.rises[MOON] = [];
    this.sets[SUN] = [];
    this.sets[MOON] = [];
    this.extras[SUN] = [];
    this.extras[MOON] = [];

    for (let i = 0; i < 7; ++i) {
      this.rises[SUN][i] = $('#day' + i + '-sunrise');
      this.rises[MOON][i] = $('#day' + i + '-moonrise');
      this.sets[SUN][i] = $('#day' + i + '-sunset');
      this.sets[MOON][i] = $('#day' + i + '-moonset');
      this.extras[SUN][i] = $('#day' + i + '-sun-extra');
      this.extras[MOON][i] = $('#day' + i + '-moon-extra');
      this.moons[i] = $('#day' + i + '-moon');
      this.phaseTimes[i] = $('#day' + i + '-phase-time');
      this.esTimes[i] = $('#day' + i + '-equisolstice');
    }
  }

  // noinspection JSUnusedGlobalSymbols
  get hidePlanets() { return this._hidePlanets; }
  set hidePlanets(newValue: boolean) {
    if (this._hidePlanets !== newValue) {
      this._hidePlanets = newValue;

      if (newValue) {
        this.planetTracks.css('visibility', 'hidden');
        this.planetSymbols.css('visibility', 'hidden');
        this.risenTracks.css('visibility', 'hidden');
      }
      else {
        this.planetTracks.css('visibility', 'visible');
        this.planetSymbols.css('visibility', 'visible');
        this.risenTracks.css('visibility', 'visible');
      }
    }
  }

  public update(latitude: number, longitude: number, time: number, timezone: KsTimeZone, amPm: boolean): void {
    function rotate(elem: JQuery, deg: number) {
      elem.attr('transform', 'rotate(' + deg + ' 50 50)');
    }

    time = Math.floor(time / 60_000) * 60_000; // Make sure time is in whole minutes.

    const dateTime = new KsDateTime(time, timezone);
    const wallTime = dateTime.wallTime;
    const time_JDU = KsDateTime.julianDay(time) + HALF_MINUTE; // Round up half a minute for consistency with rounding of event times.
    const time_JDE = UT_to_TDB(time_JDU);
    const observer = new SkyObserver(longitude, latitude);

    planets.forEach((planet, index) => {
      eventFinder.getRiseAndSetEvents(planet, wallTime.y, wallTime.m, wallTime.d - 1, 3, observer, timezone).then(daysOfEvents => {
        const eclipticLongitude = solarSystem.getEclipticPosition(planet, time_JDE).longitude.degrees;
        const altitude = solarSystem.getHorizontalPosition(planet, time_JDU, observer).altitude.degrees;
        const elem = this.planetElems[index];
        let targetAltitude = -REFRACTION_AT_HORIZON;

        if (planet === SUN || planet === MOON)
          targetAltitude -= AVG_SUN_MOON_RADIUS;

        const risen = (altitude >= targetAltitude);
        const beforeType = risen ? RISE_EVENT : SET_EVENT;
        const afterType = risen ? SET_EVENT : RISE_EVENT;
        let beforeEvent: AstroEvent = null;
        let afterEvent: AstroEvent = null;
        const risenTrack = $('#risen-' + planetIds[index]);

        rotate(elem, -eclipticLongitude);
        elem.css('stroke-width', risen ? '0' : '0.25');
        elem[0].setAttribute('r', altitude < targetAltitude ? '0.625' : '0.75');

        daysOfEvents.forEach(events => {
          events.forEach(event => {
            if (event.eventType === beforeType && event.ut < time_JDU && (!beforeEvent || event.ut > beforeEvent.ut))
              beforeEvent = event;

            if (event.eventType === afterType && beforeEvent && event.ut > time_JDU && (!afterEvent || event.ut < afterEvent.ut))
              afterEvent = event;
          });
        });

        const rise = risen ? beforeEvent : afterEvent;
        const set = risen ? afterEvent : beforeEvent;
        const radius = 10 + index * 2;

        if (rise && rise.ut > time_JDU - 1.1 && set && set.ut < time_JDU + 1.1) {
          const currentAngle = mod(-eclipticLongitude, 360);
          let riseAngle = currentAngle + (time_JDU - rise.ut) * 360;
          let setAngle = currentAngle + (time_JDU - set.ut) * 360;

          while (setAngle + 360 < riseAngle)
            setAngle += 360;

          while (riseAngle < setAngle)
            riseAngle += 360;

          const arc = describeArc(50, 50, radius, setAngle, riseAngle);

          risenTrack[0].setAttribute('d', arc);
          risenTrack.css('visibility', 'visible');
        }
        else if (risen) {
          // In the sky all day
          risenTrack[0].setAttribute('d', describeArc(50, 50, radius, 0, 359.99));
          risenTrack.css('visibility', 'visible');
        }
        else
          // Below the horizon all day
          risenTrack.css('visibility', 'hidden');
      });
    });

    [SUN, MOON].forEach(body => {
      eventFinder.getRiseAndSetEvents(body, wallTime.y, wallTime.m, wallTime.d, 7, observer, timezone).then(daysOfEvents => {
        let todayRise: string = null;
        let todaySet: string = null;

        daysOfEvents.forEach((events, dayOffset) => {
          let rise = '';
          let set = '';
          let extra = '';

          events.forEach(event => {
            // Very rarely, sometimes when an hour gets added to a day when daylight saving time ends, or
            // occasional odd timing at extreme latitudes, there can be two rise events or two set events
            // in the same day. A third display position is available for such extra events.
            if (rise && set && (event.eventType === RISE_EVENT || event.eventType === SET_EVENT))
              extra = formatTime(event.eventTime, amPm) + (event.eventType === RISE_EVENT ? '⬆︎' : '⬇︎');
            else if (event.eventType === RISE_EVENT) {
              rise = formatTime(event.eventTime, amPm);

              if (dayOffset === 0)
                todayRise = event.eventTime.wallTime.hrs + ':' + event.eventTime.wallTime.min;
            }
            else if (event.eventType === SET_EVENT) {
              set = formatTime(event.eventTime, amPm);

              if (dayOffset === 0)
                todaySet = event.eventTime.wallTime.hrs + ':' + event.eventTime.wallTime.min;
            }
          });

          this.rises[body][dayOffset].text(rise || '--:--');
          this.sets[body][dayOffset].text(set || '--:--');
          this.extras[body][dayOffset].text(extra);
        });

        if (body === SUN)
          this.appService.updateSunriseAndSunset(todayRise, todaySet);
      });
    });

    for (let dayIndex = 0; dayIndex < 7; ++dayIndex) {
      const date = getDateFromDayNumber_SGC(wallTime.n + dayIndex);
      const noon = new KsDateTime({ y: date.y, m: date.m, d: date.d, hrs: 12, min: 0, sec: 0 }, timezone);
      const noon_JDU = KsDateTime.julianDay(noon.utcTimeMillis);
      const noon_JDE = UT_to_TDB(noon_JDU);
      const phase = solarSystem.getLunarPhase(noon_JDE);
      const lpEvent = eventFinder.getLunarPhaseEvent(date.y, date.m, date.d, timezone);
      const esEvent = eventFinder.getEquinoxSolsticeEvent(date.y, date.m, date.d, timezone);

      setSvgHref(this.moons[dayIndex], getMoonPhaseIcon(phase));
      this.phaseTimes[dayIndex].text(lpEvent ? formatTime(lpEvent.eventTime, amPm) : '');
      this.esTimes[dayIndex].text(esEvent ? (date.m === 3 || date.m === 9 ? 'E•' : 'S•') +
          formatTime(esEvent.eventTime, amPm) : '');
    }
  }

  toggleSunMoon(): void {
    if (this.moonInfoTimer) {
      clearTimeout(this.moonInfoTimer);
      this.moonInfoTimer = undefined;
    }

    if (this.nowShowing === SUN) {
      this.nowShowing = MOON;

      this.moonInfoTimer = setTimeout(() => {
        this.moonInfoTimer = undefined;

        if (this.nowShowing === MOON)
          this.toggleSunMoon();
      }, REVERT_TO_SUN_INFO_DELAY);
    }
    else
      this.nowShowing = SUN;

    this.moonElems.toggleClass('sun-moon-show', this.nowShowing === MOON);
    this.moonElems.toggleClass('sun-moon-hide', this.nowShowing === SUN);
    this.sunElems.toggleClass('sun-moon-hide', this.nowShowing === MOON);
    this.sunElems.toggleClass('sun-moon-show', this.nowShowing === SUN);
  }
}
