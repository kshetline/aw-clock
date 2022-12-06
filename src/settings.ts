import { HourlyForecast, TimeFormat } from './shared-types';
import $ from 'jquery';
import Cookies from 'js-cookie';
import { forEach, isChromium, isRaspbian, toBoolean, toNumber } from '@tubular/util';
import { parseJson } from './awc-util';

const docPort = location.port;

export const runningDev = (docPort === '3000' || docPort === '4200');
export const localServer = (docPort && docPort !== '80' && docPort !== '443');
export const demoServer = /\bshetline\.com\b/.test(location.host) || true;
export const updateTest = toBoolean(new URLSearchParams(location.search).get('ut'), false, true);

const apiParam = new URLSearchParams(location.search).get('api');
const apiPort = apiParam || (runningDev ? (docPort === '3000' ? '3002' : '4201') : docPort || '8080');
const apiHost = ((location.hostname || '').startsWith('192.') ? location.hostname : 'localhost');

// noinspection HttpUrlsUsage
export const apiServer = new URL(location.href).searchParams.get('weather_server') ||
  (runningDev ? `http://${apiHost}:${apiPort}` : '');
export const raspbianChromium = (isRaspbian() && isChromium()) || runningDev;
export const runningLocally = runningDev || (location.hostname || '').match(/\b(localhost|127\.0\.0\.0)\b/);
export const allowAdminFeatures = raspbianChromium || runningLocally;

export function toTimeFormat(s: string, deflt = TimeFormat.UTC): TimeFormat {
  s = (s || '').toLowerCase();

  return s.startsWith('a') || s === 'true' ? TimeFormat.AMPM :
    (s.startsWith('u') ? TimeFormat.UTC :
      (s.includes('2') || s === 'false' ? TimeFormat.HR24 : deflt));
}

export class AlarmInfo {
  days?: string;
  enabled: boolean;
  message: string;
  sound: string;
  time: number;
}

export class RecentLocation {
  city: string;
  latitude: number;
  longitude: number;
}

export enum AlertFilterType { DOWNGRADE, HIDE }

export interface AlertFilter {
  checkDescription: boolean;
  content: string;
  type: AlertFilterType;
}

export interface HiddenAlert {
  expires: number;
  id: string;
}

export const MAX_RECENT_LOCATIONS = 5;

export class Settings {
  alarmDisableDuration = 0;
  alarmDisableStartTime = 0;
  alarms: AlarmInfo[] = [];
  alertFilters: AlertFilter[] = [];
  background = '#191970';
  celsius = false;
  city = 'New York, NY';
  clockFace = '#000000';
  dimming = 0;
  dimmingEnd = '7:00';
  dimmingStart = '23:00';
  drawConstellations = true;
  floatHands = 'T';
  hiddenAlerts: HiddenAlert[] = [];
  hidePlanets = false;
  hideSeconds = false;
  hourlyForecast = HourlyForecast.VERTICAL;
  indoorOption = localServer ? 'D' : 'X';
  knots = false;
  latitude = 40.75;
  longitude = -73.99;
  onscreenKB = false;
  outdoorOption = 'F';
  recentLocations: RecentLocation[] = [];
  service = '';
  showSkyColors = true;
  showSkyMap = false;
  skyFacing = 0;
  timeFormat = /[a-z]/i.test(new Date().toLocaleTimeString()) ? TimeFormat.AMPM : TimeFormat.UTC;
  updateToHide = '';
  userId = '';

  public defaultsSet(): boolean {
    return !!localStorage.getItem('aw-clock-settings') || !!(Cookies.get('indoor') || Cookies.get('outdoor') || Cookies.get('city'));
  }

