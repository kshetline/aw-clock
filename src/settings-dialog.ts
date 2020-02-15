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
import { domAlert, htmlEncode, popKeydownListener, pushKeydownListener } from './util';
import { Settings } from './settings';
import { AppService } from './app.service';
import { isIE, isSafari } from 'ks-util';

const ERROR_BACKGROUND = '#FCC';
const WARNING_BACKGROUND = '#FFC';
const LIMIT_REACHED_BACKGROUND = '#FC9';

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

function formatDegrees(angle, compassPointsPosNeg, degreeDigits) {
  const compass = compassPointsPosNeg.charAt(angle < 0 ? 1 : 0);
  angle = Math.abs(angle);
  const degrees = angle.toFixed(3);
  angle = Number(degrees.split('.')[0]);

  return (degreeDigits > 2 && angle < 100 ? '\u2007' : '') +
    (degreeDigits > 1 && angle < 10 ? '\u2007' : '') + degrees + '\u00B0' + compass;
}

export class SettingsDialog {
  private readonly dimmingStart: JQuery;
  private readonly dimmingEnd: JQuery;

  private dialog: JQuery;
  private currentCity: JQuery;
  private latitude: JQuery;
  private longitude: JQuery;
  private indoor: JQuery;
  private outdoor: JQuery;
  private userId: JQuery;
  private dimming: JQuery;
  private dimmingTo: JQuery;
  private temperature: JQuery;
  private hours: JQuery;
  private seconds: JQuery;
  private planets: JQuery;
  private searchCity: JQuery;
  private submitSearch: JQuery;
  private searching: JQuery;
  private searchMessage: JQuery;
  private cityTableWrapper: JQuery;
  private cityTable: JQuery;
  private okButton: JQuery;
  private cancelButton: JQuery;
  private reloadButton: JQuery;

  private searchFieldFocused = false;
  private searchButtonFocused = false;

  constructor(private appService: AppService) {
    this.dialog = $('#settings-dialog');
    this.currentCity = $('#current-city');
    this.latitude = $('#latitude');
    this.longitude = $('#longitude');
    this.indoor = $('#indoor-option');
    this.outdoor = $('#outdoor-option');
    this.userId = $('#user-id');
    this.dimming = $('#dimming');
    this.dimmingStart = $('#dimming-start');
    this.dimmingTo = $('#dimming-to');
    this.dimmingEnd = $('#dimming-end');
    this.temperature = $('#temperature-option');
    this.hours = $('#hours-option');
    this.seconds = $('#seconds-option');
    this.planets = $('#planets-option');
    this.searchCity = $('#search-city');
    this.submitSearch = $('#submit-search');
    this.searching = $('.searching');
    this.searchMessage = $('#search-message');
    this.cityTableWrapper = $('.city-table-wrapper');
    this.cityTable = $('#city-table');
    this.okButton = $('#settings-ok');
    this.cancelButton = $('#settings-cancel');
    this.reloadButton = $('#settings-reload');

    this.searchCity.on('focus', () => this.searchFieldFocused = true);
    this.searchCity.on('blur', () => this.searchFieldFocused = false);
    this.submitSearch.on('focus', () => this.searchButtonFocused = true);
    this.submitSearch.on('blur', () => this.searchButtonFocused = false);

    this.dimming.on('change', () => {
      this.enableDimmingRange(this.dimming.val() !== '0');
    });

    this.hours.on('change', () => {
      const amPm = this.hours.val() === 'AMPM';

      SettingsDialog.fillInTimeChoices(this.dimmingStart, amPm);
      SettingsDialog.fillInTimeChoices(this.dimmingEnd, amPm);
    });

    $('#search').on('submit', event => {
      event.preventDefault();
      this.doSearch();
    });

    if (isIE()) {
      $('.user-options').children().each(function () {
        $(this).css('margin', '0 4px 4px 0');
      });
    }
    else if (isSafari()) {
      $('.user-options').css('grid-row-gap', '0');
    }
  }

