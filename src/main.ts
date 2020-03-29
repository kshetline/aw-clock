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

import * as $ from 'jquery';
import { initTimeZoneSmall } from 'ks-date-time-zone/dist/ks-timezone-small';
import { Clock } from './clock';
import { AppService, DEV_URL } from './app.service';
import { CurrentTemperatureHumidity, CurrentTempManager } from './current-temp-manager';
import { Forecast } from './forecast';
import { KsDateTime, KsTimeZone } from 'ks-date-time-zone';
import { setFullScreen } from 'ks-util';
import { runningDev, Settings } from './settings';
import { SettingsDialog } from './settings-dialog';
import { Ephemeris } from './ephemeris';
import { Sensors } from './sensors';
import { HttpTimePoller } from './http-time-poller';
import { TimeInfo } from '../server/src/time-types';
import { updateSvgFlowItems, reflow } from './svg-flow';
import { getJson } from './util';

initTimeZoneSmall();

const weatherPort = (runningDev ? '4201' : document.location.port || '8080');
const weatherServer = new URL(window.location.href).searchParams.get('weather_server') ||
  (runningDev ? 'http://localhost:' + weatherPort : '');
const ntpPoller = new HttpTimePoller(weatherServer);
const baseTime = ntpPoller.getTimeInfo().time;
const debugTime = 0; // +new Date(2018, 6, 2, 22, 30, 0, 0);
const debugTimeRate = 60;
let sensorDeadAirState = false;

function parseTime(s: string): number {
  const parts = s.split(':');

  return Number(parts[0]) * 60 + Number(parts[1]);
}

$(() => {
  new AwClockApp().start();
});

class AwClockApp implements AppService {
  private clock: Clock;
  private currentTempManager: CurrentTempManager;
  private forecast: Forecast;
  private ephemeris: Ephemeris;
  private sensors: Sensors;
  private settingsDialog: SettingsDialog;

  private body: JQuery;
  private cityLabel: JQuery;
  private dimmer: JQuery;

  // Make sure most clients stagger their polling so that the weather server isn't likely
  // to get lots of simultaneous requests.
  private readonly pollingMinute = Math.floor(Math.random() * 15);
  private readonly pollingMillis = Math.floor(Math.random() * 60_000);

  private lastCursorMove = 0;
  private lastForecast = 0;
  private lastTimezone: KsTimeZone;
  private lastHour = -1;
  private frequent = false;
  private proxyStatus: boolean | Promise<boolean> = undefined;

  private settings = new Settings();
  private settingsChecked = false;

  constructor() {
    this.settings.load();

    this.clock = new Clock(this);
    this.clock.amPm = this.settings.amPm;
    this.clock.hideSeconds = this.settings.hideSeconds;
    this.lastTimezone = this.clock.timezone;

    this.currentTempManager = new CurrentTempManager(this);

    this.forecast = new Forecast(this);

    this.ephemeris = new Ephemeris(this);
    this.ephemeris.hidePlanets = this.settings.hidePlanets;

    this.sensors = new Sensors(this);

    this.settingsDialog = new SettingsDialog(this);

    this.body = $('body');
    this.cityLabel = $('#city');
    this.dimmer = $('#dimmer');

    this.cityLabel.text(this.settings.city);

    document.addEventListener('keypress', event => {
      if (!event.repeat && event.target === document.body) {
        if (event.code === 'KeyF' || event.key === 'F' || event.key === 'f')
          setFullScreen(true);
        else if (event.code === 'KeyN' || event.key === 'N' || event.key === 'n')
          setFullScreen(false);
      }
    });

    document.addEventListener('mousemove', () => {
      // Reveal cursor when moved.
      this.body.css('cursor', 'auto');
      this.lastCursorMove = performance.now();
    });

    $('#settings-btn').on('click', () => this.settingsDialog.openSettings(this.settings));
  }

  getCurrentTime(bias = 0): number {
    if (debugTime)
      return debugTime + (ntpPoller.getTimeInfo(bias).time - baseTime) * debugTimeRate;
    else
      return ntpPoller.getTimeInfo(bias).time;
  }

  getTimeInfo(bias = 0): TimeInfo {
    if (debugTime) {
      const time = this.getCurrentTime(bias);
      return { time, leapSecond: 0, leapExcess: 0, text: new Date(time).toISOString() };
    }
    else
      return ntpPoller.getTimeInfo(bias);
  }

  proxySensorUpdate(): Promise<boolean> {
    if (this.proxyStatus instanceof Promise)
      return this.proxyStatus;
    else if (typeof this.proxyStatus === 'boolean')
      return Promise.resolve(this.proxyStatus);

    this.proxyStatus = new Promise(resolve => $.ajax({
      url: '/wireless-th',
      dataType: 'json',
      success: data => {
        (this.proxyStatus as Promise<boolean>).then(() => this.clock.triggerRefresh());
        resolve(this.proxyStatus = typeof data === 'object' && data?.error !== 'n/a');
      },
      error: () => {
        (this.proxyStatus as Promise<boolean>).then(() => this.clock.triggerRefresh());
        resolve(this.proxyStatus = false);
      }
    }));

    return this.proxyStatus;
  }

  sensorDeadAir(isDead?: boolean): boolean {
    const wasDead = sensorDeadAirState;

    if (isDead != null)
      sensorDeadAirState = isDead;

    if (wasDead !== isDead)
      setTimeout(() => this.forecast.refreshAlerts());

    return sensorDeadAirState;
  }