  public load(): void {
    let saved: any;

    try {
      saved = JSON.parse(localStorage.getItem('aw-clock-settings'));
    }
    catch {}

    if (saved) {
      const _this = this as any;

      forEach(_this, key => {
        if (_this[key] != null)
          _this[key] = saved[key] ?? defaultSettings[key];
      });
    }
    else if (Cookies.get('latitude')) {
      this.alarmDisableDuration = Number(Cookies.get('alarm_disable_duration')) || defaultSettings.alarmDisableDuration;
      this.alarmDisableStartTime = Number(Cookies.get('alarm_disable_start_time')) || defaultSettings.alarmDisableStartTime;
      this.alarms = parseJson(Cookies.get('alarms')) || defaultSettings.alarms;
      this.alertFilters = parseJson(Cookies.get('alert-filters')) || defaultSettings.alertFilters;
      this.background = Cookies.get('background') || defaultSettings.background;
      this.celsius = toBoolean(Cookies.get('celsius'), false);
      this.city = Cookies.get('city') || defaultSettings.city;
      this.clockFace = Cookies.get('clock_face') || defaultSettings.clockFace;
      this.dimming = Number(Cookies.get('dimming')) || 0;
      this.dimmingEnd = Cookies.get('dimming_end') || defaultSettings.dimmingEnd;
      this.dimmingStart = Cookies.get('dimming_start') || defaultSettings.dimmingStart;
      this.drawConstellations = toBoolean(Cookies.get('draw_constellations'), defaultSettings.drawConstellations);
      this.floatHands = Cookies.get('float_hands') || defaultSettings.floatHands;
      this.hidePlanets = toBoolean(Cookies.get('hidep'), false);
      this.hideSeconds = toBoolean(Cookies.get('hides'), false);
      this.hourlyForecast = (Cookies.get('hourly_forecast') as HourlyForecast) || defaultSettings.hourlyForecast;
      this.indoorOption = Cookies.get('indoor') || this.indoorOption;
      this.knots = toBoolean(Cookies.get('knots'), false);
      this.latitude = Number(Cookies.get('latitude')) || defaultSettings.latitude;
      this.longitude = Number(Cookies.get('longitude')) || defaultSettings.longitude;
      this.onscreenKB = toBoolean(Cookies.get('oskb'), false);
      this.outdoorOption = Cookies.get('outdoor') || 'F';
      this.recentLocations = parseJson(Cookies.get('recent_locations')) || defaultSettings.recentLocations;
      this.service = Cookies.get('service') || defaultSettings.service;
      this.showSkyColors = toBoolean(Cookies.get('show_sky_colors'), defaultSettings.showSkyColors);
      this.showSkyMap = toBoolean(Cookies.get('show_sky_map'), defaultSettings.showSkyMap);
      this.skyFacing = toNumber(Cookies.get('sky_facing'), defaultSettings.skyFacing);
      this.timeFormat = toTimeFormat(Cookies.get('ampm'), defaultSettings.timeFormat);
      this.updateToHide = Cookies.get('update-to-hide') || '';
      this.userId = Cookies.get('id') || '';

      if (this.floatHands === 'true')
        this.floatHands = 'T';
      else if (this.floatHands === 'false')
        this.floatHands = 'N';

      // Convert cookies to local storage, then clean up cookies.
      this.save();
      ['alarm_disable_duration', 'alarm_disable_start_time', 'alarms', 'alert-filters', 'ampm', 'background', 'celsius', 'city',
       'clock_face', 'dimming_end', 'dimming_start', 'dimming', 'draw_constellations', 'float_hands', 'hidep', 'hides',
       'hourly_forecast', 'id', 'indoor', 'knots', 'latitude', 'longitude', 'oskb', 'outdoor', 'recent_locations', 'service',
       'show_sky_colors', 'show_sky_map', 'sky_facing', 'update-to-hide'].forEach(name => Cookies.remove(name));
    }

    const body = $('body');

    body.css('--background-color', this.background);
    body.css('--clock-face-color', this.clockFace);
  }

  public save(): void {
    localStorage.setItem('aw-clock-settings', JSON.stringify(this));

    const body = $('body');

    body.css('--background-color', this.background);
    body.css('--clock-face-color', this.clockFace);
  }

  public requiresWeatherReload(oldSettings: Settings): boolean {
    return this.latitude !== oldSettings.latitude || this.longitude !== oldSettings.longitude ||
      this.service !== oldSettings.service;
  }
}

const defaultSettings = new Settings();
