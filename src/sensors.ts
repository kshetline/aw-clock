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
import { AppService } from './app.service';
import { reflow } from './svg-flow';

const DEV_SENSOR_URL = 'http://192.168.42.98:8080';

function errorText(err: any): string {
  err = err instanceof Error ? err.message : err.error;

  return err.replace(/error:\s*/i, '');
}

function getJson(url: string): Promise<any> {
  return new Promise(resolve => {
    // `$.ajax()` returns a Promise, but if I try to use that Promise directly, I can't find a way to get
    //   around "Uncaught (in promise)" errors, when what I was is a Promise resolved with an Error value.
    // noinspection JSIgnoredPromiseFromCall
    $.ajax({
      url,
      dataType: 'json',
      success: data => resolve(data),
      error: (jqXHR: JQueryXHR, textStatus: string, errorThrown: string) => resolve(new Error(textStatus + ': ' + errorThrown))
    });
  });
}

export class Sensors {
  private indoorTemp: JQuery;
  private indoorHumidity: JQuery;
  private indoorMeter: JQuery;
  private currentTempBalanceSpace: JQuery;
  private wiredAvailable = false;
  private wirelessAvailable = false;

  constructor(private appService: AppService) {
    this.currentTempBalanceSpace = $('#curr-temp-balance-space');
    this.indoorTemp = $('#indoor-temp');
    this.indoorHumidity = $('#indoor-humidity');
    this.indoorMeter = $('#indoor-meter');

    if (document.location.port === '4200' || document.location.port === '8080') {
      this.currentTempBalanceSpace.css('display', 'none');
      this.wiredAvailable = this.wirelessAvailable = true;
    }
  }

  get available() { return this.wiredAvailable || this.wirelessAvailable; }

  public update(celsius: boolean) {
    const runningDev = (document.location.port === '4200');
    const site = (runningDev ? DEV_SENSOR_URL : '');
    const wiredUrl = `${site}/indoor`;
    const wirelessUrl = `${site}/wireless-th`;
    const promises = [
      this.wiredAvailable ? getJson(wiredUrl) : Promise.resolve(null),
      this.wirelessAvailable ? getJson(wirelessUrl) : Promise.resolve(null)
    ];

    Promise.all(promises)
      .then(data => {
        const wired = data[0];
        const wireless = data[1];
        const indoorOption = this.appService.getIndoorOption();
        let indoorTemp: number;
        let indoorHumidity: number;
        let cd: any;
        let err: string;

        if (wired && !(wired instanceof Error) && wired.error === 'n/a')
          this.wiredAvailable = false;
        else if (wired instanceof Error || wired?.error) {
          err = errorText(wired);
          console.error('Error reading wired temp/humidity: ' + err);
          this.wiredAvailable = !(/not found/i.test(err));
        }
        else if (wired && indoorOption === 'D') {
          indoorTemp = (celsius ? wired.temperature : wired.temperature * 1.8 + 32);
          indoorHumidity = wired.humidity;
        }

        if (wireless && !(wireless instanceof Error) && wireless.error === 'n/a')
          this.wirelessAvailable = false;
        else if (wireless instanceof Error || wireless?.error) {
          err = errorText(wireless);
          console.error('Error reading wireless temp/humidity: ' + err);
          this.wirelessAvailable = !(/not found/i.test(err));
        }
        else if (wireless && (cd = wireless[indoorOption])) {
          indoorTemp = (celsius ? cd.temperature : cd.temperature * 1.8 + 32);
          indoorHumidity = cd.humidity;

          const level = Math.floor((cd.signalQuality + 10) / 20);

          for (let i = 0; i <= 5; ++i) {
            if (level === i)
              this.indoorMeter.addClass('signal-level-' + i);
            else
              this.indoorMeter.removeClass('signal-level-' + i);
          }
        }

        if (!this.available)
          this.currentTempBalanceSpace.css('display', 'none');
        else if (indoorTemp === undefined) {
          this.indoorTemp.text('‣--°');
          this.indoorHumidity.text('‣--%');
        }
        else {
          this.indoorTemp.text(`‣${Math.round(indoorTemp)}°`);
          this.indoorHumidity.text(`‣${Math.round(indoorHumidity)}%`);
        }

        setTimeout(reflow);
      });
  }
}
