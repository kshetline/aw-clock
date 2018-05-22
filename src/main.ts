import * as $ from 'jquery';
import { initClock, startClock } from './clock';
import { initForecast, updateForecast } from './forecast';
import { initTimeZoneSmall } from 'ks-date-time-zone/dist/ks-timezone-small';

initTimeZoneSmall();

const latitude = 42.75;
const longitude = -71.48;

$(() => {
  let lastForecast = 0;

  initClock();
  initForecast();

  startClock((hour, minute, forceRefresh) => {
    const now = Date.now();

    if (forceRefresh || minute % 5 === 0 || lastForecast + 7.5 * 60000 <= now) {
      updateForecast(latitude, longitude);
      lastForecast = now;
    }
  });
});
