import * as $ from 'jquery';
import { initTimeZoneSmall } from 'ks-date-time-zone/dist/ks-timezone-small';
import * as Cookies from 'js-cookie';

import { initClock, startClock, triggerRefresh, setAmPm, setHideSeconds, getTimezone, currentTime } from './clock';
import { initForecast, updateForecast, showUnknown, refreshForecastFromCache } from './forecast';
import { initSettings, openSettings } from './settings';
import { setFullScreen } from './util';
import { initEphemeris, setHidePlanets, updateEphemeris } from './ephemeris';
import { KsDateTime } from 'ks-date-time-zone';
import { initIndoor, updateIndoor } from './indoor';

initTimeZoneSmall();

let latitude: number;
let longitude: number;
let city: string;
let userId: string;
let dimming: number;
let dimmingStart: string;
let dimmingEnd: string;
let celsius: boolean;
let amPm: boolean;
let hideSeconds: boolean;
let hidePlanets: boolean;

let frequent = false;
let lastHour = -1;
let hasIndoor = false;

let dimmer: JQuery;

// Make sure most clients stagger their polling so that the weather server isn't likely
// to get lots of simultaneous requests.
const pollingMinute = Math.floor(Math.random() * 15);
const pollingMillis = Math.floor(Math.random() * 60000);

$(() => {
  let lastForecast = 0;
  let lastCursorMove = 0;
  const dialogWrapper = $('.dialog-wrapper');
  const cityLabel = $('#city');
  const body = $('body');

  latitude = Number(Cookies.get('latitude')) || 42.75;
  longitude = Number(Cookies.get('longitude')) || -71.48;
  city = Cookies.get('city') || 'Nashua, NH';
  userId = Cookies.get('id') || '';
  dimming = Number(Cookies.get('dimming')) || 0;
  dimmingStart = Cookies.get('dimming_start') || '23:00';
  dimmingEnd = Cookies.get('dimming_end') || '7:00';
  celsius = Cookies.get('celsius') === 'true';
  amPm = Cookies.get('ampm') === 'true';
  hideSeconds = Cookies.get('hides') === 'true';
  hidePlanets = Cookies.get('hidep') === 'true';

  dimmer = $('#dimmer');

  initClock();
  setAmPm(amPm);
  setHideSeconds(hideSeconds);
  initForecast();
  hasIndoor = initIndoor();
  initEphemeris();
  initSettings();
  cityLabel.text(city);

  document.addEventListener('keypress', event => {
    if (!event.repeat && event.srcElement === document.body) {
      if (event.code === 'KeyF' || event.key === 'F' || event.key === 'f')
        setFullScreen(true);
      else if (event.code === 'KeyN' || event.key === 'N' || event.key === 'n')
        setFullScreen(false);
    }
  });

  document.addEventListener('mousemove', () => {
    // Reveal cursor when moved.
    body.css('cursor', 'auto');
    lastCursorMove = performance.now();
  });

  let lastZone = getTimezone();

  startClock((hour, minute, forceRefresh) => {
    const now = currentTime();

    // Hide cursor if it hasn't been moved in the last two minutes.
    if (performance.now() > lastCursorMove + 120000)
      body.css('cursor', 'none');

    updateEphemeris(latitude, longitude, now, lastZone, amPm, (rise, set) => {
      updateDimming(now, rise, set);
    });

    // If it's a new day, make sure we update the weather display to show the change of day,
    // even if we aren't polling for new weather data right now.
    if (hour < lastHour || hour === 0 && minute === 0)
      refreshForecastFromCache();

    if (hasIndoor)
      updateIndoor(celsius);

    lastHour = hour;

    const interval = (frequent ? 5 : 15);
    const runningLate = (lastForecast + interval * 60000 <= now);
    const minuteOffset = (frequent ? 0 : pollingMinute);
    const millisOffset = (frequent || forceRefresh || runningLate ? 0 : pollingMillis);

    if (forceRefresh || minute % interval === minuteOffset || runningLate) {
      const doUpdate = () => {
        updateForecast(latitude, longitude, celsius, amPm, userId).then(isFrequent => {
          if (isFrequent !== undefined)
            frequent = isFrequent;

          const currentZone = getTimezone();

          if (lastZone !== currentZone) {
            lastZone = currentZone;
            updateEphemeris(latitude, longitude, now, lastZone, amPm, (rise, set) => {
              updateDimming(now, rise, set);
            });
          }
        });

        lastForecast = now;
      };

      if (millisOffset === 0)
        doUpdate();
      else
        setTimeout(doUpdate, millisOffset);
    }
  });

  $('#settings-btn').on('click', () => {
    const previousSettings = {city, latitude, longitude, userId, dimming, dimmingStart, dimmingEnd, celsius, amPm, hideSeconds, hidePlanets};

    openSettings(previousSettings, newSettings => {
      if (newSettings) {
        showUnknown();
        ({city, latitude, longitude, userId, dimming, dimmingStart, dimmingEnd, celsius, amPm, hideSeconds, hidePlanets} = newSettings);
        const expiration = 36525;

        Cookies.set('city', city, {expires: expiration});
        Cookies.set('latitude', latitude.toString(), {expires: expiration});
        Cookies.set('longitude', longitude.toString(), {expires: expiration});
        Cookies.set('id', userId, {expires: expiration});
        Cookies.set('dimming', dimming.toString(), {expires: expiration});
        Cookies.set('dimming_start', dimmingStart, {expires: expiration});
        Cookies.set('dimming_end', dimmingEnd, {expires: expiration});
        Cookies.set('celsius', celsius.toString(), {expires: expiration});
        Cookies.set('ampm', amPm.toString(), {expires: expiration});
        Cookies.set('hides', hideSeconds.toString(), {expires: expiration});
        Cookies.set('hidep', hidePlanets.toString(), {expires: expiration});
        cityLabel.text(city);
        setAmPm(amPm);
        setHideSeconds(hideSeconds);
        setHidePlanets(hidePlanets);
        triggerRefresh();
      }
    });
  });

  dialogWrapper.on('click', event => {
    if (event.shiftKey)
      dialogWrapper.css('display', 'none');
  });
});

function updateDimming(now: number, todayRise: string, todaySet: string) {
  if (dimming) {
    let start = dimmingStart;
    let end = dimmingEnd;

    if (start === 'SR')
      start = todayRise;
    else if (start === 'SS')
      start = todaySet;

    if (end === 'SR')
      end = todayRise;
    else if (end === 'SS')
      end = todaySet;

    if (start && end) {
      const startMinute = parseTime(start);
      const endMinute = parseTime(end);

      if (startMinute !== endMinute) {
        const time = new KsDateTime(now, getTimezone());
        const currentMinute = time.wallTime.hrs * 60 + time.wallTime.min;

        if ((startMinute > endMinute && (startMinute <= currentMinute || currentMinute < endMinute)) ||
            (startMinute < endMinute && startMinute <= currentMinute && currentMinute < endMinute)) {
          dimmer.css('opacity', (dimming / 100).toString());
          return;
        }
      }
    }
  }

  dimmer.css('opacity', '0');
}

function parseTime(s: string): number {
  const parts = s.split(':');

  return Number(parts[0]) * 60 + Number(parts[1]);
}
