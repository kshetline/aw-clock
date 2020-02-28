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
import { updateSvgFlowItems } from './svg-flow';
import { localServer, runningDev } from './settings';

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
  const newLevel = 'signal-' + (quality < 0 ? 'lost' : 'level-' + Math.max(Math.floor((quality + 19) / 20)), 1);
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
  private readonly outdoorMeter2: JQuery;

  private readonly indoorAvailable: boolean;
  private wiredAvailable = false;
  private wirelessAvailable = false;

  constructor(private appService: AppService) {
    this.indoorMeter = $('#indoor-meter');
    this.lowBattery = $('#low-battery');
    this.lowBatteryText = $('#low-battery-text');
    this.outdoorMeter = $('#outdoor-meter');
    this.outdoorMeter2 = $('#outdoor-meter-2');

    if (localServer)
      this.indoorAvailable = this.wiredAvailable = this.wirelessAvailable = true;
    else {
      this.indoorAvailable = false;
      this.indoorMeter.css('display', 'none');
      this.outdoorMeter.css('display', 'none');
      this.outdoorMeter2.css('display', 'none');
    }
  }

  get available() { return this.wiredAvailable || this.wirelessAvailable; }

  public update(celsius: boolean) {
    const site = (runningDev ? DEV_SENSOR_URL : '');
    const wiredUrl = `${site}/indoor`;
    const wirelessUrl = `${site}/wireless-th`;
    const indoorOption = this.appService.getIndoorOption();
    const outdoorOption = this.appService.getOutdoorOption();
    const flowSpec = this.outdoorMeter[0].getAttributeNS(null, 'svg-flow');
    let newFlowSpec: string;

    this.indoorMeter.css('display', this.wiredAvailable && /[ABC]{1,2}/.test(indoorOption) ? 'block' : 'none');
    this.outdoorMeter.css('display', this.wirelessAvailable && /[ABC]{1,2}/.test(outdoorOption) ? 'block' : 'none');

    if (outdoorOption.length === 2) {
      this.outdoorMeter2.css('display', 'block');
      newFlowSpec = flowSpec.replace(/(.*\bdx=)[-.\d]+(\b.*)/, '$1-6.3$2');
    }
    else {
      this.outdoorMeter2.css('display', 'none');
      newFlowSpec = flowSpec.replace(/(.*\bdx=)[-.\d]+(\b.*)/, '$1-5$2');
    }

    if (newFlowSpec !== flowSpec) {
      this.outdoorMeter[0].setAttributeNS(null, 'svg-flow', newFlowSpec);
      updateSvgFlowItems();
    }

    const promises = [
      this.wiredAvailable && indoorOption !== 'X' ? getJson(wiredUrl) : Promise.resolve(null),
      this.wirelessAvailable ? getJson(wirelessUrl) : Promise.resolve(null)
    ];

    Promise.all(promises)
      .then(data => {
        const wired: DhtSensorData = data[0];
        const wireless: Record<string, TempHumidityData> | { error: string } = data[1];
        const lowBatteries: string[] = [];
        let thd: TempHumidityData;
        const cth: CurrentTemperatureHumidity = {
          indoorHumidity: null,
          indoorTemp: null,
          outdoorHumidity: null,
          outdoorTemp: null
        };
        let err: string;
        const sensorDetail: string[] = [];

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
          this.outdoorMeter.css('display', 'none');
          this.outdoorMeter2.css('display', 'none');
        }
        else if (wireless instanceof Error || wireless?.error) {
          err = errorText(wireless);
          console.error('Error reading wireless temp/humidity: ' + err);
          setSignalLevel(this.indoorMeter, -1);
          setSignalLevel(this.outdoorMeter, -1);
          setSignalLevel(this.outdoorMeter2, -1);
          this.wirelessAvailable = !(/not found/i.test(err));
        }
        else if (wireless) {
          if ((thd = wireless[indoorOption])) {
            if (thd.reliable) {
              cth.indoorTemp = (celsius ? thd.temperature : thd.temperature * 1.8 + 32);
              cth.indoorHumidity = thd.humidity;
            }

            setSignalLevel(this.indoorMeter, thd.signalQuality);

            if (thd.batteryLow && thd.reliable)
              lowBatteries.push(indoorOption);
          }
          else
            setSignalLevel(this.indoorMeter, -1);

          if (outdoorOption !== 'F') {
            const humidities: number[] = [];
            let temperature: number = null;
            let selectedChannel: string = null;
            let reliable = false;
            const signalQs: number[] = [];

            outdoorOption.split('').forEach(channel => {
              if (!(thd = wireless[channel])) {
                signalQs.push(-1);
                return;
              }

              signalQs.push(thd.signalQuality);

              if (thd.temperature !== undefined && thd.reliable) {
                const t = Math.round(celsius ? thd.temperature : thd.temperature * 1.8 + 32);

                sensorDetail.push(`${channel}: ${t}°` + (thd.reliable ? '' : '?'));

                if (temperature === null || temperature > t || (thd.reliable && !reliable)) {
                  temperature = t;
                  selectedChannel = channel;
                  reliable = thd.reliable;
                }
              }

              if (thd.humidity !== undefined && thd.reliable)
                humidities.push(thd.humidity);

              if (thd.batteryLow && thd.reliable)
                lowBatteries.push(channel);
            });

            const index = (selectedChannel ? outdoorOption.indexOf(selectedChannel) : -1);

            cth.outdoorHumidity = index < 0 ? null : humidities[Math.min(index, humidities.length - 1)];
            cth.outdoorTemp = temperature;
            signalQs[0] = signalQs[0] ?? -1;
            signalQs[1] = signalQs[1] ?? -1;
            setSignalLevel(this.outdoorMeter, signalQs[0]);
            setSignalLevel(this.outdoorMeter2, signalQs[1]);

            if (signalQs[0] < 0 || outdoorOption.length === 1 || selectedChannel === outdoorOption.charAt(0))
              this.outdoorMeter.removeClass('meter-tint');
            else
              this.outdoorMeter.addClass('meter-tint');

            if (signalQs[1] < 0 || outdoorOption.length === 1 || selectedChannel === outdoorOption.charAt(1))
              this.outdoorMeter2.removeClass('meter-tint');
            else
              this.outdoorMeter2.addClass('meter-tint');
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

        cth.sensorTempDetail = sensorDetail.join(', ');
        this.appService.updateCurrentTemp(cth);
      });
  }
}
