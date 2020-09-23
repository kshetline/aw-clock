import { AppService } from './app.service';
import $ from 'jquery';
import { reflow } from './svg-flow';
import { localServer } from './settings';
import { convertTemp } from './util';

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
  celsius?: boolean;
}

export class CurrentTempManager {
  private readonly currentTempBalanceSpace: JQuery;
  private readonly feelsLike: JQuery;
  private readonly headers: JQuery;
  private readonly indoorHumidity: JQuery;
  private readonly indoorTemp: JQuery;
  private readonly outdoorHumidity: JQuery;
  private readonly outdoorTemp: JQuery;
  private readonly temperatureDetail: JQuery;

  private readonly cth: CurrentTemperatureHumidity = {};

  private hideIndoor = false;

  constructor(private appService: AppService) {
    this.currentTempBalanceSpace = $('#curr-temp-balance-space');
    this.feelsLike = $('#feels-like');
    this.headers = $('.forecast-day-header');
    this.indoorHumidity = $('#indoor-humidity');
    this.indoorTemp = $('#indoor-temp');
    this.outdoorHumidity = $('#humidity');
    this.outdoorTemp = $('#current-temp');
    this.temperatureDetail = $('#temperature-detail');

    if (!localServer) {
      this.hideIndoor = true;
      this.currentTempBalanceSpace.css('display', 'none');
      this.indoorHumidity.text('');
      this.indoorTemp.text('');

      appService.proxySensorUpdate().then(available => {
        if (available) {
          this.hideIndoor = false;
          this.currentTempBalanceSpace.css('display', 'block');
          this.indoorHumidity.text(DD);
          this.indoorTemp.text(DD + '°');
        }
      });
    }
  }

  public swapTemperatureUnits(makeCelsius: boolean): void {
    if (this.cth.celsius !== makeCelsius) {
      const convert = (t: number) => convertTemp(t, makeCelsius);

      if (this.cth.forecastFeelsLike != null)
        this.cth.forecastFeelsLike = convert(this.cth.forecastFeelsLike);

      if (this.cth.forecastTemp != null)
        this.cth.forecastTemp = convert(this.cth.forecastTemp);

      if (this.cth.indoorTemp != null)
        this.cth.indoorTemp = convert(this.cth.indoorTemp);

      if (this.cth.outdoorTemp != null)
        this.cth.outdoorTemp = convert(this.cth.outdoorTemp);

      if (this.cth.sensorTempDetail != null)
        this.cth.sensorTempDetail = this.cth.sensorTempDetail.replace(/-?\d+(?=°)/g, t => convert(Number(t)).toFixed(0));

      this.updateCurrentTempAndHumidity(null, makeCelsius);
    }
  }

  // Null values erase old values, undefined values preserve old values, defined values replace old values
  updateCurrentTempAndHumidity(cthUpdate: CurrentTemperatureHumidity, celsius: boolean): void {
    this.cth.celsius = celsius;
    Object.keys(cthUpdate ?? {}).forEach(key => {
      if (cthUpdate[key] !== undefined)
        this.cth[key] = cthUpdate[key];
    });

    const indoorOption = this.appService.getIndoorOption();
    const outdoorOption = this.appService.getOutdoorOption();

    if (indoorOption === 'X' || this.hideIndoor) {
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

    const delta = (celsius ? 2 : 4);

    if (temperature != null && this.cth.forecastTemp != null && Math.abs(temperature - this.cth.forecastTemp) > delta &&
        !this.cth.forecastStale) {
      temperature = Math.min(Math.max(this.cth.forecastTemp - delta, temperature), this.cth.forecastTemp + delta);
      this.outdoorTemp.addClass('forecast-limited');
    }
    else
      this.outdoorTemp.removeClass('forecast-limited');

    this.outdoorHumidity.text(`${humidity != null ? Math.round(humidity) : DD}%`);
    this.outdoorTemp.text(`\u00A0${temperature != null ? Math.round(temperature) : DD}°`);
    this.feelsLike.toggleClass('stale-forecast', this.cth.forecastStale);
    this.headers.toggleClass('stale-forecast', this.cth.forecastStale);

    this.feelsLike.text(`${this.cth.forecastFeelsLike != null ? Math.round(this.cth.forecastFeelsLike) : DD}°`);
    const details = detail.join(', ');
    this.temperatureDetail.text(details.includes(',') ? details : '');

    setTimeout(reflow);
  }
}
