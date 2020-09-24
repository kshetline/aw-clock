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
import { TimeFormat } from './clock';
import { HourlyForecast } from './forecast';
import $ from 'jquery';
import { Keyboard } from './keyboard';
import { isIE, isIOS, isSafari } from 'ks-util';
import { apiServer, localServer, raspbianChromium, Settings, toTimeFormat, updateTest } from './settings';
import { AWC_VERSION } from '../server/src/shared-types';
import {
  adjustCityName, decrementDialogCounter, domAlert, domConfirm, htmlEncode, incrementDialogCounter, popKeydownListener, pushKeydownListener
} from './util';

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

const UPDATE_OPTIONS = `<br>
<input type="checkbox" id="interactive-update" name="interactive-update">
<label for="interactive-update">Interactive update</label><br>
<p>Use the interactive mode if you want to change settings, or configure
new settings. A keyboard will be required.`;

export class SettingsDialog {
  private readonly dimmingStart: JQuery;
  private readonly dimmingEnd: JQuery;

  private readonly dialog: JQuery;
  private currentCity: JQuery;
  private onscreenKB: JQuery;
  private latitude: JQuery;
  private longitude: JQuery;
  private indoor: JQuery;
  private outdoor: JQuery;
  private indoorOutdoorOptions: JQuery;
  private background: JQuery;
  private clockFace: JQuery;
  private userId: JQuery;
  private dimming: JQuery;
  private dimmingTo: JQuery;
  private temperature: JQuery;
  private format: JQuery;
  private seconds: JQuery;
  private planets: JQuery;
  private hourlyForecast: JQuery;
  private searchSection: JQuery;
  private readonly searchCity: JQuery;
  private submitSearch: JQuery;
  private getGps: JQuery;
  private searching: JQuery;
  private searchMessage: JQuery;
  private cityTableWrapper: JQuery;
  private cityTable: JQuery;
  private okButton: JQuery;
  private cancelButton: JQuery;
  private reloadButton: JQuery;
  private readonly quitButton: JQuery;
  private readonly rebootButton: JQuery;
  private readonly shutdownButton: JQuery;
  private readonly updateButton: JQuery;
  private readonly updateBtnBackdrop: JQuery;
  private keyboard: Keyboard;

  private previousSettings: Settings;
  private latestVersion = AWC_VERSION;
  private defaultLocation: any;
  private searchFieldFocused = false;
  private searchButtonFocused = false;
  private updateFocused = false;

