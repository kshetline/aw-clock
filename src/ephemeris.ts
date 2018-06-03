import {
  AVG_SUN_MOON_RADIUS, EventFinder, JUPITER, MARS, MERCURY, MOON, REFRACTION, RISE_EVENT, SATURN, SET_EVENT, SkyObserver,
  SolarSystem, SUN, UT_to_TDB, VENUS
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

export function updateEphemeris(latitude: number, longitude: number, time: number, timezone: KsTimeZone, amPm: boolean) {
  function rotate(elem: JQuery, deg: number) {
    elem.attr('transform', 'rotate(' + deg + ' 50 50)');
  }

  const dateTime = new KsDateTime(time, timezone);
  const wallTime = dateTime.wallTime;
  const time_JDU = KsDateTime.julianDay(time);
  const time_JDE = UT_to_TDB(time_JDU);
  const observer = new SkyObserver(longitude, latitude);

  planets.forEach((planet, index) => {
    const eclipticLongitude = solarSystem.getEclipticPosition(planet, time_JDE).longitude.degrees;
    let altitude = solarSystem.getHorizontalPosition(planet, time_JDU, observer, REFRACTION).altitude.degrees;
    const elem = planetElems[index];

    if (planet === SUN || planet === MOON)
      altitude += AVG_SUN_MOON_RADIUS;

    rotate(elem, -eclipticLongitude);
    elem.css('stroke-width', altitude < 0 ? '0.5' : '0');
  });

  eventFinder.getRiseAndSetEvents(SUN, wallTime.y, wallTime.m, wallTime.d, 4, observer, timezone).then(daysOfEvents => {
    daysOfEvents.forEach((events, dayOffset) => {
      let rise = '--:--';
      let set = '--:--';

      events.forEach(event => {
        if (event.eventType === RISE_EVENT)
          rise = formatTime(event.eventTime, amPm);
        else if (event.eventType === SET_EVENT)
          set = formatTime(event.eventTime, amPm);
      });

      sunrises[dayOffset].text(rise);
      sunsets[dayOffset].text(set);
    });
  });

  for (let dayIndex = 0; dayIndex < 4; ++dayIndex) {
    const date = getDateFromDayNumber_SGC(wallTime.n + dayIndex);
    const noon = new KsDateTime({y: date.y, m: date.m, d: date.d, hrs: 12, min: 0, sec: 0}, timezone);
    const noon_JDU = KsDateTime.julianDay(noon.utcTimeMillis);
    const noon_JDE = UT_to_TDB(noon_JDU);
    const phase = solarSystem.getLunarPhase(noon_JDE);
    const event = eventFinder.getLunarPhaseEvent(date.y, date.m, date.d, timezone);

    setSvgHref(moons[dayIndex], getMoonPhaseIcon(phase));

    if (event)
      phaseTimes[dayIndex].text(formatTime(event.eventTime, amPm));
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
