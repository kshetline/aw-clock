import * as $ from 'jquery';
import { initTimeZoneSmall } from 'ks-date-time-zone/dist/ks-timezone-small';
import * as Cookies from 'js-cookie';

import { initClock, startClock, triggerRefresh, setAmPm, setHideSeconds, getTimezone } from './clock';
import { initForecast, updateForecast, showUnknown, refreshForecastFromCache } from './forecast';
import { initSettings, openSettings } from './settings';
import { setFullScreen } from './util';
import { initEphemeris, setHidePlanets, updateEphemeris } from './ephemeris';

initTimeZoneSmall();

let latitude;
let longitude;
let city;
let userId;
let celsius;
let amPm;
let hideSeconds;
let hidePlanets;

let frequent = false;
let lastHour = -1;
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
  celsius = Cookies.get('celsius') === 'true';
  amPm = Cookies.get('ampm') === 'true';
  hideSeconds = Cookies.get('hides') === 'true';
  hidePlanets = Cookies.get('hidep') === 'true';

  initClock();
  setAmPm(amPm);
  setHideSeconds(hideSeconds);
  initForecast();
  initEphemeris();
  initSettings();
  cityLabel.text(city);

  document.addEventListener('keydown', event => {
    if (event.code === 'KeyF')
      setFullScreen(true);
    else if (event.code === 'KeyN')
      setFullScreen(false);
  });

  document.addEventListener('mousemove', event => {
    body.css('cursor', 'auto');
    lastCursorMove = Date.now();
  });

  let lastZone = getTimezone();

  startClock((hour, minute, forceRefresh) => {
    const now = Date.now();

    if (now > lastCursorMove + 120000)
      body.css('cursor', 'none');

    updateEphemeris(latitude, longitude, now, lastZone, amPm);

    // If it's a new day, make sure we update the weather display to show the change of day,
    // even if we aren't polling for new weather data right now.
    if (hour < lastHour || hour === 0 && minute === 0)
      refreshForecastFromCache();

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
            updateEphemeris(latitude, longitude, now, currentZone, amPm);
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
    const previousSettings = {city, latitude, longitude, userId, celsius, amPm, hideSeconds, hidePlanets};

    openSettings(previousSettings, newSettings => {
      if (newSettings) {
        showUnknown();
        ({city, latitude, longitude, userId, celsius, amPm, hideSeconds, hidePlanets} = newSettings);
        const expiration = 36525;

        Cookies.set('city', city, {expires: expiration});
        Cookies.set('latitude', latitude, {expires: expiration});
        Cookies.set('longitude', longitude, {expires: expiration});
        Cookies.set('id', userId, {expires: expiration});
        Cookies.set('celsius', celsius, {expires: expiration});
        Cookies.set('ampm', amPm, {expires: expiration});
        Cookies.set('hides', hideSeconds, {expires: expiration});
        Cookies.set('hidep', hidePlanets, {expires: expiration});
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
