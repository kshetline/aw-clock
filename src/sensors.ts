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

import { AppService } from './app.service';
import { DhtSensorData } from '../server/src/indoor-router';
import * as $ from 'jquery';
import { TempHumidityData } from '../server/src/temp-humidity-router';
import { CurrentTemperatureHumidity } from './current-temp-manager';

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

function setSignalLevel(elem: JQuery, quality: number): void {
  const newLevel = 'signal-' + (quality < 0 ? 'lost' : 'level-' + Math.floor((quality + 10) / 20));
  let classes = ((elem[0].className as any).baseVal || '').replace(/signal-[-\w]+/, newLevel);

  if (!classes.includes(newLevel))
    classes = (classes + ' ' + newLevel).trim();

  (elem[0].className as any).baseVal = classes;
  elem.attr('data-signal-quality', (quality < 0 ? 0 : quality) + '%');
}

export class Sensors {
  private readonly indoorMeter: JQuery;
  private readonly lowBattery: JQuery;
  private readonly lowBatteryText: JQuery;
  private readonly outdoorMeter: JQuery;

  private wiredAvailable = false;
  private wirelessAvailable = false;

  constructor(private appService: AppService) {
    this.indoorMeter = $('#indoor-meter');
    this.lowBattery = $('#low-battery');
    this.lowBatteryText = $('#low-battery-text');
    this.outdoorMeter = $('#outdoor-meter');

    if (document.location.port === '4200' || document.location.port === '8080')
      this.wiredAvailable = this.wirelessAvailable = true;
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
        const wired: DhtSensorData = data[0];
        const wireless: Record<string, TempHumidityData> | { error: string } = data[1];
        const lowBatteries: string[] = [];
        const indoorOption = this.appService.getIndoorOption();
        const outdoorOption = this.appService.getOutdoorOption();
        let thd: TempHumidityData;
        const cth: CurrentTemperatureHumidity = {
          indoorHumidity: null,
          indoorTemp: null,
          outdoorHumidity: null,
          outdoorTemp: null
        };
        let err: string;

        this.indoorMeter.css('display', /[ABC]/.test(indoorOption) ? 'block' : 'none');
        this.outdoorMeter.css('display', /[ABC]/.test(outdoorOption) ? 'block' : 'none');

        if (wired && !(wired instanceof Error) && wired.error === 'n/a')
          this.wiredAvailable = false;
        else if (wired instanceof Error || wired?.error) {
          err = errorText(wired);
          console.error('Error reading wired temp/humidity: ' + err);
          this.wiredAvailable = !(/not found/i.test(err));
        }
        else if (wired && indoorOption === 'D') {
          cth.indoorTemp = (celsius ? wired.temperature : wired.temperature * 1.8 + 32);
          cth.indoorHumidity = wired.humidity;
        }

        if (wireless && !(wireless instanceof Error) && wireless.error === 'n/a') {
          this.wirelessAvailable = false;
          setSignalLevel(this.indoorMeter, -1);
          setSignalLevel(this.outdoorMeter, -1);
        }
        else if (wireless instanceof Error || wireless?.error) {
          err = errorText(wireless);
          console.error('Error reading wireless temp/humidity: ' + err);
          setSignalLevel(this.indoorMeter, -1);
          setSignalLevel(this.outdoorMeter, -1);
          this.wirelessAvailable = !(/not found/i.test(err));
        }
        else if (wireless) {
          if ((thd = wireless[indoorOption])) {
            cth.indoorTemp = (celsius ? thd.temperature : thd.temperature * 1.8 + 32);
            cth.indoorHumidity = thd.humidity;
            setSignalLevel(this.indoorMeter, thd.signalQuality);

            if (thd.batteryLow)
              lowBatteries.push(indoorOption);
          }
          else
            setSignalLevel(this.indoorMeter, -1);

          if (outdoorOption !== 'F') {
            if ((thd = wireless[outdoorOption])) {
              cth.outdoorHumidity = Math.round(thd.humidity);
              cth.outdoorTemp = Math.round(celsius ? thd.temperature : thd.temperature * 1.8 + 32);
              setSignalLevel(this.outdoorMeter, thd.signalQuality);

              if (thd.batteryLow)
                lowBatteries.push(outdoorOption);
            }
            else
              setSignalLevel(this.outdoorMeter, -1);
          }
        }

        if (lowBatteries.length === 0) {
          this.lowBattery.css('display', 'none');
          this.lowBatteryText.text('');
        }
        else {
          this.lowBattery.css('display', 'block');
          this.lowBatteryText.text(lowBatteries.sort().join(', '));
        }

        this.appService.updateCurrentTemp(cth);
      });
  }
}
