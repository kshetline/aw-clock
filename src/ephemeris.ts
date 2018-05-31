import {
  AVG_SUN_MOON_RADIUS, JUPITER, MARS, MERCURY, MOON, SATURN, SkyObserver, SolarSystem, SUN, TOPOCENTRIC, UT_to_TDB,
  VENUS
} from 'ks-astronomy';
import { KsDateTime, KsTimeZone } from 'ks-date-time-zone';
import * as $ from 'jquery';

const solarSystem = new SolarSystem();
const planets = [SUN, MOON, MERCURY, VENUS, MARS, JUPITER, SATURN];
const planetIds = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn'];
const planetElems: JQuery[] = [];

let hidePlanets = false;
let planetTracks: JQuery;
let planetSymbols: JQuery;

export function initEphemeris(): void {
  planetIds.forEach((planet, index) => {
    planetElems[index] = $('#' + planetIds[index]);
  });

  planetTracks = $('#planet-tracks');
  planetSymbols = $('#planets');
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

export function updateEphemeris(latitude: number, longitude: number, time: number, timezone: KsTimeZone) {
  function rotate(elem: JQuery, deg: number) {
    elem.attr('transform', 'rotate(' + deg + ' 50 50)');
  }

  const time_JDU = KsDateTime.julianDay(time);
  const time_JDE = UT_to_TDB(time_JDU);
  const observer = new SkyObserver(longitude, latitude);

  planets.forEach((planet, index) => {
    const eclipticLongitude = solarSystem.getEclipticPosition(planet, time_JDE).longitude.degrees;
    let altitude = solarSystem.getHorizontalPosition(planet, time_JDU, observer).altitude.degrees;
    const elem = planetElems[index];

    if (planet === SUN || planet === MOON)
      altitude += AVG_SUN_MOON_RADIUS;

    rotate(elem, -eclipticLongitude);
    elem.css('stroke-width', altitude < 0 ? '0.5' : '0');
  });
}
