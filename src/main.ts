import { AppService } from './app.service';
/*
  Copyright © 2018-2023 Kerry Shetline, kerry@shetline.com

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
import { abs, ceil, floor, irandom, max, min, sqrt } from '@tubular/math';
import { eventToKey, isBoolean, isEffectivelyFullScreen, isEqual, isFirefox, isObject, processMillis, setFullScreen } from '@tubular/util';
import { Sensors } from './sensors';
import { AlertFilter, allowAdminFeatures, apiServer, HiddenAlert, localServer, runningDev, Settings } from './settings';
import { SettingsDialog } from './settings-dialog';
import { AwcDefaults, TimeInfo } from '../server/src/shared-types';
import { reflow, updateSvgFlowItems } from './svg-flow';
import { adjustCityName, anyDialogOpen, ClickishEvent, domConfirm, getJson, stopPropagation } from './awc-util';
import { CurrentTemperatureHumidity, Rect, TimeFormat } from './shared-types';
import { SkyMap } from './sky-map';
import { AlarmMonitor } from './alarm-monitor';

pollForTimezoneUpdates(zonePollerBrowser);

const ntpPoller = new HttpTimePoller(apiServer);
const baseTime = ntpPoller.getTimeInfo().time;
const debugTime = 0; // +new Date(2018, 6, 2, 22, 30, 0, 0);
const debugTimeRate = 60;
let sensorDeadAirState = false;

const MOUSE_DOWN_BRIGHTEN_TIME = 30_000; // 30 seconds

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
  private alarmMonitor: AlarmMonitor;
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
  private readonly testTime: JQuery;
  private planetOverlaySvg: JQuery;
  private updateAvailable: JQuery;
  private updateCaption: JQuery;

  // Make sure most clients stagger their polling so that the weather server isn't likely
  // to get lots of simultaneous requests.
  private readonly pollingMinute = irandom(0, 14);
  private readonly pollingMillis = irandom(0, 59_999);

  private adminAllowed = false;
  private frequent = false;
  private lastCursorMove = 0;
  private lastForecast = 0;
  private lastHour = -1;
  private lastHumidity: number;
  private lastMouseDown = Number.MIN_SAFE_INTEGER;
  private lastMouseDownTimer: any;
  private lastRiseTime: string;
  private lastSetTime: string;
  private lastTemp: number;
  private lastTimezone: Timezone;
  private latestDefaults: AwcDefaults;
  private proxyStatus: boolean | Promise<boolean> = undefined;
  private runTestTime = false;
  private settings = new Settings();
  private settingsChecked = false;
  private showSkyMap = false;
  private showTestTime = false;
  private skyCanvas: HTMLCanvasElement;
  private skyRect: Rect;
  private testTimeValue: number | undefined = undefined;
  private testTimeStr = '';
  private timeDelta = 0;
  private toggleSkyMapTimer: any;

  constructor() {
    this.settings.load();
    AwClockApp.removeDefShadowRoots();

    this.alarmMonitor = new AlarmMonitor(this);

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
    this.planetOverlaySvg = $('#planet-overlay-svg');
    this.testTime = $('#test-time');

    $('#clock').on('click', evt => stopPropagation(evt, this.clockClick));

    this.updateAvailable = $('#update-available');
    this.updateCaption = $('#update-caption');
    this.updateAvailable.add(this.updateCaption).on('click', () => {
      if (allowAdminFeatures && this.adminAllowed) {
        this.alarmMonitor.stopAlarms();
        this.settingsDialog.openSettings(this.settings, true);
      }
    });

    this.cityLabel.text(this.settings.city);

    document.addEventListener('keypress', this.keyHandler);
    document.addEventListener('mousemove', () => {
      // Reveal cursor when moved.
      this.body.css('cursor', 'auto');
      this.lastCursorMove = performance.now();
    });
    this.testTime[0].addEventListener('keydown', evt => {
      // Tracking to make time roll forward with up-arrow minute, rather than wrapping back to the beginning of the hour.
      const key = eventToKey(evt);

      if (key === 'ArrowUp' && evt.shiftKey)
        this.timeDelta = 1;
      else if (key === 'ArrowDown' && evt.shiftKey)
        this.timeDelta = -1;
      else
        this.timeDelta = 0;
    });
    this.testTime[0].addEventListener('keypress', (evt) => this.keyHandler(evt, true));

    const settingsButton = $('#settings-btn');

    settingsButton.on('click', () => {
      this.alarmMonitor.stopAlarms();
      this.settingsDialog.openSettings(this.settings);
    });

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
        // ...else let the touch be a click on the weather logo
      }
      else
        evt.preventDefault();
    });

    const self = this;

    weatherLogo.on('click', function (evt) {
      let href: string;

      evt.preventDefault();
      domConfirm('Open weather service page, or settings dialog?', { okText: 'Weather Service', cancelText: 'Settings' }, doWeather => {
        if (doWeather && (href = $(this).attr('href'))) {
          if (isEffectivelyFullScreen() && window.innerWidth === window.screen.availWidth) {
            const TITLE_AND_ADDRESS_HEIGHT = 58;
            const width = window.screen.width * 0.9;
            const height = window.screen.height * 0.9 - TITLE_AND_ADDRESS_HEIGHT;
            const left = (window.screen.width - width) / 2;
            const top = (window.screen.height - height - TITLE_AND_ADDRESS_HEIGHT) / 2;

            window.open(href, '_blank', `width=${width},height=${height},left=${left},top=${top},menubar=yes,titlebar=yes`);
          }
          else
            window.open(href, '_blank');
        }
        else
          self.settingsDialog.openSettings(self.settings);
      });
    });

    // Firefox doesn't detect clicks on the following SVG elements without this extra help.
    if (isFirefox()) {
      document.body.classList.add('firefox-mods');

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

    window.addEventListener('mousedown', () => {
      if (this.lastRiseTime) {
        this.lastMouseDown = processMillis();
        this.dimmer.css('transition-duration', '500ms');
        this.updateDimming(this.getCurrentTime(), this.lastRiseTime, this.lastSetTime);

        if (this.lastMouseDownTimer)
          clearTimeout(this.lastMouseDownTimer);

        this.lastMouseDownTimer = setTimeout(() => {
          this.lastMouseDownTimer = undefined;
          setTimeout(() => this.dimmer.css('transition-duration', '5s'), 750);
          this.updateDimming(this.getCurrentTime(), this.lastRiseTime, this.lastSetTime);
        }, MOUSE_DOWN_BRIGHTEN_TIME);
      }
    });

    window.addEventListener('resize', this.findSkyMapArea);
  }

  getTimeFormat(): TimeFormat {
    return this.settings.timeFormat;
  }

  getAlarmTime(): number {
    return this.testTimeValue ?? this.getCurrentTime(0);
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

  getAirQualityOption(): string {
    return this.settings.airQuality;
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
    if (this.showTestTime && this.testTimeStr) {
      let testTime = new DateTime(parseISODateTime(this.testTimeStr), this.lastTimezone).utcTimeMillis;

      if (this.runTestTime) {
        testTime += 60000;
        this.testTimeValue = testTime;
        this.testTimeStr = new DateTime(testTime, this.lastTimezone).toIsoString(16);
        this.testTime.val(this.testTimeStr);
        this.updateTestTime();
      }
    }
    else
      this.settings.alarms = this.alarmMonitor.checkAlarms(this.getCurrentTime(), this.settings.alarms);

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
            const localInstallation = allowAdminFeatures && (localServer || runningDev);
            let citySet = false;
            let countryCode = '';
            const showUpdate = (localInstallation && this.adminAllowed && data[0]?.updateAvailable &&
              data[0].latestVersion !== (this.settings.updateToHide || '_') ? 'block' : 'none');

            if (data[0])
              this.latestDefaults = Object.freeze(data[0]);

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
          }).catch(err => console.error('Default set-up failed:', err));

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
          this.latestDefaults = Object.freeze(data);
          this.adminAllowed = data?.allowAdmin;
          const updateAvailable = (this.adminAllowed && data?.latestVersion !== (this.settings.updateToHide || '_') &&
            data?.updateAvailable ? 'block' : 'none');
          this.updateAvailable.css('display', updateAvailable);
          this.updateCaption.css('display', updateAvailable);
        }).catch(err => console.error('Update check failed:', err));

        this.forecast.update(this.settings.latitude, this.settings.longitude, this.settings.celsius, this.settings.knots,
          this.settings.userId);
      };

      if (millisOffset === 0)
        doUpdate();
      else
        setTimeout(doUpdate, millisOffset);
    }
  }

  forecastHasBeenUpdated(lastTemp?: number, lastHumidity?: number): void {
    const currentZone = this.forecast.getTimezone();

    if (this.lastTimezone !== currentZone) {
      this.lastTimezone = currentZone;
      this.clock.timezone = currentZone;
      this.updateEphemeris();
    }

    this.frequent = this.forecast.getFrequent();
    this.lastForecast = this.getCurrentTime();
    this.lastTemp = lastTemp;
    this.lastHumidity = lastHumidity;
  }

  getLastTAndH(): [number, number] {
    return [this.lastTemp, this.lastHumidity];
  }

  updateSettings(newSettings = this.settings): void {
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

    if (!isEqual(newSettings.showSkyMap, oldSettings.showSkyMap) ||
        !isEqual(newSettings.showSkyColors, oldSettings.showSkyColors) ||
        !isEqual(newSettings.drawConstellations, oldSettings.drawConstellations) ||
        !isEqual(newSettings.skyFacing, oldSettings.skyFacing) ||
        !isEqual(newSettings.floatHands, oldSettings.floatHands)) {
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

    const updateAvailable = (this.adminAllowed && this.latestDefaults?.latestVersion !== (this.settings.updateToHide || '_') &&
            this.latestDefaults?.updateAvailable ? 'block' : 'none');

    this.updateAvailable.css('display', updateAvailable);
    this.updateCaption.css('display', updateAvailable);
    this.alarmMonitor.checkAlarms(this.getCurrentTime(), this.settings.alarms);
  }

  private updateEphemeris(): void {
    this.ephemeris.update(this.settings.latitude, this.settings.longitude, this.getCurrentTime(), this.lastTimezone,
      this.settings.timeFormat === TimeFormat.AMPM);
  }

  updateSunriseAndSunset(rise: string, set: string): void {
    this.updateDimming(this.getCurrentTime(), rise, set);
  }

  updateMarqueeState(isScrolling: boolean): void {
    this.clock.hasCompetingAnimation = isScrolling;
  }

  getAlertFilters(): AlertFilter[] {
    return this.settings.alertFilters || [];
  }

  getHiddenAlerts(): HiddenAlert[] {
    return this.settings.hiddenAlerts || [];
  }

  updateHiddenAlerts(hidden: HiddenAlert[]): void {
    this.settings.hiddenAlerts = hidden || [];
  }

  getIndoorOption(): string {
    return this.settings.indoorOption;
  }

  getLatestDefaults(): AwcDefaults {
    return this.latestDefaults;
  }

  getOutdoorOption(): string {
    return this.settings.outdoorOption;
  }

  updateCurrentTemp(cth: CurrentTemperatureHumidity): void {
    this.currentTempManager.updateCurrentTempAndHumidity(cth, this.settings.celsius);
  }

  private updateDimming(now: number, todayRise: string, todaySet: string): void {
    const procNow = processMillis();

    this.lastRiseTime = todayRise;
    this.lastSetTime = todaySet;

    if (this.settings.dimming && procNow > this.lastMouseDown + MOUSE_DOWN_BRIGHTEN_TIME) {
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

    $('#current-alarm-display').css('font-size', min(max(window.innerWidth / 10, 20), 100) + '%');

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
        canvas.addEventListener('click', evt => stopPropagation(evt, this.skyClick));
        this.updateSkyMap();
      }
    }
  };

  private skyClick = (evt: ClickishEvent): void => {
    this.toggleSkyMap(evt, 2);
  };

  private clockClick = (evt: ClickishEvent): void => {
    if ((evt.target as Element).id === 'face')
      this.toggleSkyMap(evt, 3);
  };

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
      this.planetOverlaySvg.css('opacity', '1');
      this.updateSkyMap();
    }

    if (this.showSkyMap !== this.settings.showSkyMap)
      this.toggleSkyMapTimer = setTimeout(() => this.toggleSkyMap(), 60000);
  }

  private adjustHandsDisplay(): void {
    if (this.settings.floatHands !== 'N' && this.showSkyMap) {
      this.clockOverlaySvg.addClass('float');

      if (this.settings.floatHands === 'S')
        this.clockOverlaySvg.addClass('solid');
      else
        this.clockOverlaySvg.removeClass('solid');

      this.clockOverlaySvg.css('opacity', '1');
      this.planetOverlaySvg.css('opacity', '0');
    }
    else {
      this.clockOverlaySvg.removeClass('float');
      this.clockOverlaySvg.removeClass('solid');
      this.clockOverlaySvg.css('opacity', this.showSkyMap ? '0' : '1');
      this.planetOverlaySvg.css('opacity', this.showSkyMap ? '0' : '1');
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

  private keyHandler = (evt: KeyboardEvent, skipTargetTest = false): void => {
    const key = eventToKey(evt);

    if (!evt.repeat && (skipTargetTest || evt.target === document.body)) {
      let handled = true;
      const isTestTime = ((evt.target as any)?.id === 'test-time');

      if (key === 'F' || evt.key === 'f')
        setFullScreen(true);
      else if (key === 'N' || key === 'n')
        setFullScreen(false);
      else if (key === 'Enter' || key === ' ')
        this.alarmMonitor.stopAlarms();
      else if (key === '5' && !isTestTime)
        this.alarmMonitor.snoozeAlarms(5);
      else if ((key === '0' && !isTestTime) || key === 'S' || key === 's')
        this.alarmMonitor.snoozeAlarms(10);
      else if (key === '.')
        this.alarmMonitor.snoozeAlarms(15);
      else if (key === 'T' && evt.ctrlKey && evt.shiftKey)
        this.toggleTestTimeInput();
      else if (key === 'R' || key === 'r') {
        this.runTestTime = !this.runTestTime;
        this.testTime.prop('disabled', this.runTestTime);
      }
      else if ((key === 'C' || key === 'c') && this.testTimeStr) {
        this.testTimeValue = this.getCurrentTime();
        this.testTimeStr = new DateTime(this.testTimeValue, this.lastTimezone).toIsoString(16);
        this.testTime.val(this.testTimeStr);
        this.updateTestTime();
      }
      else if ((key === 'X' || key === 'x') && this.testTimeStr) {
        this.alarmMonitor.resetAlarmState();
        this.updateTestTime();
      }
      else
        handled = false;

      if (handled)
        evt.stopPropagation();
    }
  };

  private toggleTestTimeInput(): void {
    this.showTestTime = !this.showTestTime;
    this.runTestTime = false;
    this.testTime.prop('disabled', false);
    this.testTime.css('display', this.showTestTime ? 'inline-block' : 'none');

    if (this.showTestTime && !this.testTimeStr)
      this.testTime.on('input', this.timeInputHandler);

    if (this.showTestTime) {
      if (this.testTimeValue == null) {
        this.testTimeValue = this.getCurrentTime();
        this.testTimeStr = new DateTime(this.testTimeValue, this.lastTimezone).toIsoString(16);
      }

      this.testTime.val(this.testTimeStr);
      this.timeDelta = 0;
      this.updateTestTime();
    }
    else {
      this.testTimeValue = undefined;
      this.updateEphemeris();
      this.updateSkyMap();
    }
  }

  private updateTestTime(): void {
    this.testTimeValue = new DateTime(parseISODateTime(this.testTimeStr), this.lastTimezone).utcTimeMillis;

    this.ephemeris.update(this.settings.latitude, this.settings.longitude, this.testTimeValue, this.lastTimezone,
      this.settings.timeFormat === TimeFormat.AMPM);
    this.updateSkyMap(this.testTimeValue);
    this.alarmMonitor.checkAlarms(this.testTimeValue, this.settings.alarms);
  }

  private timeInputHandler = (): void => {
    let newTimeStr = this.testTime.val() as string;

    if ((this.timeDelta > 0 && newTimeStr < this.testTimeStr) || (this.timeDelta < 0 && newTimeStr > this.testTimeStr)) {
      let newTime = new DateTime(newTimeStr, this.lastTimezone).utcTimeMillis;

      if (abs(newTime - this.testTimeValue) < 3_600_000)
        newTime = this.testTimeValue + this.timeDelta * 60000;
      else if (abs(newTime - this.testTimeValue) < 86_400_000)
        newTime = this.testTimeValue + this.timeDelta * 3_600_000;
      else {
        const testDate = new DateTime(this.testTimeValue, this.lastTimezone);
        const monthLength = testDate.getDaysInMonth() * 86_400_000;

        if (abs(newTime - this.testTimeValue) < monthLength)
          newTime = testDate.add('day', this.timeDelta).utcTimeMillis;
        else
          newTime = testDate.add('month', this.timeDelta).utcTimeMillis;
      }

      newTimeStr = new DateTime(newTime, this.lastTimezone).toIsoString(16);
      this.testTime.val(newTimeStr);
    }

    this.testTimeStr = newTimeStr;
    this.updateTestTime();
  };
}