  getWeatherServer(): string {
    return weatherServer;
  }

  isTimeAccelerated(): boolean {
    return (!!debugTime && debugTimeRate > 1);
  }

  start() {
    this.clock.start();

    setTimeout(() => {
      updateSvgFlowItems();
      reflow();
    });
  }

  updateTime(hour: number, minute: number, forceRefresh: boolean): void {
    const now = this.getCurrentTime();

    // Hide cursor if it hasn't been moved in the last two minutes.
    if (performance.now() > this.lastCursorMove + 120000)
      this.body.css('cursor', 'none');

    this.ephemeris.update(this.settings.latitude, this.settings.longitude, now, this.lastTimezone, this.settings.amPm);

    // If it's a new day, make sure we update the weather display to show the change of day,
    // even if we aren't polling for new weather data right now.
    if (hour < this.lastHour || (hour === 0 && minute === 0))
      this.forecast.refreshFromCache();

    this.lastHour = hour;
    this.updateWeather(minute, now, forceRefresh);
  }

  private updateWeather(minute: number, now: number, forceRefresh: boolean): void {
    if (!this.settingsChecked) {
      if (this.settings.defaultsSet())
        this.settingsChecked = true;
      else {
        const site = (runningDev ? DEV_URL : '');
        const promises = [
          getJson(`${site}/defaults`),
          getJson('http://ip-api.com/json/?callback=?')
        ];

        Promise.all(promises)
          .then(data => {
            if (data[0]?.indoorOption && data[0].outdoorOption) {
              this.settings.indoorOption = data[0].indoorOption;
              this.settings.outdoorOption = data[0].outdoorOption;
            }

            if (data[1]?.status === 'success') {
              this.settings.latitude = data[1].lat;
              this.settings.longitude = data[1].lon;
              this.settings.city = [data[1].city, data[1].region, data[1].countryCode].join(', ')
                .replace(/(, [A-Z]{2}), US$/, '$1');
              this.settings.celsius = !/AS|BS|BZ|FM|GU|MH|PW|US|VI/i.test(data[1].countryCode);
            }

            this.settingsChecked = true;
            this.updateSettings(this.settings);
          });

        return;
      }
    }

    if (this.sensors.available)
      this.sensors.update(this.settings.celsius);

    let interval = (this.frequent ? 5 : 15);

    if (this.isTimeAccelerated())
      interval *= debugTimeRate;

    const runningLate = (this.lastForecast + interval * 60000 <= now);
    const minuteOffset = (this.frequent ? 0 : this.pollingMinute);
    const millisOffset = (this.frequent || forceRefresh || runningLate ? 0 : this.pollingMillis);

    if (forceRefresh || minute % interval === minuteOffset || runningLate) {
      const doUpdate = () => {
        this.forecast.update(this.settings.latitude, this.settings.longitude, this.settings.celsius, this.settings.userId);
      };

      if (millisOffset === 0)
        doUpdate();
      else
        setTimeout(doUpdate, millisOffset);
    }
  }

  forecastHasBeenUpdated(): void {
    const currentZone = this.forecast.getTimezone();

    if (this.lastTimezone !== currentZone) {
      this.lastTimezone = currentZone;
      this.clock.timezone = currentZone;
      this.ephemeris.update(this.settings.latitude, this.settings.longitude, this.getCurrentTime(), this.lastTimezone, this.settings.amPm);
    }

    this.frequent = this.forecast.getFrequent();
    this.lastForecast = this.getCurrentTime();
  }

  updateSettings(newSettings: Settings): void {
    this.settings = newSettings;
    newSettings.save();
    this.forecast.clearCache();
    this.forecast.showUnknown();
    this.cityLabel.text(newSettings.city);
    this.clock.amPm = newSettings.amPm;
    this.clock.hideSeconds = newSettings.hideSeconds;
    this.ephemeris.hidePlanets = newSettings.hidePlanets;
    this.clock.triggerRefresh();
  }

  updateSunriseAndSunset(rise: string, set: string): void {
    this.updateDimming(this.getCurrentTime(), rise, set);
  }

  updateMarqueeState(isScrolling: boolean) {
    this.clock.hasCompletingAnimation = isScrolling;
  }

  getIndoorOption(): string {
    return this.settings.indoorOption;
  }

  getOutdoorOption(): string {
    return this.settings.outdoorOption;
  }

  updateCurrentTemp(cth: CurrentTemperatureHumidity): void {
    this.currentTempManager.updateCurrentTempAndHumidity(cth, this.settings.celsius);
  }

  private updateDimming(now: number, todayRise: string, todaySet: string): void {
    if (this.settings.dimming) {
      let start = this.settings.dimmingStart;
      let end = this.settings.dimmingEnd;

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
          const time = new KsDateTime(now, this.lastTimezone);
          const currentMinute = time.wallTime.hrs * 60 + time.wallTime.min;

          if ((startMinute > endMinute && (startMinute <= currentMinute || currentMinute < endMinute)) ||
              (startMinute < endMinute && startMinute <= currentMinute && currentMinute < endMinute)) {
            this.dimmer.css('opacity', (this.settings.dimming / 100).toString());
            return;
          }
        }
      }
    }

    this.dimmer.css('opacity', '0');
  }
}
