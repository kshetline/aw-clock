import * as $ from 'jquery';
import { initTimeZoneSmall } from 'ks-date-time-zone/dist/ks-timezone-small';
import * as Cookies from 'js-cookie';

import { initClock, startClock, triggerRefresh } from './clock';
import { initForecast, updateForecast, showUnknown } from './forecast';
import { initSettings, openSettings } from './settings';
import './util';

initTimeZoneSmall();

let latitude;
let longitude;
let city;
let userId;

$(() => {
  let lastForecast = 0;
  const dialogWrapper = $('.dialog-wrapper');

  latitude = Number(Cookies.get('latitude')) || 42.75;
  longitude = Number(Cookies.get('longitude')) || -71.48;
  city = Cookies.get('city') || 'Nashua, NH';
  userId = Cookies.get('id') || '';

  initClock();
  initForecast();
  initSettings();

  startClock((hour, minute, forceRefresh) => {
    const now = Date.now();

    if (forceRefresh || minute % 5 === 0 || lastForecast + 7.5 * 60000 <= now) {
      updateForecast(latitude, longitude);
      lastForecast = now;
    }
  });

  $('#settings-btn').on('click', () => {
    const previousSettings = {city, latitude, longitude, userId};

    openSettings(previousSettings, newSettings => {
      if (newSettings) {
        showUnknown();
        ({city, latitude, longitude, userId} = newSettings);
        Cookies.set('city', city, {expires: 36525});
        Cookies.set('latitude', latitude, {expires: 36525});
        Cookies.set('longitude', longitude, {expires: 36525});
        Cookies.set('id', userId, {expires: 36525});
        triggerRefresh();
      }
    });
  });

  dialogWrapper.on('click', event => {
    if (event.shiftKey)
      dialogWrapper.css('display', 'none');
  });
});
