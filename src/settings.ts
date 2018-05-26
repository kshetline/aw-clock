import * as $ from 'jquery';
import { htmlEncode } from './util';

let dialog: JQuery;
let message: JQuery;
let cityTableWrapper: JQuery;
let cityTable: JQuery;
let cityField: JQuery;
let submit: JQuery;
let okButton: JQuery;
let cancelButton: JQuery;

interface SearchLocation {
  city: string;
  displayName: string;
  county: string;
  showCounty: boolean;
  state: string;
  showState: boolean;
  country: string;
  longCountry: string;
  latitude: number;
  longitude: number;
  zone: string;
  rank: number;
}

interface SearchResults {
  matches?: SearchLocation[];
  warning?: string;
  error?: string;
  info?: string;
  limitReached: boolean;
}

export interface Settings {
  latitude: number;
  longitude: number;
  city: string;
  id: string;
}

export function initSettings() {
  dialog = $('#settings-dialog');
  message = $('#atlas-message');
  cityTableWrapper = $('.city-table-wrapper');
  cityTable = $('#city-table');
  cityField = $('#city');
  submit = $('#submit');
  okButton = $('#settings-ok');
  cancelButton = $('#settings-cancel');

  $('#search').on('submit', event => {
    event.preventDefault();
    const query = $.trim(cityField.val() as string);

    if (query.length === 0)
      alert('Please enter a city or partial city name.');
    else {
      (cityField as any).enable(false);
      (submit as any).enable(false);
      message.html('&nbsp;');
      cityTableWrapper.hide();
      cityTable.html('');

      doSearch(query).then(response => {
        let rows = '<tr id="header"><th>&#x2605;</th><th>City</th><th>Latitude</th><th>Longitude</th><tr>\n';

        response.matches.forEach((city, index) => {
          rows += '<tr data-lat="' + city.latitude +
             '" data-lon="' + city.longitude + '"' +
            (response.matches.length > 6 && Math.floor(index / 3) % 2 === 1 ? ' class=rowguide' : '') +
            '><td>' + city.rank +
            '</td><td class="name">' + htmlEncode(city.displayName) +
            '</td><td class="coordinates">' + formatDegrees(city.latitude, 'NS', 2) +
            '</td><td class="coordinates">' + formatDegrees(city.longitude, 'EW', 3) +
            '</td></tr>\n';
        });

        cityTable.html(rows);
        cityTableWrapper.show();
        (submit as any).enable(true);
        (cityField as any).enable(true);
      }).catch(reason => {
        alert(reason);
      });
    }
  });
}

export function openSettings(callback: (Settings) => void) {
  dialog.css('display', 'block');
  cityTableWrapper.hide();

  cancelButton.on('click', () => {
    dialog.css('display', 'none');
    callback(null);
  });
}

function doSearch(query: string): Promise<SearchResults> {
  const url = 'http://skyviewcafe.com/atlasdb/atlas';

  return new Promise((resolve, reject) => {
    $.ajax({
      url: url,
      dataType: 'jsonp',
      data: {
        q: query,
        client: 'web'
      },
      success: (data: SearchResults) => {
        resolve(data);
      },
      error: (jqXHR: JQueryXHR, textStatus: string, errorThrown: string) => {
        reject(errorThrown);
      }
    });
  });
}

function formatDegrees(angle, compassPointsPosNeg, degreeDigits) {
  const compass = compassPointsPosNeg.charAt(angle < 0 ? 1 : 0);
  angle = Math.abs(angle);
  const degrees = angle.toFixed(3);
  angle = Number(degrees.split('.')[0]);

  return (degreeDigits > 2 && angle < 100 ? '\u2007' : '') +
    (degreeDigits > 1 && angle < 10 ? '\u2007' : '') + degrees + '\u00B0' + compass;
}