  constructor(private appService: AppService) {
    this.keyboard = new Keyboard();

    this.dialog = $('#settings-dialog');
    this.keyboard.setTopElement(this.dialog[0]);
    this.currentCity = $('#current-city');
    this.onscreenKB = $('#onscreen-kb');
    this.latitude = $('#latitude');
    this.longitude = $('#longitude');
    this.indoor = $('#indoor-option');
    this.outdoor = $('#outdoor-option');
    this.indoorOutdoorOptions = $('.indoor-outdoor-options');
    this.background = $('#app-background');
    this.clockFace = $('#clock-background');
    this.userId = $('#user-id');
    this.dimming = $('#dimming');
    this.dimmingStart = $('#dimming-start');
    this.dimmingTo = $('#dimming-to');
    this.dimmingEnd = $('#dimming-end');
    this.temperature = $('#temperature-option');
    this.format = $('#format-option');
    this.seconds = $('#seconds-option');
    this.planets = $('#planets-option');
    this.hourlyForecast = $('#hourly-forecast-option');
    this.searchSection = $('.search-section');
    this.searchCity = $('#search-city');
    this.submitSearch = $('#submit-search');
    this.getGps = $('#get-gps');
    this.searching = $('.searching');
    this.searchMessage = $('#search-message');
    this.cityTableWrapper = $('.city-table-wrapper');
    this.cityTable = $('#city-table');
    this.okButton = $('#settings-ok');
    this.cancelButton = $('#settings-cancel');
    this.reloadButton = $('#settings-reload');
    this.quitButton = $('#settings-quit');
    this.rebootButton = $('#settings-reboot');
    this.shutdownButton = $('#settings-shutdown');
    this.updateButton = $('#settings-update');
    this.updateBtnBackdrop = $('#update-btn-backdrop');

    this.searchCity.on('focus', () => this.searchFieldFocused = true);
    this.searchCity.on('blur', () => this.searchFieldFocused = false);
    this.submitSearch.on('focus', () => this.searchButtonFocused = true);
    this.submitSearch.on('blur', () => this.searchButtonFocused = false);
    this.updateButton.on('focus', () => this.updateFocused = true);
    this.updateButton.on('blur', () => this.updateFocused = false);
    this.getGps.on('click', () => this.fillInGpsLocation());

    $('.version-number').text(AWC_VERSION);

    this.dimming.on('change', () => {
      this.enableDimmingRange(this.dimming.val() !== '0');
    });

    this.format.on('change', () => {
      const amPm = this.format.val() === 'AMPM';

      SettingsDialog.fillInTimeChoices(this.dimmingStart, amPm);
      SettingsDialog.fillInTimeChoices(this.dimmingEnd, amPm);
    });

    $('#search').on('submit', event => {
      event.preventDefault();
      this.doSearch();
    });

    const adminAction = (btn: JQuery, msg: string, cmd: string, optionalHtml?: string) => {
      btn.on('click', () => {
        const message = msg.replace(/%v/g, this.latestVersion);

        domConfirm(message, optionalHtml, yep => {
          if (yep) {
            let command = cmd;

            if (/^update\b/.test(cmd)) {
              const checkbox = $('#interactive-update');

              if (checkbox.prop('checked'))
                command += (cmd.includes('?') ? '&' : '?') + 'ia=true';
            }

            $.ajax({
              type: 'POST',
              dataType: 'text',
              url: this.appService.getApiServer() + `/admin/${command}`,
              error: (jqXHR: JQueryXHR) => {
                this.alert(jqXHR.responseText);
              }
            });
          }
        });
      });
    };

    adminAction(this.updateButton, 'Are you sure you want to update A/W Clock version %v now?\n\n' +
      'Your system will be rebooted.', 'update' + (updateTest ? '?ut=true' : ''), UPDATE_OPTIONS);
    adminAction(this.shutdownButton, 'Are you sure you want to shut down?', 'shutdown');
    adminAction(this.rebootButton, 'Are you sure you want to reboot?', 'reboot');
    adminAction(this.quitButton, 'Are you sure you want to quit the Chromium web browser?', 'quit');

    if (!localServer) {
      // Hide indoor/outdoor options by default if this isn't a local server, but check if proxied data
      // is available, and if so, bring the options back.
      this.indoorOutdoorOptions.css('display', 'none');
      this.searchSection.addClass('no-indoor-outdoor');

      appService.proxySensorUpdate().then(available => {
        if (available) {
          this.indoorOutdoorOptions.css('display', 'block');
          this.searchSection.removeClass('no-indoor-outdoor');
        }
      });
    }

    if (isIE()) {
      $('.user-options').children().each(function () {
        $(this).css('margin', '0 4px 4px 0');
      });
    }
    else if (isSafari()) {
      $('.user-options').addClass(isIOS() ? 'squeeze-user-options-more' : 'squeeze-user-options');
    }
  }