  private doSearch(): void {
    const query = $.trim(this.searchCity.val() as string);

    if (query.length === 0)
      domAlert('Please enter a city or partial city name.');
    else {
      (this.searchCity as any).enable(false);
      (this.submitSearch as any).enable(false);
      this.searching.css('visibility', 'visible');
      this.searchMessage.html('&nbsp;');
      this.searchMessage.css('background-color', 'white');
      this.cityTableWrapper.hide();
      this.cityTable.html('');

      this.callSearchApi(query).then(response => {
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

        this.cityTable.html(rows);
        setTimeout(() => this.cityTableWrapper.scrollTop(0));
        this.cityTableWrapper.show();
        (this.submitSearch as any).enable(true);
        (this.searchCity as any).enable(true);
        this.searching.css('visibility', 'hidden');

        if (response.error) {
          this.searchMessage.text(response.error);
          this.searchMessage.css('background-color', ERROR_BACKGROUND);
        }
        else if (response.warning) {
          this.searchMessage.text(response.warning);
          this.searchMessage.css('background-color', WARNING_BACKGROUND);
        }
        else if (response.limitReached) {
          this.searchMessage.text('Some matches are not displayed because the result limit was exceeded.');
          this.searchMessage.css('background-color', LIMIT_REACHED_BACKGROUND);
        }

        const self = this;

        this.cityTable.find('tr').each(function (index) {
          if (index !== 0) {
            const $this = $(this);

            $this.on('click', () => {
              self.currentCity.val($this.find('td.name').text().replace(/ \([^)]+\)/g, ''));
              self.latitude.val($this.data('lat'));
              self.longitude.val($this.data('lon'));
            });

            $this.on('dblclick', () => {
              self.okButton.trigger('click');
            });
          }
        });
      }).catch(reason => {
        (this.submitSearch as any).enable(true);
        (this.searchCity as any).enable(true);
        this.searching.css('visibility', 'hidden');
        domAlert(reason || 'Unable to access geographic database.');
      });
    }
  }

  private static fillInTimeChoices(selectElem: JQuery, amPm: boolean): void {
    const savedValue = selectElem.val();

    selectElem.empty();

    let options = '<option value="SR">Sunrise</option><option value="SS">Sunset</option>';

    for (let i = 0; i < 48; ++i) {
      const hour = Math.floor(i / 2);
      const minute = (i % 2 === 0 ? '00' : '30');
      let displayHour = hour.toString();
      let suffix = '';

      if (amPm) {
        if (hour < 12) {
          displayHour = (hour === 0 ? 12 : hour).toString();
          suffix = ' AM';
        }
        else {
          displayHour = (hour === 12 ? 12 : hour - 12).toString();
          suffix = ' PM';
        }
      }

      options += `<option value="${hour}:${minute}">${displayHour}:${minute}${suffix}</option>`;
    }

    selectElem.html(options);
    selectElem.val(savedValue);
  }

  private enableDimmingRange(enable: boolean): void {
    if (enable) {
      this.dimmingStart.removeAttr('disabled');
      this.dimmingTo.css('opacity', '1');
      this.dimmingEnd.removeAttr('disabled');
    }
    else {
      this.dimmingStart.attr('disabled', 'disabled');
      this.dimmingTo.css('opacity', '0.33');
      this.dimmingEnd.attr('disabled', 'disabled');
    }
  }

  public openSettings(previousSettings: Settings) {
    this.currentCity.val(previousSettings.city);
    this.latitude.val(previousSettings.latitude);
    this.longitude.val(previousSettings.longitude);
    this.indoor.val(previousSettings.indoorOption);
    this.outdoor.val(previousSettings.outdoorOption);
    this.userId.val(previousSettings.userId);
    this.temperature.val(previousSettings.celsius ? 'C' : 'F');
    this.hours.val(previousSettings.amPm ? 'AMPM' : '24');
    this.seconds.val(previousSettings.hideSeconds ? 'H' : 'S');
    this.planets.val(previousSettings.hidePlanets ? 'H' : 'S');
    (this.submitSearch as any).enable(true);
    (this.searchCity as any).enable(true);
    this.searchCity.val('');
    this.searchMessage.html('&nbsp;');
    this.searchMessage.css('background-color', 'white');
    this.cityTableWrapper.hide();
    this.searching.css('visibility', 'hidden');
    this.dialog.css('display', 'block');
    setTimeout(() => this.searchCity.trigger('focus'));

    SettingsDialog.fillInTimeChoices(this.dimmingStart, previousSettings.amPm);
    SettingsDialog.fillInTimeChoices(this.dimmingEnd, previousSettings.amPm);
    this.enableDimmingRange(!!previousSettings.dimming);
    this.dimming.val(previousSettings.dimming.toString());
    this.dimmingStart.val(previousSettings.dimmingStart);
    this.dimmingEnd.val(previousSettings.dimmingEnd);

    pushKeydownListener((event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault();
        this.cancelButton.trigger('click');
      }
      else if (event.code === 'Enter' && !this.searchFieldFocused && !this.searchButtonFocused) {
        event.preventDefault();
        this.okButton.trigger('click');
      }
    });

    const doOK = () => {
      const newSettings = new Settings();

      newSettings.city = (this.currentCity.val() as string).trim();
      newSettings.latitude = Number(this.latitude.val());
      newSettings.longitude = Number(this.longitude.val());
      newSettings.indoorOption = this.indoor.val() as string;
      newSettings.outdoorOption = this.outdoor.val() as string;
      newSettings.userId = this.userId.val() as string;
      newSettings.dimming = +this.dimming.val();
      newSettings.dimmingStart = this.dimmingStart.val() as string;
      newSettings.dimmingEnd = this.dimmingEnd.val() as string;
      newSettings.celsius = (this.temperature.val() as string) === 'C';
      newSettings.amPm = (this.hours.val() as string) === 'AMPM';
      newSettings.hideSeconds = (this.seconds.val() as string) === 'H';
      newSettings.hidePlanets = (this.planets.val() as string) === 'H';

      if (!newSettings.city) {
        domAlert('Current city must be specified.');
        this.currentCity.trigger('focus');
      }
      else if (isNaN(newSettings.latitude) || newSettings.latitude < -90 || newSettings.latitude > 90) {
        domAlert('A valid latitude must be provided from -90 to 90 degrees.');
        this.latitude.trigger('focus');
      }
      else if (isNaN(newSettings.longitude) || newSettings.longitude < -180 || newSettings.longitude > 180) {
        domAlert('A valid longitude must be provided from -180 to 180 degrees.');
        this.longitude.trigger('focus');
      }
      else {
        popKeydownListener();
        this.okButton.off('click', doOK);
        this.dialog.css('display', 'none');
        this.appService.updateSettings(newSettings);
      }
    };

    this.okButton.on('click', doOK);

    this.cancelButton.one('click', () => {
      popKeydownListener();
      this.okButton.off('click', doOK);
      this.dialog.css('display', 'none');
    });

    this.reloadButton.one('click', () => {
      window.location.reload();
    });
  }

  private callSearchApi(query: string): Promise<SearchResults> {
    // Note: The API below is not meant for high traffic use. Use of this API for looking up geographic locations is subject
    // to future change and access restrictions. Users of this code should strongly consider substituting a different API.
    const url = 'https://skyviewcafe.com/atlas';

    return new Promise((resolve, reject) => {
      // noinspection JSIgnoredPromiseFromCall
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
}
