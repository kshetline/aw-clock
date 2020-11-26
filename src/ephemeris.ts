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
  private nightSkyTracks: JQuery;
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
    this.nightSkyTracks = $('#night-sky-tracks');
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

  private static setArc(path: JQuery, radius: number, startAngle: number, endAngle: number, append = false): void {
    while (startAngle + 360 < endAngle)
      startAngle += 360;

    while (endAngle < startAngle)
      endAngle += 360;

    let arc = describeArc(50, 50, radius, startAngle, endAngle);

    if (append)
      arc = path[0].getAttribute('d') + ' ' + arc;

    path[0].setAttribute('d', arc);
    path.css('visibility', 'visible');
  }

  update(latitude: number, longitude: number, time: number, timezone: KsTimeZone, amPm: boolean): void {
    function rotate(elem: JQuery, deg: number) {
      elem.attr('transform', 'rotate(' + deg + ' 50 50)');
    }

    time = Math.floor(time / 60_000) * 60_000; // Make sure time is in whole minutes.

    const dateTime = new KsDateTime(time, timezone);
    const wallTime = dateTime.wallTime;
    const time_JDU = KsDateTime.julianDay(time) + HALF_MINUTE; // Round up half a minute for consistency with rounding of event times.
    const time_JDE = UT_to_TDB(time_JDU);
    const observer = new SkyObserver(longitude, latitude);
    let sunDownAllDay = false;
    let sunUpAllDay = false;
    let sunRiseAngle: number = null;
    let sunSetAngle: number = null;

    planets.forEach((planet, index) => {
      const eclipticLongitude = solarSystem.getEclipticPosition(planet, time_JDE).longitude.degrees;
      const altitude = solarSystem.getHorizontalPosition(planet, time_JDU, observer).altitude.degrees;
      const elem = this.planetElems[index];
      let targetAltitude = -REFRACTION_AT_HORIZON;

      if (planet === SUN || planet === MOON)
        targetAltitude -= AVG_SUN_MOON_RADIUS;

      const risen = (altitude >= targetAltitude);
      let rise: AstroEvent;
      let set: AstroEvent;
      const nightSkyTrack = $('#night-sky-' + planetIds[index]);
      const risenTrack = $('#risen-' + planetIds[index]);

      if (risen) {
        rise = eventFinder.findEvent(planet, RISE_EVENT, time_JDU, observer, timezone, null, true, null, 2);
        set = eventFinder.findEvent(planet, SET_EVENT, time_JDU, observer, timezone, null, false, null, 2);
      }
      else {
        set = eventFinder.findEvent(planet, SET_EVENT, time_JDU, observer, timezone, null, true, null, 2);
        rise = eventFinder.findEvent(planet, RISE_EVENT, time_JDU, observer, timezone, null, false, null, 2);

        if (set && rise) {
          if (time_JDU - set.ut < (rise.ut - time_JDU) / 2)
            rise = eventFinder.findEvent(planet, RISE_EVENT, set.ut, observer, timezone, null, true, null, 2);
          else
            set = eventFinder.findEvent(planet, SET_EVENT, rise.ut, observer, timezone, null, false, null, 2);
        }
      }

      rotate(elem, -eclipticLongitude);
      elem.css('stroke-width', risen ? '0' : '0.25');
      elem[0].setAttribute('r', altitude < targetAltitude ? '0.625' : '0.75');

      const radius = 10 + index * 2;

      if (rise && rise.ut > time_JDU - 1.1 && set && set.ut < time_JDU + 1.1) {
        const currentAngle = mod(-eclipticLongitude, 360);
        const riseAngle = currentAngle + (time_JDU - rise.ut) * 360;
        const setAngle = currentAngle + (time_JDU - set.ut) * 360;

        if (planet === SUN) {
          sunRiseAngle = riseAngle;
          sunSetAngle = setAngle;
        }

        Ephemeris.setArc(risenTrack, radius, setAngle, riseAngle);

        if (planet !== SUN && !sunUpAllDay) {
          const sunAltitude = solarSystem.getHorizontalPosition(SUN, rise.ut, observer).altitude.degrees;
          let sunUp = sunAltitude >= -REFRACTION_AT_HORIZON - AVG_SUN_MOON_RADIUS;
          let append = false;
          let secondArcStart = rise.ut;

          if (!sunUp) {
            const startAngle = currentAngle + (time_JDU - rise.ut) * 360;
            let endTime = set.ut;
            const sunRise = eventFinder.findEvent(SUN, RISE_EVENT, rise.ut, observer, timezone, null, false, null, 2);

            if (sunRise && sunRise.ut < endTime) {
              endTime = sunRise.ut;
              secondArcStart = endTime + 1 / 1440;
              sunUp = true;
            }

            const endAngle = currentAngle + (time_JDU - endTime) * 360;

            Ephemeris.setArc(nightSkyTrack, radius, endAngle, startAngle);
            append = true;
          }

          if (sunUp) {
            const sunSet = eventFinder.findEvent(SUN, SET_EVENT, secondArcStart, observer, timezone, null, false, null, 2);

            if (sunSet && sunSet.ut < set.ut) {
              const startAngle = currentAngle + (time_JDU - sunSet.ut) * 360;
              const endAngle = currentAngle + (time_JDU - set.ut) * 360;

              Ephemeris.setArc(nightSkyTrack, radius, endAngle, startAngle, append);
            }
            else if (!append)
              nightSkyTrack.css('visibility', 'hidden');
          }
          else if (!append)
            nightSkyTrack.css('visibility', 'hidden');
        }
        else
          nightSkyTrack.css('visibility', 'hidden');
      }
      else if (risen) {
        // In the sky all day
        risenTrack[0].setAttribute('d', describeArc(50, 50, radius, 0, 359.99));
        risenTrack.css('visibility', 'visible');

        if (planet === SUN)
          sunUpAllDay = true;
        else if (sunDownAllDay) {
          nightSkyTrack[0].setAttribute('d', describeArc(50, 50, radius, 0, 359.99));
          nightSkyTrack.css('visibility', 'visible');
        }
        else if (sunRiseAngle != null) {
          while (sunSetAngle < sunRiseAngle)
            sunSetAngle += 360;

          const arc = describeArc(50, 50, radius, sunRiseAngle, sunSetAngle);

          nightSkyTrack[0].setAttribute('d', arc);
          nightSkyTrack.css('visibility', 'visible');
        }
        else
          nightSkyTrack.css('visibility', 'hidden');
      }
      else {
        // Below the horizon all day
        nightSkyTrack.css('visibility', 'hidden');
        risenTrack.css('visibility', 'hidden');

        if (planet === SUN)
          sunDownAllDay = true;
      }
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