  private doSearch(): void {
    const query = $.trim(this.searchCity.val() as string);

    if (query.length === 0)
      this.alert('Please enter a city or partial city name.');
    else {
      (this.searchCity as any).enable(false);
      (this.submitSearch as any).enable(false);
      this.searching.css('visibility', 'visible');
      this.searchMessage.html('&nbsp;');
      this.searchMessage.css('background-color', 'white');
      this.cityTableWrapper.hide();
      this.cityTable.html('');
      this.keyboard.hide();

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
        this.alert(reason || 'Unable to access geographic database.');
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

  public openSettings(previousSettings: Settings, emphasizeUpdate = false) {
    this.previousSettings = previousSettings;

    const checkUiSizing = () => {
      if (this.currentCity[0].offsetHeight === 0)
        setTimeout(checkUiSizing, 10);
      else if (this.currentCity[0].offsetHeight >= 22.5)
        this.dialog.addClass('compact-ui');
    };

    checkUiSizing();

    this.currentCity.val(previousSettings.city);
    this.latitude.val(previousSettings.latitude);
    this.longitude.val(previousSettings.longitude);
    this.indoor.val(previousSettings.indoorOption);
    this.background.val(previousSettings.background);
    this.clockFace.val(previousSettings.clockFace);
    this.outdoor.val(previousSettings.outdoorOption);
    this.userId.val(previousSettings.userId);
    this.temperature.val(previousSettings.celsius ? 'C' : 'F');
    this.format.val(['24', 'AMPM', 'UTC'][previousSettings.timeFormat] ?? '24');
    this.seconds.val(previousSettings.hideSeconds ? 'H' : 'S');
    this.planets.val(previousSettings.hidePlanets ? 'H' : 'S');
    this.hourlyForecast.val(previousSettings.hourlyForecast);
    this.onscreenKB.prop('checked', previousSettings.onscreenKB);
    this.keyboard.enable(previousSettings.onscreenKB);

    this.enableAutocomplete(!previousSettings.onscreenKB);

    (this.submitSearch as any).enable(true);
    (this.getGps as any).enable(false);
    this.defaultLocation = undefined;
    this.getDefaults();
    (this.searchCity as any).enable(true);
    this.searchCity.val('');
    this.searchMessage.html('&nbsp;');
    this.searchMessage.css('background-color', 'white');
    this.cityTableWrapper.hide();
    this.searching.css('visibility', 'hidden');
    this.dialog.css('display', 'block');
    this.updateBtnBackdrop.css('display', emphasizeUpdate ? 'inline-block' : 'none');
    setTimeout(() =>
      (emphasizeUpdate ? this.updateButton : (previousSettings.onscreenKB ? this.okButton : this.searchCity)).trigger('focus'),
    500);

    SettingsDialog.fillInTimeChoices(this.dimmingStart, previousSettings.timeFormat === TimeFormat.AMPM);
    SettingsDialog.fillInTimeChoices(this.dimmingEnd, previousSettings.timeFormat === TimeFormat.AMPM);
    this.enableDimmingRange(!!previousSettings.dimming);
    this.dimming.val(previousSettings.dimming.toString());
    this.dimmingStart.val(previousSettings.dimmingStart);
    this.dimmingEnd.val(previousSettings.dimmingEnd);

    incrementDialogCounter();
    pushKeydownListener((event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault();
        this.cancelButton.trigger('click');
      }
      else if (event.code === 'Enter' && !this.searchFieldFocused && !this.searchButtonFocused && !this.updateFocused) {
        event.preventDefault();
        this.okButton.trigger('click');
      }
    });

    this.okButton.on('click', this.doOK);
    this.keyboard.addEnterListener(this.doReturnAction);
    this.onscreenKB.on('click', () => setTimeout(() => {
      const checked = this.onscreenKB.is(':checked');

      this.keyboard.enable(checked);
      this.previousSettings.onscreenKB = checked;
      this.enableAutocomplete(!checked);
      // "Onscreen keyboard" state is immediately saved, whether or not the dialog is OKed or canceled.
      this.appService.updateSettings(this.previousSettings);
    }));

    this.cancelButton.one('click', () => {
      decrementDialogCounter();
      popKeydownListener();
      this.okButton.off('click', this.doOK);
      this.dialog.css('display', 'none');
    });

    this.reloadButton.one('click', () => {
      window.location.reload();
    });
  }

  private doOK = () => {
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
    newSettings.timeFormat = toTimeFormat(this.format.val() as string);
    newSettings.hideSeconds = (this.seconds.val() as string) === 'H';
    newSettings.hidePlanets = (this.planets.val() as string) === 'H';
    newSettings.hourlyForecast = this.hourlyForecast.val() as HourlyForecast;
    newSettings.onscreenKB = this.onscreenKB.is(':checked');
    newSettings.background = this.background.val() as string;
    newSettings.clockFace = this.clockFace.val() as string;

    if (!newSettings.city)
      this.alert('Current city must be specified.', () => this.currentCity.trigger('focus'));
    else if (isNaN(newSettings.latitude) || newSettings.latitude < -90 || newSettings.latitude > 90) {
      this.alert('A valid latitude must be provided from -90 to 90 degrees.', () =>
        this.latitude.trigger('focus'));
    }
    else if (isNaN(newSettings.longitude) || newSettings.longitude < -180 || newSettings.longitude > 180) {
      this.alert('A valid longitude must be provided from -180 to 180 degrees.', () =>
        this.longitude.trigger('focus'));
    }
    else {
      decrementDialogCounter();
      popKeydownListener();
      this.okButton.off('click', this.doOK);
      this.dialog.css('display', 'none');
      this.appService.updateSettings(newSettings);
    }
  };

  private doReturnAction = () => {
    if (this.updateFocused)
      this.updateButton.trigger('click');
    else if (this.searchFieldFocused)
      this.doSearch();
    else
      this.doOK();
  };

  private alert(message: string, callback?: () => void): void {
    this.keyboard.hide();
    domAlert(message, callback);
  }

  private callSearchApi(query: string): Promise<SearchResults> {
    // Note: The API below is not meant for high traffic use. Use of this API for looking up geographic locations
    // is subject to future change and access restrictions. Users of this code should strongly consider substituting
    // a different API.
    const url = 'https://skyviewcafe.com/atlas';

    return new Promise((resolve, reject) => {
      // noinspection JSIgnoredPromiseFromCall
      $.ajax({
        url,
        dataType: 'jsonp',
        data: {
          q: query,
          client: 'web',
          pt: 'false'
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

  private getDefaults(): void {
    const url = `${apiServer}/defaults`;

    $.ajax({
      url,
      dataType: 'json',
      success: (data: any) => {
        this.updateButton.css('display', (data.allowAdmin && raspbianChromium) || updateTest ? 'inline' : 'none');
        this.updateButton.prop('disabled', !data.updateAvailable && !updateTest);
        this.shutdownButton.css('display', data.allowAdmin ? 'inline' : 'none');
        this.rebootButton.css('display', data.allowAdmin ? 'inline' : 'none');
        this.quitButton.css('display', data.allowAdmin && raspbianChromium ? 'inline' : 'none');
        this.latestVersion = data.latestVersion;

        if (data?.latitude != null && data?.longitude != null) {
          this.defaultLocation = data;
          (this.getGps as any).enable(true);
        }
      },
      error: (jqXHR: JQueryXHR, textStatus: string, errorThrown: string) => {
        console.error(errorThrown);
      }
    });
  }

  private fillInGpsLocation(): void {
    if (this.defaultLocation) {
      this.currentCity.val(adjustCityName(this.defaultLocation.city));
      this.latitude.val(this.defaultLocation.latitude.toString());
      this.longitude.val(this.defaultLocation.longitude.toString());

      const gpsFlash = $('.gps-flash');

      gpsFlash.addClass('flash');
      setTimeout(() => gpsFlash.removeClass('flash'), 500);
    }
  }

  private enableAutocomplete(enabled: boolean): void {
    const texts = $(':text', this.dialog);

    if (enabled)
      texts.removeAttr('autocomplete');
    else
      texts.attr('autocomplete', 'off');
  }
}
