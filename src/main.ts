import * as $ from 'jquery';
import { initTimeZoneSmall } from 'ks-date-time-zone/dist/ks-timezone-small';
import * as Cookies from 'js-cookie';

import { initClock, startClock } from './clock';
import { initForecast, updateForecast } from './forecast';
import { initSettings, openSettings } from './settings';
import './util';

initTimeZoneSmall();

let latitude;
let longitude;
let city;

$(() => {
  let lastForecast = 0;
  const dialogWrapper = $('.dialog-wrapper');

  latitude = Number(Cookies.get('latitude')) || 42.75;
  longitude = Number(Cookies.get('longitude')) || -71.48;
  city = Cookies.get('city') || 'Nashua, NH';

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
    openSettings(settings => {
    });
  });

  dialogWrapper.on('click', event => {
    if (event.shiftKey)
      dialogWrapper.css('display', 'none');
  });
});
