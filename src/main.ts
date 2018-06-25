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

import * as $ from 'jquery';
import { initTimeZoneSmall } from 'ks-date-time-zone/dist/ks-timezone-small';
import { Clock } from './clock';
import { AppService } from './app.service';
import { Forecast } from './forecast';
import { KsDateTime, KsTimeZone } from 'ks-date-time-zone';
import { isIE, setFullScreen } from './util';
import { Settings } from './settings';
import { SettingsDialog } from './settings-dialog';
import { Ephemeris } from './ephemeris';
import { Indoor } from './indoor';

initTimeZoneSmall();

const baseTime = Date.now();
const debugTime = 0; // +new Date(2018, 5, 25, 5, 8, 40, 0);

function parseTime(s: string): number {
  const parts = s.split(':');

  return Number(parts[0]) * 60 + Number(parts[1]);
}

$(() => {
  new AwClockApp().start();
});

export class AwClockApp implements AppService {
  private clock: Clock;
  private forecast: Forecast;
  private ephemeris: Ephemeris;
  private indoor: Indoor;
  private settingsDialog: SettingsDialog;

  private body: JQuery;
  private cityLabel: JQuery;
  private dimmer: JQuery;

  // Make sure most clients stagger their polling so that the weather server isn't likely
  // to get lots of simultaneous requests.
  private readonly pollingMinute = Math.floor(Math.random() * 15);
  private readonly pollingMillis = Math.floor(Math.random() * 60000);

  private lastCursorMove = 0;
  private lastForecast = 0;
  private lastTimezone = KsTimeZone.OS_ZONE;
  private lastHour = -1;
  private frequent = false;

  private settings = new Settings();

  constructor() {
    this.settings.load();

    this.clock = new Clock(this);
    this.clock.amPm = this.settings.amPm;
    this.clock.hideSeconds = this.settings.hideSeconds;

    this.forecast = new Forecast(this);

    this.ephemeris = new Ephemeris(this);
    this.ephemeris.hidePlanets = this.settings.hidePlanets;

    this.indoor = new Indoor();

    this.settingsDialog = new SettingsDialog(this);

    this.body = $('body');
    this.cityLabel = $('#city');
    this.dimmer = $('#dimmer');

    if (isIE())
      $('#clock-container').addClass('clock-container-ie-fix');

    this.cityLabel.text(this.settings.city);

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
      this.body.css('cursor', 'auto');
      this.lastCursorMove = performance.now();
    });

    $('#settings-btn').on('click', () => this.settingsDialog.openSettings(this.settings));
  }

  getCurrentTime(): number {
    if (debugTime)
      return debugTime + Date.now() - baseTime;
    else
      return Date.now();
  }

  public start() {
    this.clock.start();
  }

  public updateTime(hour: number, minute: number, forceRefresh: boolean): void {
    const now = this.getCurrentTime();

    // Hide cursor if it hasn't been moved in the last two minutes.
    if (performance.now() > this.lastCursorMove + 120000)
      this.body.css('cursor', 'none');

    this.ephemeris.update(this.settings.latitude, this.settings.longitude, now, this.lastTimezone, this.settings.amPm);

    // If it's a new day, make sure we update the weather display to show the change of day,
    // even if we aren't polling for new weather data right now.
    if (hour < this.lastHour || hour === 0 && minute === 0)
      this.forecast.refreshForecastFromCache();

    if (this.indoor.available)
      this.indoor.update(this.settings.celsius);

    this.lastHour = hour;

    const interval = (this.frequent ? 5 : 15);
    const runningLate = (this.lastForecast + interval * 60000 <= now);
    const minuteOffset = (this.frequent ? 0 : this.pollingMinute);
    const millisOffset = (this.frequent || forceRefresh || runningLate ? 0 : this.pollingMillis);

    if (forceRefresh || minute % interval === minuteOffset || runningLate) {
      const doUpdate = () => {
        this.forecast.update(this.settings.latitude, this.settings.longitude, this.settings.celsius,
                             this.settings.amPm, this.settings.userId);
      };

      if (millisOffset === 0)
        doUpdate();
      else
        setTimeout(doUpdate, millisOffset);
    }
  }

  public forecastHasBeenUpdated(): void {
    const currentZone = this.forecast.getTimezone();

    if (this.lastTimezone !== currentZone) {
      this.lastTimezone = currentZone;
      this.clock.timezone = currentZone;
      this.ephemeris.update(this.settings.latitude, this.settings.longitude, this.getCurrentTime(), this.lastTimezone, this.settings.amPm);
    }

    this.frequent = this.forecast.getFrequent();
    this.lastForecast = this.getCurrentTime();
  }

  public updateSettings(newSettings: Settings): void {
    this.settings = newSettings;
    newSettings.save();
    this.forecast.showUnknown();
    this.cityLabel.text(newSettings.city);
    this.clock.amPm = newSettings.amPm;
    this.clock.hideSeconds = newSettings.hideSeconds;
    // this.ephemeris.hidePlanets = newSettings.hidePlanets;
    this.clock.triggerRefresh();
  }

  public updateSunriseAndSunset(rise: string, set: string): void {
    this.updateDimming(this.getCurrentTime(), rise, set);
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
