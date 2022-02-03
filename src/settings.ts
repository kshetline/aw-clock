import { HourlyForecast, TimeFormat } from './shared-types';
import $ from 'jquery';
import Cookies from 'js-cookie';
import { isChromium, isRaspbian, toBoolean, toNumber } from '@tubular/util';
import { parseJson } from './awc-util';

const docPort = document.location.port;

export const runningDev = (docPort === '3000' || docPort === '4200');
export const localServer = (docPort && docPort !== '80' && docPort !== '443');
export const updateTest = toBoolean(new URLSearchParams(window.location.search).get('ut'), false, true);

const apiParam = new URLSearchParams(window.location.search).get('api');
const apiPort = apiParam || (runningDev ? (docPort === '3000' ? '3002' : '4201') : docPort || '8080');
const apiHost = ((document.location.hostname || '').startsWith('192.') ? document.location.hostname : 'localhost');

// noinspection HttpUrlsUsage
export const apiServer = new URL(window.location.href).searchParams.get('weather_server') ||
  (runningDev ? `http://${apiHost}:${apiPort}` : '');
export const raspbianChromium = (isRaspbian() && isChromium()) || runningDev;

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

export const MAX_RECENT_LOCATIONS = 5;

export class Settings {
  alarms: AlarmInfo[] = [];
  background = '#191970';
  celsius = false;
  city = 'New York, NY';
  clockFace = '#000000';
  dimming = 0;
  dimmingEnd = '7:00';
  dimmingStart = '23:00';
  drawConstellations = true;
  floatHands = true;
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
  userId = '';

  public defaultsSet(): boolean {
    return !!(Cookies.get('indoor') || Cookies.get('outdoor') || Cookies.get('city'));
  }

  public load(): void {
    this.alarms = parseJson(Cookies.get('alarms')) || defaultSettings.alarms;
    this.background = Cookies.get('background') || defaultSettings.background;
    this.celsius = toBoolean(Cookies.get('celsius'), false);
    this.city = Cookies.get('city') || defaultSettings.city;
    this.clockFace = Cookies.get('clock_face') || defaultSettings.clockFace;
    this.dimming = Number(Cookies.get('dimming')) || 0;
    this.dimmingEnd = Cookies.get('dimming_end') || defaultSettings.dimmingEnd;
    this.dimmingStart = Cookies.get('dimming_start') || defaultSettings.dimmingStart;
    this.drawConstellations = toBoolean(Cookies.get('draw_constellations'), defaultSettings.drawConstellations);
    this.floatHands = toBoolean(Cookies.get('float_hands'), defaultSettings.floatHands);
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
    this.userId = Cookies.get('id') || '';

    const body = $('body');

    body.css('--background-color', this.background);
    body.css('--clock-face-color', this.clockFace);
  }

  public save(): void {
    const expiration = { expires: 36525 }; // One century from now.

    Cookies.set('alarms', JSON.stringify(this.alarms));
    Cookies.set('background', this.background, expiration);
    Cookies.set('celsius', this.celsius.toString(), expiration);
    Cookies.set('city', this.city, expiration);
    Cookies.set('clock_face', this.clockFace, expiration);
    Cookies.set('dimming', this.dimming.toString(), expiration);
    Cookies.set('dimming_end', this.dimmingEnd, expiration);
    Cookies.set('dimming_start', this.dimmingStart, expiration);
    Cookies.set('draw_constellations', this.drawConstellations.toString(), expiration);
    Cookies.set('float_hands', this.floatHands.toString(), expiration);
    Cookies.set('hidep', this.hidePlanets.toString(), expiration);
    Cookies.set('hides', this.hideSeconds.toString(), expiration);
    Cookies.set('hourly_forecast', this.hourlyForecast, expiration);
    Cookies.set('indoor', this.indoorOption, expiration);
    Cookies.set('knots', this.knots.toString(), expiration);
    Cookies.set('latitude', this.latitude.toString(), expiration);
    Cookies.set('longitude', this.longitude.toString(), expiration);
    Cookies.set('oskb', this.onscreenKB.toString(), expiration);
    Cookies.set('outdoor', this.outdoorOption, expiration);
    Cookies.set('recent_locations', JSON.stringify(this.recentLocations));
    Cookies.set('service', this.service, expiration);
    Cookies.set('show_sky_colors', this.showSkyColors.toString(), expiration);
    Cookies.set('show_sky_map', this.showSkyMap.toString(), expiration);
    Cookies.set('sky_facing', this.skyFacing.toString(), expiration);
    Cookies.set('ampm', ['24', 'ampm', 'utc'][this.timeFormat] ?? '24', expiration);
    Cookies.set('id', this.userId, expiration);

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
