import * as $ from 'jquery';
import { reflow } from './svg-flow';

export interface CurrentTemperatureHumidity {
  forecastFeelsLike?: number;
  forecastHumidity?: number;
  forecastStale?: boolean;
  forecastTemp?: number;
  indoorHumidity?: number;
  indoorTemp?: number;
  outdoorHumidity?: number;
  outdoorTemp?: number;
  sensorTempDetail?: string;
}

export class CurrentTempManager {
  private readonly currentTempBalanceSpace: JQuery;
  private readonly feelsLike: JQuery;
  private readonly indoorHumidity: JQuery;
  private readonly indoorTemp: JQuery;
  private readonly outdoorHumidity: JQuery;
  private readonly outdoorTemp: JQuery;
  private readonly temperatureDetail: JQuery;

  private readonly cth: CurrentTemperatureHumidity = {};

  constructor() {
    this.currentTempBalanceSpace = $('#curr-temp-balance-space');
    this.feelsLike = $('#feels-like');
    this.indoorHumidity = $('#indoor-humidity');
    this.indoorTemp = $('#indoor-temp');
    this.outdoorHumidity = $('#humidity');
    this.outdoorTemp = $('#current-temp');
    this.temperatureDetail = $('#temperature-detail');

    if (document.location.port === '4200' || document.location.port === '8080')
      this.currentTempBalanceSpace.css('display', 'none');
  }

  // Null values erase old values, undefined values preserver old values, defined values replace old values
  updateCurrentTempAndHumidity(cthUpdate: CurrentTemperatureHumidity, celsius: boolean): void {
    Object.keys(cthUpdate ?? {}).forEach(key => {
      if (cthUpdate[key] !== undefined)
        this.cth[key] = cthUpdate[key];
    });

    this.indoorHumidity.text(`‣${this.cth.indoorHumidity != null ? Math.round(this.cth.indoorHumidity) : '--'}%`);
    this.indoorTemp.text(`‣${this.cth.indoorTemp != null ? Math.round(this.cth.indoorTemp) : '--'}°`);

    const humidity = this.cth.outdoorHumidity ?? this.cth.forecastHumidity;
    let temperature = this.cth.outdoorTemp ?? this.cth.forecastTemp;
    const detail = this.cth.sensorTempDetail ? [this.cth.sensorTempDetail] : [];

    if (this.cth.forecastTemp != null) {
      this.cth.forecastTemp = Math.round(this.cth.forecastTemp);
      detail.push(`F: ${this.cth.forecastTemp}°`);
    }

    if (temperature != null && this.cth.forecastTemp != null && temperature > this.cth.forecastTemp +
        (celsius ? 2 : 4) && !this.cth.forecastStale) {
      temperature = this.cth.forecastTemp;
      this.outdoorTemp.addClass('forecast-substitution');
    }
    else
      this.outdoorTemp.removeClass('forecast-substitution');

    this.outdoorHumidity.text(`${humidity != null ? Math.round(humidity) : '--'}%`);
    this.outdoorTemp.text(`\u00A0${temperature != null ? Math.round(temperature) : '--'}°`);

    if (this.cth.forecastStale)
      this.outdoorTemp.addClass('stale-forecast');
    else
      this.outdoorTemp.removeClass('stale-forecast');

    this.feelsLike.text(`${this.cth.forecastFeelsLike != null ? Math.round(this.cth.forecastFeelsLike) : '--'}°`);
    this.temperatureDetail.text(detail.join(', '));

    setTimeout(reflow);
  }
}
