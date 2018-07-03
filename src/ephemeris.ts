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

import {
  AVG_SUN_MOON_RADIUS, EventFinder, HALF_MINUTE, JUPITER, MARS, MERCURY, MOON, REFRACTION_AT_HORIZON, RISE_EVENT, SATURN,
  SET_EVENT, SkyObserver, SolarSystem, SUN, UT_to_TDB, VENUS
} from 'ks-astronomy';
import { getDateFromDayNumber_SGC, KsDateTime, KsTimeZone } from 'ks-date-time-zone';
import * as $ from 'jquery';
import { describeArc, setSvgHref } from './util';
import { AppService } from './app.service';
import { padLeft } from 'ks-util';
import { mod } from 'ks-math';

const solarSystem = new SolarSystem();
const eventFinder = new EventFinder();
const planets = [SUN, MOON, MERCURY, VENUS, MARS, JUPITER, SATURN];
const planetIds = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn'];

function getMoonPhaseIcon(phase: number) {
  return `assets/moon/phase-${padLeft(Math.round(phase / 360 * 28) % 28, 2, '0')}.svg`;
}

function formatTime(date: KsDateTime, amPm: boolean) {
  let hours = date.wallTime.hrs;
  let suffix = '';

  if (amPm) {
    if (hours === 0)
      hours = 12;
    else if (hours > 12)
      hours -= 12;

    suffix = (date.wallTime.hrs < 12 ? 'a' : 'p');
  }

  return padLeft(hours, 2, '0') + ':' + padLeft(date.wallTime.min, 2, '0') + suffix;
}

export class Ephemeris {
  private planetTracks: JQuery;
  private planetSymbols: JQuery;
  private risenTracks: JQuery;
  private sunrises: JQuery[] = [];
  private sunsets: JQuery[] = [];
  private moons: JQuery[] = [];
  private phaseTimes: JQuery[] = [];
  private planetElems: JQuery[] = [];

  private _hidePlanets = false;

  constructor(private appService: AppService) {
    planetIds.forEach((planet, index) => {
      this.planetElems[index] = $('#' + planetIds[index]);
    });

    this.planetTracks = $('#planet-tracks');
    this.planetSymbols = $('#planets');
    this.risenTracks = $('#risen-tracks');

    for (let i = 0; i < 4; ++i) {
      this.sunrises[i] = $('#day' + i + '-sunrise');
      this.sunsets[i] = $('#day' + i + '-sunset');
      this.moons[i] = $('#day' + i + '-moon');
      this.phaseTimes[i] = $('#day' + i + '-phase-time');
    }
  }

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

    time = Math.floor(time / 60000) * 60000; // Make sure time is in whole minutes.

    const dateTime = new KsDateTime(time, timezone);
    const wallTime = dateTime.wallTime;
    const time_JDU = KsDateTime.julianDay(time) + HALF_MINUTE; // Round up half a minute for consistency with rounding of event times.
    const time_JDE = UT_to_TDB(time_JDU);
    const observer = new SkyObserver(longitude, latitude);

    planets.forEach((planet, index) => {
      const eclipticLongitude = solarSystem.getEclipticPosition(planet, time_JDE).longitude.degrees;
      const altitude = solarSystem.getHorizontalPosition(planet, time_JDU, observer).altitude.degrees;
      const elem = this.planetElems[index];
      let targetAltitude = -REFRACTION_AT_HORIZON;

      if (planet === SUN || planet === MOON)
        targetAltitude -= AVG_SUN_MOON_RADIUS;

      rotate(elem, -eclipticLongitude);
      elem.css('stroke-width', altitude < targetAltitude ? '0.25' : '0');
      elem[0].setAttributeNS(null, 'r', altitude < targetAltitude ? '0.625' : '0.75');

      const risenTrack = $('#risen-' + planetIds[index]);
      const rise = eventFinder.findEvent(planet, RISE_EVENT, time_JDU + 5 / 1400, observer, timezone, null, true);
      const set = eventFinder.findEvent(planet, SET_EVENT, time_JDU - 5 / 1440, observer, timezone);

      if (rise && rise.ut > time_JDU - 1.1 && set && set.ut < time_JDU + 1.1) {
        const currentAngle = mod(-eclipticLongitude, 360);
        const radius = 10 + index * 2;
        let riseAngle = currentAngle + (time_JDU - rise.ut) * 360;
        let setAngle = currentAngle + (time_JDU - set.ut) * 360;

        while (setAngle + 360 < riseAngle)
          setAngle += 360;

        while (riseAngle < setAngle)
          riseAngle += 360;

        const arc = describeArc(50, 50, radius, setAngle, riseAngle);

        risenTrack[0].setAttributeNS(null, 'd', arc);
        risenTrack.css('visibility', 'inherited');
      }
      else
        risenTrack.css('visibility', 'hidden');
    });

    eventFinder.getRiseAndSetEvents(SUN, wallTime.y, wallTime.m, wallTime.d, 4, observer, timezone).then(daysOfEvents => {
      let todayRise: string = null;
      let todaySet: string = null;

      daysOfEvents.forEach((events, dayOffset) => {
        let rise = '--:--';
        let set = '--:--';

        events.forEach(event => {
          if (event.eventType === RISE_EVENT) {
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

        this.sunrises[dayOffset].text(rise);
        this.sunsets[dayOffset].text(set);
      });

      this.appService.updateSunriseAndSunset(todayRise, todaySet);
    });

    for (let dayIndex = 0; dayIndex < 4; ++dayIndex) {
      const date = getDateFromDayNumber_SGC(wallTime.n + dayIndex);
      const noon = new KsDateTime({y: date.y, m: date.m, d: date.d, hrs: 12, min: 0, sec: 0}, timezone);
      const noon_JDU = KsDateTime.julianDay(noon.utcTimeMillis);
      const noon_JDE = UT_to_TDB(noon_JDU);
      const phase = solarSystem.getLunarPhase(noon_JDE);
      const event = eventFinder.getLunarPhaseEvent(date.y, date.m, date.d, timezone);

      setSvgHref(this.moons[dayIndex], getMoonPhaseIcon(phase));
      this.phaseTimes[dayIndex].text(event ? formatTime(event.eventTime, amPm) : '');
    }
  }
}
