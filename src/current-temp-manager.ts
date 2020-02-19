import { AppService } from './app.service';
import * as $ from 'jquery';
import { reflow } from './svg-flow';

const DD = '\u2012\u2012';

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

  constructor(private appService: AppService) {
    this.currentTempBalanceSpace = $('#curr-temp-balance-space');
    this.feelsLike = $('#feels-like');
    this.indoorHumidity = $('#indoor-humidity');
    this.indoorTemp = $('#indoor-temp');
    this.outdoorHumidity = $('#humidity');
    this.outdoorTemp = $('#current-temp');
    this.temperatureDetail = $('#temperature-detail');
  }

  // Null values erase old values, undefined values preserver old values, defined values replace old values
  updateCurrentTempAndHumidity(cthUpdate: CurrentTemperatureHumidity, celsius: boolean): void {
    Object.keys(cthUpdate ?? {}).forEach(key => {
      if (cthUpdate[key] !== undefined)
        this.cth[key] = cthUpdate[key];
    });

    const indoorOption = this.appService.getIndoorOption();
    const outdoorOption = this.appService.getOutdoorOption();

    if (indoorOption === 'X') {
      this.currentTempBalanceSpace.css('display', 'none');
      this.indoorHumidity.text('');
      this.indoorTemp.text('');
    }
    else {
      this.currentTempBalanceSpace.css('display', 'block');
      this.indoorHumidity.text(`‣${this.cth.indoorHumidity != null ? Math.round(this.cth.indoorHumidity) : DD}%`);
      this.indoorTemp.text(`‣${this.cth.indoorTemp != null ? Math.round(this.cth.indoorTemp) : DD}°`);
    }

    this.temperatureDetail.css('display', outdoorOption === 'F' ? 'none' : 'block');

    const humidity = this.cth.outdoorHumidity ?? this.cth.forecastHumidity;
    let temperature = this.cth.outdoorTemp ?? this.cth.forecastTemp;
    const detail = this.cth.sensorTempDetail ? [this.cth.sensorTempDetail] : [];

    if (this.cth.forecastTemp != null) {
      this.cth.forecastTemp = Math.round(this.cth.forecastTemp);
      detail.push(`F: ${this.cth.forecastTemp}°`);
    }

    if (temperature != null && this.cth.forecastTemp != null && Math.abs(temperature - this.cth.forecastTemp) > (celsius ? 2 : 4) &&
        !this.cth.forecastStale) {
      temperature = this.cth.forecastTemp;
      this.outdoorTemp.addClass('forecast-substitution');
    }
    else
      this.outdoorTemp.removeClass('forecast-substitution');

    this.outdoorHumidity.text(`${humidity != null ? Math.round(humidity) : DD}%`);
    this.outdoorTemp.text(`\u00A0${temperature != null ? Math.round(temperature) : DD}°`);

    if (this.cth.forecastStale)
      this.outdoorTemp.addClass('stale-forecast');
    else
      this.outdoorTemp.removeClass('stale-forecast');

    this.feelsLike.text(`${this.cth.forecastFeelsLike != null ? Math.round(this.cth.forecastFeelsLike) : DD}°`);
    this.temperatureDetail.text(detail.join(', '));

    setTimeout(reflow);
  }
}
