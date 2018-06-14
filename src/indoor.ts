import * as $ from 'jquery';

let currentTempBalanceSpace: JQuery;
let indoorTemp: JQuery;
let indoorHumidity: JQuery;

interface IndoorConditions {
  temperature: number;
  humidity: number;
  error?: any;
}

export function initIndoor(): boolean {
  currentTempBalanceSpace = $('#curr-temp-balance-space');
  indoorTemp = $('#indoor-temp');
  indoorHumidity = $('#indoor-humidity');

  if (document.location.port === '4200' || document.location.port === '8080') {
    currentTempBalanceSpace.css('display', 'none');

    return true;
  }

  return false;
}

export function updateIndoor(celsius: boolean) {
  const runningDev = (document.location.port === '4200');
  const site = (runningDev ? 'http://192.168.42.92:8080' : '');
  const url = `${site}/indoor`;

  $.ajax({
    url: url,
    dataType: 'json',
    success: (data: IndoorConditions) => {
      if (data.error) {
        console.error('Error reading temp/humidity: ' + data.error);
        indoorTemp.text('‣--°');
        indoorHumidity.text('‣--%');
      }
      else {
        const temp = (celsius ? data.temperature : data.temperature * 1.8 + 32);

        indoorTemp.text(`‣${Math.round(temp)}°`);
        indoorHumidity.text(`‣${Math.round(data.humidity)}%`);
      }
    },
    error: (jqXHR: JQueryXHR, textStatus: string, errorThrown: string) => {
      console.error('Error reading temp/humidity: ' + textStatus + ' - ' + errorThrown);
      indoorTemp.text('‣--°');
      indoorHumidity.text('‣--%');
    }
  });
}
