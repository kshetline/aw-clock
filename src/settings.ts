import * as $ from 'jquery';
import { domAlert, htmlEncode, popKeydownListener, pushKeydownListener } from './util';

let dialog: JQuery;
let currentCity: JQuery;
let latitude: JQuery;
let longitude: JQuery;
let userId: JQuery;
let searchCity: JQuery;
let searchFocused = false;
let searchMessage: JQuery;
let cityTableWrapper: JQuery;
let cityTable: JQuery;
let submitSearch: JQuery;
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
  userId?: string;
}

export function initSettings() {
  dialog = $('#settings-dialog');
  currentCity = $('#current-city');
  latitude = $('#latitude');
  longitude = $('#longitude');
  userId = $('#user-id');
  searchCity = $('#search-city');
  searchMessage = $('#search-message');
  submitSearch = $('#submit-search');
  cityTableWrapper = $('.city-table-wrapper');
  cityTable = $('#city-table');
  okButton = $('#settings-ok');
  cancelButton = $('#settings-cancel');

  searchCity.on('focus', () => searchFocused = true);
  searchCity.on('blur', () => searchFocused = false);

  $('#search').on('submit', event => {
    event.preventDefault();
    const query = $.trim(searchCity.val() as string);

    if (query.length === 0)
      domAlert('Please enter a city or partial city name.');
    else {
      (searchCity as any).enable(false);
      (submitSearch as any).enable(false);
      searchMessage.html('&nbsp;');
      cityTableWrapper.hide();
      cityTable.html('');

      doSearch(query).then(response => {
        let rows = '<tr id="header"><th>&#x2605;</th><th>City</th><th>Latitude</th><th>Longitude</th><tr>\n';

        response.matches.forEach((city, index) => {
          rows += '<tr data-lat="' + city.latitude +
             '" data-lon="' + city.longitude + '"' +
            (response.matches.length > 6 && Math.floor(index / 3) % 2 === 0 ? ' class=rowguide' : '') +
            '><td>' + city.rank +
            '</td><td class="name">' + htmlEncode(city.displayName) +
            '</td><td class="coordinates">' + formatDegrees(city.latitude, 'NS', 2) +
            '</td><td class="coordinates">' + formatDegrees(city.longitude, 'EW', 3) +
            '</td></tr>\n';
        });

        cityTable.html(rows);
        cityTableWrapper.show();
        (submitSearch as any).enable(true);
        (searchCity as any).enable(true);

        cityTable.find('tr').each(function(index) {
          if (index !== 0) {
            const $this = $(this);

            $this.on('click', () => {
              currentCity.val($this.find('td.name').text().replace(/ \([^)]+\)/g, ''));
              latitude.val($this.data('lat'));
              longitude.val($this.data('lon'));
            });

            $this.on('dblclick', () => {
              okButton.trigger('click');
            });
          }
        });
      }).catch(reason => {
        alert(reason);
      });
    }
  });
}

export function openSettings(previousSettings: Settings, callback: (Settings) => void) {
  currentCity.val(previousSettings.city);
  latitude.val(previousSettings.latitude);
  longitude.val(previousSettings.longitude);
  userId.val(previousSettings.userId);
  searchCity.val('');
  cityTableWrapper.hide();
  dialog.css('display', 'block');

  pushKeydownListener((event: KeyboardEvent) => {
    if (event.code === 'Escape') {
      event.preventDefault();
      cancelButton.trigger('click');
    }
    else if (event.code === 'Enter' && !searchFocused) {
      event.preventDefault();
      okButton.trigger('click');
    }
  });

  const doOK = () => {
    const newSettings: Settings = {
      city: (currentCity.val() as string).trim(),
      latitude: Number(latitude.val()),
      longitude: Number(longitude.val()),
      userId: userId.val() as string
    };

    if (!newSettings.city) {
      domAlert('Current city must be specified.');
      currentCity.trigger('focus');
    }
    else if (isNaN(newSettings.latitude) || newSettings.latitude < -90 || newSettings.latitude > 90) {
      domAlert('A valid latitude must be provided from -90 to 90 degrees.');
      latitude.trigger('focus');
    }
    else if (isNaN(newSettings.longitude) || newSettings.longitude < -180 || newSettings.longitude > 180) {
      domAlert('A valid longitude must be provided from -180 to 180 degrees.');
      longitude.trigger('focus');
    }
    else {
      popKeydownListener();
      okButton.off('click', doOK);
      dialog.css('display', 'none');
      callback(newSettings);
    }
  };

  okButton.on('click', doOK);

  cancelButton.one('click', () => {
    popKeydownListener();
    okButton.off('click', doOK);
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
