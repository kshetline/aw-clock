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
import { setSvgHref } from './util';

const solarSystem = new SolarSystem();
const eventFinder = new EventFinder();
const planets = [SUN, MOON, MERCURY, VENUS, MARS, JUPITER, SATURN];
const planetIds = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn'];
const planetElems: JQuery[] = [];

let hidePlanets = false;
let planetTracks: JQuery;
let planetSymbols: JQuery;

const sunrises: JQuery[] = [];
const sunsets: JQuery[] = [];
const moons: JQuery[] = [];
const phaseTimes: JQuery[] = [];

export function initEphemeris(): void {
  planetIds.forEach((planet, index) => {
    planetElems[index] = $('#' + planetIds[index]);
  });

  planetTracks = $('#planet-tracks');
  planetSymbols = $('#planets');

  for (let i = 0; i < 4; ++i) {
    sunrises[i] = $('#day' + i + '-sunrise');
    sunsets[i] = $('#day' + i + '-sunset');
    moons[i] = $('#day' + i + '-moon');
    phaseTimes[i] = $('#day' + i + '-phase-time');
  }
}

export function setHidePlanets(hide: boolean) {
  hidePlanets = hide;

  if (hide) {
    planetTracks.css('visibility', 'hidden');
    planetSymbols.css('visibility', 'hidden');
  }
  else {
    planetTracks.css('visibility', 'visible');
    planetSymbols.css('visibility', 'visible');
  }
}

export function updateEphemeris(latitude: number, longitude: number, time: number, timezone: KsTimeZone, amPm: boolean,
                                riseSetCallback?: (rise, set) => void): void {
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
    const elem = planetElems[index];
    let targetAltitude = -REFRACTION_AT_HORIZON;

    if (planet === SUN || planet === MOON)
      targetAltitude -= AVG_SUN_MOON_RADIUS;

    rotate(elem, -eclipticLongitude);
    elem.css('stroke-width', altitude < targetAltitude ? '0.5' : '0');
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

      sunrises[dayOffset].text(rise);
      sunsets[dayOffset].text(set);
    });

    if (riseSetCallback)
      riseSetCallback(todayRise, todaySet);
  });

  for (let dayIndex = 0; dayIndex < 4; ++dayIndex) {
    const date = getDateFromDayNumber_SGC(wallTime.n + dayIndex);
    const noon = new KsDateTime({y: date.y, m: date.m, d: date.d, hrs: 12, min: 0, sec: 0}, timezone);
    const noon_JDU = KsDateTime.julianDay(noon.utcTimeMillis);
    const noon_JDE = UT_to_TDB(noon_JDU);
    const phase = solarSystem.getLunarPhase(noon_JDE);
    const event = eventFinder.getLunarPhaseEvent(date.y, date.m, date.d, timezone);

    setSvgHref(moons[dayIndex], getMoonPhaseIcon(phase));
    phaseTimes[dayIndex].text(event ? formatTime(event.eventTime, amPm) : '');
  }
}

function pad(n) {
  return (n < 10 ? '0' : '') + n;
}

function getMoonPhaseIcon(phase: number) {
  return `assets/moon/phase-${pad(Math.round(phase / 360 * 28) % 28)}.svg`;
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

  return pad(hours) + ':' + pad(date.wallTime.min) + suffix;
}
