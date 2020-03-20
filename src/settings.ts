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

import * as Cookies from 'js-cookie';
import { toBoolean } from 'ks-util';

export const runningDev = (document.location.port === '4200');
export const localServer = (document.location.port &&
  document.location.port !== '80' && document.location.port !== '443');

export class Settings {
  latitude = 42.75;
  longitude = -71.48;
  city = 'Nashua, NH';
  indoorOption = localServer ? 'D' : 'X';
  outdoorOption = 'F';
  userId = '';
  dimming = 0;
  dimmingStart = '23:00';
  dimmingEnd = '7:00';
  celsius = false;
  amPm = false;
  hideSeconds = false;
  hidePlanets = false;

  public defaultsSet(): boolean {
    return !!(Cookies.get('indoor') || Cookies.get('outdoor'));
  }

  public load(): void {
    this.latitude = Number(Cookies.get('latitude')) || defaultSettings.latitude;
    this.longitude = Number(Cookies.get('longitude')) || defaultSettings.longitude;
    this.city = Cookies.get('city') || defaultSettings.city;
    this.indoorOption = Cookies.get('indoor') || this.indoorOption;
    this.outdoorOption = Cookies.get('outdoor') || 'F';
    this.userId = Cookies.get('id') || '';
    this.dimming = Number(Cookies.get('dimming')) || 0;
    this.dimmingStart = Cookies.get('dimming_start') || defaultSettings.dimmingStart;
    this.dimmingEnd = Cookies.get('dimming_end') || defaultSettings.dimmingEnd;
    this.celsius = toBoolean(Cookies.get('celsius'), false);
    this.amPm = toBoolean(Cookies.get('ampm'), false);
    this.hideSeconds = toBoolean(Cookies.get('hides'), false);
    this.hidePlanets = toBoolean(Cookies.get('hidep'), false);
  }

  public save(): void {
    const expiration = { expires: 36525 }; // One century from now.

    Cookies.set('city', this.city, expiration);
    Cookies.set('latitude', this.latitude.toString(), expiration);
    Cookies.set('longitude', this.longitude.toString(), expiration);
    Cookies.set('indoor', this.indoorOption, expiration);
    Cookies.set('outdoor', this.outdoorOption, expiration);
    Cookies.set('id', this.userId, expiration);
    Cookies.set('dimming', this.dimming.toString(), expiration);
    Cookies.set('dimming_start', this.dimmingStart, expiration);
    Cookies.set('dimming_end', this.dimmingEnd, expiration);
    Cookies.set('celsius', this.celsius.toString(), expiration);
    Cookies.set('ampm', this.amPm.toString(), expiration);
    Cookies.set('hides', this.hideSeconds.toString(), expiration);
    Cookies.set('hidep', this.hidePlanets.toString(), expiration);
  }
}

const defaultSettings = new Settings();
