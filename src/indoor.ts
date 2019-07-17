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

interface IndoorConditions {
  temperature: number;
  humidity: number;
  error?: any;
}

export class Indoor {
  private indoorTemp: JQuery;
  private indoorHumidity: JQuery;
  private currentTempBalanceSpace: JQuery;
  private _available: boolean;

  constructor() {
    this.currentTempBalanceSpace = $('#curr-temp-balance-space');
    this.indoorTemp = $('#indoor-temp');
    this.indoorHumidity = $('#indoor-humidity');

    if (document.location.port === '4200' || document.location.port === '8080') {
      this.currentTempBalanceSpace.css('display', 'none');
      this._available = true;
    }
    else
      this._available = false;
  }

  get available() { return this._available; }

  public update(celsius: boolean) {
    const runningDev = (document.location.port === '4200');
    const site = (runningDev ? 'http://192.168.42.92:8080' : '');
    const url = `${site}/indoor`;

    $.ajax({
      url: url,
      dataType: 'json',
      success: (data: IndoorConditions) => {
        if (data.error === 'n/a') {
          this.currentTempBalanceSpace.css('display', 'none');
          this._available = true;
        }
        else if (data.error) {
          console.error('Error reading temp/humidity: ' + data.error);
          this.indoorTemp.text('‣--°');
          this.indoorHumidity.text('‣--%');
        }
        else {
          const temp = (celsius ? data.temperature : data.temperature * 1.8 + 32);

          this.indoorTemp.text(`‣${Math.round(temp)}°`);
          this.indoorHumidity.text(`‣${Math.round(data.humidity)}%`);
        }
      },
      error: (jqXHR: JQueryXHR, textStatus: string, errorThrown: string) => {
        console.error('Error reading temp/humidity: ' + textStatus + ' - ' + errorThrown);
        this.indoorTemp.text('‣--°');
        this.indoorHumidity.text('‣--%');
      }
    });
  }
}
