import { AppService } from './app.service';
/*
  Copyright © 2018-2022 Kerry Shetline, kerry@shetline.com

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

import { Clock } from './clock';
import { CurrentTempManager } from './current-temp-manager';
import { Ephemeris } from './ephemeris';
import { Forecast } from './forecast';
import { HttpTimePoller } from './http-time-poller';
import $ from 'jquery';
import { DateTime, Timezone, parseISODateTime, pollForTimezoneUpdates, zonePollerBrowser } from '@tubular/time';
import { ceil, floor, irandom, sqrt } from '@tubular/math';
import { isBoolean, isEffectivelyFullScreen, isEqual, isFirefox, isObject, setFullScreen } from '@tubular/util';
import { Sensors } from './sensors';
import { apiServer, localServer, raspbianChromium, runningDev, Settings } from './settings';
import { SettingsDialog } from './settings-dialog';
import { AwcDefaults, TimeInfo } from '../server/src/shared-types';
import { reflow, updateSvgFlowItems } from './svg-flow';
import { adjustCityName, anyDialogOpen, ClickishEvent, getJson, stopPropagation } from './awc-util';
import { CurrentTemperatureHumidity, Rect, TimeFormat } from './shared-types';
import { SkyMap } from './sky-map';

pollForTimezoneUpdates(zonePollerBrowser);

const ntpPoller = new HttpTimePoller(apiServer);
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

$.ajaxSetup({
  timeout: 60000
});

class AwClockApp implements AppService {
  private clock: Clock;
  private currentTempManager: CurrentTempManager;
  private forecast: Forecast;
  private ephemeris: Ephemeris;
  private sensors: Sensors;
  private settingsDialog: SettingsDialog;
  private skyMap: SkyMap;

  private body: JQuery;
  private cityLabel: JQuery;
  private clockOverlaySvg: JQuery;
  private dimmer: JQuery;
  private testTime: JQuery;
  private updateAvailable: JQuery;
  private updateCaption: JQuery;

  // Make sure most clients stagger their polling so that the weather server isn't likely
  // to get lots of simultaneous requests.
  private readonly pollingMinute = irandom(0, 14);
  private readonly pollingMillis = irandom(0, 59_999);

  private lastCursorMove = 0;
  private lastForecast = 0;
  private lastTimezone: Timezone;
  private lastHour = -1;
  private frequent = false;
  private proxyStatus: boolean | Promise<boolean> = undefined;
  private adminAllowed = false;
  private showSkyMap = false;
  private showTestTime = false;
  private skyCanvas: HTMLCanvasElement;
  private skyRect: Rect;
  private testTimeValue = '';
  private toggleSkyMapTimer: any;

  private settings = new Settings();
  private settingsChecked = false;

  constructor() {
    this.settings.load();
    AwClockApp.removeDefShadowRoots();

    this.clock = new Clock(this);
    this.clock.timeFormat = this.settings.timeFormat;
    this.clock.hideSeconds = this.settings.hideSeconds;
    this.lastTimezone = this.clock.timezone;

    this.currentTempManager = new CurrentTempManager(this);

    this.forecast = new Forecast(this);
    this.forecast.hourlyForecast = this.settings.hourlyForecast;

    this.ephemeris = new Ephemeris(this);
    this.ephemeris.hidePlanets = this.settings.hidePlanets;

    this.sensors = new Sensors(this);
    this.skyMap = new SkyMap(this);
    this.showSkyMap = this.settings.showSkyMap;

    this.settingsDialog = new SettingsDialog(this);

    this.body = $('body');
    this.cityLabel = $('#city');
    this.dimmer = $('#dimmer');
    setTimeout(() => this.dimmer.css('transition', 'opacity 5s ease-in'));
    this.clockOverlaySvg = $('#clock-overlay-svg');
    this.testTime = $('#test-time');

    $('#clock').on('click', (evt) => stopPropagation(evt, this.clockClick));

    this.updateAvailable = $('#update-available');
    this.updateCaption = $('#update-caption');
    this.updateAvailable.add(this.updateCaption).on('click', () => {
      if (raspbianChromium && this.adminAllowed)
        this.settingsDialog.openSettings(this.settings, true);
    });

    this.cityLabel.text(this.settings.city);

    document.addEventListener('keypress', event => {
      if (!event.repeat && event.target === document.body) {
        if (event.code === 'KeyF' || event.key === 'F' || event.key === 'f')
          setFullScreen(true);
        else if (event.code === 'KeyN' || event.key === 'N' || event.key === 'n')
          setFullScreen(false);
        else if (event.code === 'KeyT' && event.ctrlKey && event.shiftKey) {
          this.showTestTime = !this.showTestTime;
          this.testTime.css('display', this.showTestTime ? 'inline-block' : 'none');

          const updateTestEphemeris = (): void => {
            const time = new DateTime(parseISODateTime(this.testTimeValue), this.lastTimezone).utcTimeMillis;

            this.ephemeris.update(this.settings.latitude, this.settings.longitude, time, this.lastTimezone,
              this.settings.timeFormat === TimeFormat.AMPM);
            this.updateSkyMap(time);
          };

          if (this.showTestTime && !this.testTimeValue) {
            this.testTimeValue = new DateTime(this.getCurrentTime(), this.lastTimezone).toIsoString().substr(0, 16);
            this.testTime.on('input', () => {
              this.testTimeValue = this.testTime.val() as string;
              updateTestEphemeris();
            });
            this.testTime.val(this.testTimeValue);
            updateTestEphemeris();
          }
          else {
            this.updateEphemeris();
            this.updateSkyMap();
          }
        }
      }
    });

    document.addEventListener('mousemove', () => {
      // Reveal cursor when moved.
      this.body.css('cursor', 'auto');
      this.lastCursorMove = performance.now();
    });

    const settingsButton = $('#settings-btn');

    settingsButton.on('click', () => this.settingsDialog.openSettings(this.settings));

    const weatherLogo = $('.weather-logo a');

    // Weather logo is too big a target on a touchscreen compared to the settings button.
    weatherLogo.on('touchstart', function (evt) {
      if (evt.targetTouches?.length > 0) {
        const fromRightEdge = window.screen.width - evt.targetTouches[0].pageX;
        const logoWidth = this.offsetWidth;

        if (fromRightEdge < logoWidth / 3) {
          evt.preventDefault();
          settingsButton.trigger('click');
        }
        else if (fromRightEdge < logoWidth / 2)
          evt.preventDefault();
        // ...else let the touch be a click on the weather logo
      }
      else
        evt.preventDefault();
    });

    weatherLogo.on('click', function (evt) {
      let href: string;

      if (isEffectivelyFullScreen() && window.innerWidth === window.screen.availWidth && (href = $(this).attr('href'))) {
        const TITLE_AND_ADDRESS_HEIGHT = 58;
        const width = window.screen.width * 0.9;
        const height = window.screen.height * 0.9 - TITLE_AND_ADDRESS_HEIGHT;
        const left = (window.screen.width - width) / 2;
        const top = (window.screen.height - height - TITLE_AND_ADDRESS_HEIGHT) / 2;

        evt.preventDefault();
        window.open(href, '_blank', `width=${width},height=${height},left=${left},top=${top},menubar=yes,titlebar=yes`);
      }
    });

    // Firefox doesn't detect clicks on the following SVG elements without this extra help.
    if (isFirefox()) {
      const clickTargets = Array.from(document.getElementsByClassName('ff-click'));

      window.addEventListener('click', evt => {
        const outerRect = document.getElementById('forecast-rect').getBoundingClientRect();
        const x = evt.pageX;
        const y = evt.pageY;

        if (anyDialogOpen() || evt.defaultPrevented ||
            x < outerRect.left || x >= outerRect.right || y < outerRect.top || y >= outerRect.bottom)
          return;

        for (const target of clickTargets) {
          const rect = target.getBoundingClientRect();

          if (rect.left <= x && x < rect.right && rect.top <= y && y < rect.bottom) {
            target.dispatchEvent(new Event('click'));
            break;
          }
        }
      });
    }

    window.addEventListener('resize', this.findSkyMapArea);
  }

  getTimeFormat(): TimeFormat {
    return this.settings.timeFormat;
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

  getWeatherOption(): string {
    return this.settings.service;
  }

  get showConstellations(): boolean { return this.settings.drawConstellations; }

  get showSkyColors(): boolean { return this.settings.showSkyColors; }

  get skyFacing(): number { return this.settings.skyFacing; }

  get timezone(): Timezone { return this.lastTimezone; }

  proxySensorUpdate(): Promise<boolean> {
    if (this.proxyStatus instanceof Promise)
      return this.proxyStatus;
    else if (isBoolean(this.proxyStatus))
      return Promise.resolve(this.proxyStatus);

    this.proxyStatus = new Promise(resolve => $.ajax({
      url: '/wireless-th',
      dataType: 'json',
      success: data => {
        (this.proxyStatus as Promise<boolean>).then(() => this.clock.triggerRefresh());
        resolve(this.proxyStatus = isObject(data) && data?.error !== 'n/a');
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

    if (isDead != null) {
      sensorDeadAirState = isDead;

      if (wasDead !== isDead)
        setTimeout(() => this.forecast.refreshAlerts());
    }

    return sensorDeadAirState;
  }

  getApiServer(): string {
    return apiServer;
  }

  isTimeAccelerated(): boolean {
    return (!!debugTime && debugTimeRate > 1);
  }

  start(): void {
    this.clock.start();
    this.findSkyMapArea();

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

    if (!this.showTestTime) {
      this.ephemeris.update(this.settings.latitude, this.settings.longitude, now, this.lastTimezone,
        this.settings.timeFormat === TimeFormat.AMPM);
      this.updateSkyMap();
    }

    // If it's a new day, make sure we update the weather display to show the change of day,
    // even if we aren't polling for new weather data right now.
    if (hour < this.lastHour || (hour === 0 && minute === 0))
      this.forecast.refreshFromCache();

    this.lastHour = hour;
    this.updateWeather(minute, now, forceRefresh);
  }

  private updateSkyMap(time?: number): void {
    this.adjustHandsDisplay();

    if (this.showSkyMap && this.skyCanvas)
      this.skyMap.draw(this.skyCanvas, this.settings.longitude, this.settings.latitude, time);
  }

  resetGpsState(): void {
    ntpPoller.resetGpsState();
  }

  private updateWeather(minute: number, now: number, forceRefresh: boolean): void {
    if (!this.settingsChecked) {
      if (this.settings.defaultsSet())
        this.settingsChecked = true;
      else {
        const promises = [
          getJson<AwcDefaults>(`${apiServer}/defaults`),
          getJson<any>('http://ip-api.com/json/')
        ];

        Promise.allSettled(promises)
          .then(dataPairs => {
            const data = dataPairs.map(item => item.status === 'rejected' ? null : item.value);
            const localInstallation = raspbianChromium && (localServer || runningDev);
            let citySet = false;
            let countryCode = '';
            const showUpdate = (localInstallation && this.adminAllowed && data[0]?.updateAvailable ? 'block' : 'none');

            this.adminAllowed = data[0]?.allowAdmin;
            this.updateAvailable.css('display', showUpdate);
            this.updateCaption.css('display', showUpdate);

            if (data[0]?.indoorOption && data[0].outdoorOption) {
              this.settings.indoorOption = data[0].indoorOption;
              this.settings.outdoorOption = data[0].outdoorOption;

              if (data[0].latitude != null) {
                this.settings.latitude = data[0].latitude;
                this.settings.longitude = data[0].longitude;
                this.settings.city = data[0].city;
                citySet = !!this.settings.city;
                countryCode = (/,\s+([A-Z]{2,3})$/.exec(this.settings.city) || [])[1];
              }
            }

            if (data[1]?.status === 'success' && !citySet) {
              this.settings.latitude = data[1].lat;
              this.settings.longitude = data[1].lon;
              this.settings.city = [data[1].city, data[1].region, data[1].countryCode].join(', ');
              countryCode = data[1].countryCode;
            }

            if (countryCode)
              this.settings.celsius = !/^(ASM?|BH?S|BL?Z|FS?M|GUM?|MHL?|PL?W|USA?|VIR?)$/i.test(data[1].countryCode);

            this.settings.city = adjustCityName(this.settings.city);
            this.settingsChecked = true;
            this.updateSettings(this.settings);
          });

        return;
      }
    }

    if (this.sensors.available)
      this.sensors.update(this.settings.celsius);

    let interval = (this.forecast.hasGoodData ? (this.frequent ? 5 : 15) : 1);

    if (this.isTimeAccelerated())
      interval *= debugTimeRate;

    const runningLate = (this.lastForecast + (interval + 2) * 60000 <= now);
    const minuteOffset = (this.frequent || !this.forecast.hasGoodData ? 0 : this.pollingMinute);
    const millisOffset = (this.frequent || forceRefresh || runningLate ? 0 : this.pollingMillis);

    if (forceRefresh || minute % interval === minuteOffset || runningLate) {
      if (runningLate)
        this.lastForecast = now; // Pretend we've got something now so runningLate isn't true again until the next delay or failure.

      const doUpdate = (): void => {
        getJson<AwcDefaults>(`${apiServer}/defaults`).then(data => {
          this.adminAllowed = data?.allowAdmin;
          const updateAvailable = (this.adminAllowed && data?.updateAvailable ? 'block' : 'none');
          this.updateAvailable.css('display', updateAvailable);
          this.updateCaption.css('display', updateAvailable);
        });

        this.forecast.update(this.settings.latitude, this.settings.longitude, this.settings.celsius, this.settings.knots,
          this.settings.userId);
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
      this.updateEphemeris();
    }

    this.frequent = this.forecast.getFrequent();
    this.lastForecast = this.getCurrentTime();
  }

  updateSettings(newSettings: Settings): void {
    const oldSettings = this.settings;

    this.settings = newSettings;
    newSettings.save();

    this.cityLabel.text(newSettings.city);
    this.forecast.hourlyForecast = newSettings.hourlyForecast;
    this.clock.timeFormat = newSettings.timeFormat;
    this.clock.hideSeconds = newSettings.hideSeconds;
    this.ephemeris.hidePlanets = newSettings.hidePlanets;

    if (this.settings.requiresWeatherReload(oldSettings)) {
      this.currentTempManager.swapTemperatureUnits(this.settings.celsius);
      this.forecast.clearCache();
      this.forecast.showUnknown();
      this.clock.triggerRefresh();
    }
    else {
      let doRefresh = (this.settings.knots !== oldSettings.knots);

      if (this.settings.celsius !== oldSettings.celsius) {
        this.currentTempManager.swapTemperatureUnits(this.settings.celsius);
        this.forecast.swapUnits(this.settings.celsius, this.settings.knots);
        doRefresh = true;
      }

      if (this.sensors.available &&
          (this.settings.indoorOption !== oldSettings.indoorOption || this.settings.outdoorOption !== oldSettings.outdoorOption)) {
        this.sensors.update(this.settings.celsius);
        doRefresh = true;
      }

      if (this.settings.background !== oldSettings.background)
        this.forecast.refreshAlerts();

      if (doRefresh)
        this.clock.triggerRefresh();
      else {
        this.forecast.refreshFromCache();
        this.updateEphemeris();
      }
    }

    if (!isEqual(this.settings.showSkyMap, oldSettings.showSkyMap) ||
        !isEqual(this.settings.showSkyColors, oldSettings.showSkyColors) ||
        !isEqual(this.settings.drawConstellations, oldSettings.drawConstellations) ||
        !isEqual(this.settings.skyFacing, oldSettings.skyFacing) ||
        !isEqual(this.settings.floatHands, oldSettings.floatHands)) {
      if (this.showSkyMap !== this.settings.showSkyMap)
        this.toggleSkyMap();
      else {
        if (this.toggleSkyMapTimer) {
          clearTimeout(this.toggleSkyMapTimer);
          this.toggleSkyMapTimer = undefined;
        }

        this.updateSkyMap();
      }
    }
  }

  private updateEphemeris(): void {
    this.ephemeris.update(this.settings.latitude, this.settings.longitude, this.getCurrentTime(), this.lastTimezone,
      this.settings.timeFormat === TimeFormat.AMPM);
  }

  updateSunriseAndSunset(rise: string, set: string): void {
    this.updateDimming(this.getCurrentTime(), rise, set);
  }

  updateMarqueeState(isScrolling: boolean): void {
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
          const time = new DateTime(now, this.lastTimezone);
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

  toggleSunMoon(): void {
    this.ephemeris.toggleSunMoon();
  }

  findSkyMapArea = (): void => {
    const mapArea = document.getElementById('face') as unknown as SVGElement;
    const rect = mapArea?.getClientRects()[0] ?? mapArea.getBoundingClientRect();

    if (rect) {
      const skyRect = { x: floor(rect.x), y: floor(rect.y), h: ceil(rect.height), w: ceil(rect.width) };

      if (!isEqual(this.skyRect, skyRect)) {
        this.skyRect = skyRect;

        if (this.skyCanvas)
          this.skyCanvas.remove();

        const canvasScaling = window.devicePixelRatio || 1;
        const canvas = (this.skyCanvas = document.createElement('canvas'));
        const width = ceil(skyRect.w * canvasScaling);
        const height = ceil(skyRect.w * canvasScaling);

        canvas.classList.add('sky-map');
        canvas.width = ceil(width);
        canvas.height = ceil(height);
        canvas.style.top = skyRect.y + 'px';
        canvas.style.left = skyRect.x + 'px';
        canvas.style.width = skyRect.w + 'px';
        canvas.style.height = skyRect.w + 'px';
        canvas.style.opacity = this.showSkyMap ? '1' : '0';

        document.body.append(canvas);
        canvas.addEventListener('click', (evt) => stopPropagation(evt, this.skyClick));
        this.updateSkyMap();
      }
    }
  }

  private skyClick = (evt: ClickishEvent): void => {
    this.toggleSkyMap(evt, 2);
  }

  private clockClick = (evt: ClickishEvent): void => {
    if ((evt.target as Element).id === 'face')
      this.toggleSkyMap(evt, 3);
  }

  private toggleSkyMap(evt?: ClickishEvent, diameterDivider = 0): void {
    if (evt && diameterDivider > 0) {
      const r = (evt.target as Element).getBoundingClientRect();
      const x = evt.pageX - r.left - r.width / 2;
      const y = evt.pageY - r.top - r.height / 2;

      if (sqrt(x ** 2 + y ** 2) > r.height / diameterDivider)
        return;
    }

    if (this.toggleSkyMapTimer) {
      clearTimeout(this.toggleSkyMapTimer);
      this.toggleSkyMapTimer = undefined;
    }

    if (this.showSkyMap) {
      this.showSkyMap = false;
      this.skyCanvas.style.pointerEvents = 'none';
      this.skyCanvas.style.opacity = '0';
      this.adjustHandsDisplay();
    }
    else {
      this.showSkyMap = true;
      this.skyCanvas.style.pointerEvents = 'all';
      this.skyCanvas.style.opacity = '1';
      this.updateSkyMap();
    }

    if (this.showSkyMap !== this.settings.showSkyMap)
      this.toggleSkyMapTimer = setTimeout(() => this.toggleSkyMap(), 60000);
  }

  private adjustHandsDisplay(): void {
    if (this.settings.floatHands && this.showSkyMap) {
      this.clockOverlaySvg.addClass('float');
      this.clockOverlaySvg.css('opacity', '1');
    }
    else {
      this.clockOverlaySvg.removeClass('float');
      this.clockOverlaySvg.css('opacity', this.showSkyMap ? '0' : '1');
    }
  }

  private static removeDefShadowRoots(): void {
    const signalMeter = $('#signal-meter');
    const days = $('#forecast-day');
    let markup = signalMeter.html();
    let uses = $('use[href="#signal-meter"]');

    uses.parent().html(markup);

    uses = $('use[href="#forecast-day"]');
    uses.each(function () {
      const id = this.parentElement.id;

      markup = days.html().replace(/dayN/g, id);

      if (id === 'day0')
        markup = markup.replace('---', 'Today');
      else if (id === 'day1')
        markup = markup.replace('>---', ' transform="scale(0.88, 1) translate(0.75, 0)">Tomorrow');

      this.parentElement.innerHTML = markup;
    });
  }
}
