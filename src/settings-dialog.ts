import { AppService } from './app.service';
import { HourlyForecast, TimeFormat } from './shared-types';
import $ from 'jquery';
import { Keyboard } from './keyboard';
import {
  apiServer, localServer, MAX_RECENT_LOCATIONS, raspbianChromium, RecentLocation, Settings, toTimeFormat, updateTest
} from './settings';
import { AWC_VERSION, AwcDefaults } from '../server/src/shared-types';
import {
  adjustCityName, ClickishEvent, decrementDialogCounter, domAlert, domConfirm, getJson, htmlEncode, incrementDialogCounter,
  popKeydownListener, pushKeydownListener
} from './awc-util';
import { abs } from '@tubular/math';
import { clone, isEqual, toBoolean, toNumber } from '@tubular/util';

const ERROR_BACKGROUND = '#FCC';
const WARNING_BACKGROUND = '#FFC';
const LIMIT_REACHED_BACKGROUND = '#FC9';

const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

async function callSearchApi(query: string): Promise<SearchResults> {
  // Note: The API below is not meant for high traffic use. Use of this API for looking up geographic locations
  // is subject to future change and access restrictions. Users of this code should strongly consider substituting
  // a different API.
  const results = await getJson<SearchResults>('https://skyviewcafe.com/atlas',
    { jsonp: true, params: { q: query, client: 'web', pt: 'false' } });
  const matches = results.matches ?? [];
  const sameNames = new Map<string, number[]>();
  const deletions: number[] = [];

  // Eliminate duplicates
  matches.forEach((loc, index) => {
    if (sameNames.has(loc.displayName))
      sameNames.get(loc.displayName).push(index);
    else
      sameNames.set(loc.displayName, [index]);
  });

  sameNames.forEach(indices => {
    for (let i = indices.length - 1; i > 0; --i) {
      for (let j = 0; j < i; ++j) {
        if (abs(matches[indices[i]].latitude - matches[indices[j]].latitude) <= 0.03 &&
            abs(matches[indices[i]].longitude - matches[indices[j]].longitude) <= 0.03) {
          deletions.push(indices[i]);
          break;
        }
      }
    }
  });

  deletions.sort((a, b) => b - a);
  deletions.forEach(i => matches.splice(i, 1));

  return results;
}

function formatDegrees(angle, compassPointsPosNeg, degreeDigits): string {
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
  private readonly tabs: JQuery;
  private readonly tabPanels: JQuery;
  private currentCity: JQuery;
  private onscreenKB: JQuery;
  private latitude: JQuery;
  private longitude: JQuery;
  private indoor: JQuery;
  private outdoor: JQuery;
  private indoorOutdoorOptions: JQuery;
  private colorOptions: JQuery;
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
  private weatherService: JQuery;
  private showSkyMap: JQuery;
  private floatHands: JQuery;
  private drawConstellations: JQuery;
  private skyColors: JQuery;
  private skyFacing: JQuery;
  private readonly searchCity: JQuery;
  private submitSearch: JQuery;
  private getGps: JQuery;
  private searching: JQuery;
  private searchMessage: JQuery;
  private cityTableWrapper: JQuery;
  private cityTable: JQuery;
  private lastCityClick: JQuery;
  private okButton: JQuery;
  private cancelButton: JQuery;
  private reloadButton: JQuery;
  private readonly quitButton: JQuery;
  private readonly rebootButton: JQuery;
  private readonly shutdownButton: JQuery;
  private readonly updateButton: JQuery;
  private readonly updateBtnBackdrop: JQuery;
  private keyboard: Keyboard;

  private activeTab = 0;
  private previousSettings: Settings;
  private latestVersion = AWC_VERSION;
  private defaultLocation: any;
  private recentLocations: RecentLocation[] = [];
  private searchFieldFocused = false;
  private searchButtonFocused = false;
  private updateFocused = false;
  private weatherServices = '';
  private serviceSetting = '';

  constructor(private appService: AppService) {
    this.keyboard = new Keyboard();

    this.dialog = $('#settings-dialog ');
    this.tabs = $('#settings-dialog .my-tabs li');
    this.tabPanels = $('#settings-dialog .tab-wrapper .tab-panel');
    this.keyboard.setTopElement(this.dialog[0]);
    this.currentCity = $('#current-city');
    this.onscreenKB = $('#onscreen-kb');
    this.latitude = $('#latitude');
    this.longitude = $('#longitude');
    this.indoor = $('#indoor-option');
    this.outdoor = $('#outdoor-option');
    this.indoorOutdoorOptions = $('.indoor-outdoor-options');
    this.colorOptions = $('#color-options');
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
    this.weatherService = $('#weather-service-option');
    this.showSkyMap = $('#sky-map-option');
    this.floatHands = $('#float-hands-option');
    this.drawConstellations = $('#constellations-option');
    this.skyColors = $('#sky-colors-option');
    this.skyFacing = $('#sky-facing-option');
    this.searchCity = $('#search-city');
    this.submitSearch = $('#submit-search');
    this.getGps = $('#get-gps');
    this.searching = $('.searching');
    this.searchMessage = $('#search-message');
    this.cityTableWrapper = $('.city-table-wrapper');
    this.cityTable = $('#city-table > tbody');
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
    this.tabs.on('click', (evt) => this.tabClicked(evt));

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

    const adminAction = (btn: JQuery, msg: string, cmd: string, optionalHtml?: string): void => {
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
      this.indoorOutdoorOptions.css('opacity', '0');
      this.indoorOutdoorOptions.css('pointer-events', 'none');
      this.colorOptions.addClass('center-color-options');

      appService.proxySensorUpdate().then(available => {
        if (available) {
          this.indoorOutdoorOptions.css('opacity', '1');
          this.indoorOutdoorOptions.css('pointer-events', 'auto');
          this.colorOptions.removeClass('center-color-options');
        }
      });
    }

    let dayOfWeekCheckboxes = '';

    for (let i = 0; i < 7; ++i) {
      const id = 'dow_cb_' + i;

      dayOfWeekCheckboxes += `<input id="${id}" type="checkbox"><label for="${id}">${days[i]}</label>`;

      if (i === 3)
        dayOfWeekCheckboxes += '<div class="break"></div>';
    }

    $('.day-of-week-panel').html(dayOfWeekCheckboxes);
  }

  private doSearch(): void {
    const query = (this.searchCity.val() as string).trim();

    if (query.length === 0)
      this.alert('Please enter a city or partial city name.');
    else {
      this.searchCity.enable(false);
      this.submitSearch.enable(false);
      this.searching.css('visibility', 'visible');
      this.searchMessage.html('&nbsp;');
      this.searchMessage.css('background-color', 'white');
      this.cityTableWrapper.hide();
      this.cityTable.html('');
      this.keyboard.hide();

      callSearchApi(query).then(response => {
        let rows = '';

        response.matches.forEach((city, index) => {
          rows +=
`<tr data-lat="${city.latitude}"
    data-lon="${city.longitude}"${response.matches.length > 6 && Math.floor(index / 3) % 2 === 0 ? '\n    class=rowguide' : ''}>
  <td>${city.rank}</td>
  <td class="name">${htmlEncode(city.displayName)}</td>
  <td class="coordinates">${formatDegrees(city.latitude, 'NS', 2)}</td>
  <td class="coordinates">${formatDegrees(city.longitude, 'EW', 3)}</td>
</tr>\n`;
        });

        this.cityTable.html(rows);
        this.lastCityClick = undefined;
        setTimeout(() => this.cityTableWrapper.scrollTop(0));
        this.cityTableWrapper.show();
        this.submitSearch.enable(true);
        this.searchCity.enable(true);
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

              if (self.lastCityClick)
                self.lastCityClick.removeClass('city-highlight');

              $this.addClass('city-highlight');
              self.lastCityClick = $this;
            });

            $this.on('dblclick', () => {
              self.okButton.trigger('click');
            });
          }
        });
      }).catch(reason => {
        this.submitSearch.enable(true);
        this.searchCity.enable(true);
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

  private tabClicked(evt: ClickishEvent): void {
    this.selectTab(this.tabs.index(evt.target));
  }

  private selectTab(tabIndex: number): void {
    this.activeTab = tabIndex;
    this.tabs.removeClass('tab-active');
    this.tabs.eq(tabIndex).addClass('tab-active');
    this.tabPanels.css('visibility', 'hidden');
    this.tabPanels.eq(tabIndex).css('visibility', 'visible');
  }

  public openSettings(previousSettings: Settings, emphasizeUpdate = false): void {
    this.previousSettings = previousSettings;
    this.selectTab(0);

    const checkUiSizing = (): void => {
      if (this.currentCity[0].offsetHeight === 0)
        setTimeout(checkUiSizing, 10);
      else if (this.currentCity[0].offsetHeight >= 22.5)
        this.dialog.addClass('compact-ui');
    };

    checkUiSizing();

    this.background.val(previousSettings.background);
    this.temperature.val(previousSettings.knots ? (previousSettings.celsius ? 'CK' : 'FK') : (previousSettings.celsius ? 'C' : 'F'));
    this.currentCity.val(previousSettings.city);
    this.clockFace.val(previousSettings.clockFace);
    this.drawConstellations.prop('checked', previousSettings.drawConstellations);
    this.floatHands.prop('checked', previousSettings.floatHands);
    this.planets.val(previousSettings.hidePlanets ? 'H' : 'S');
    this.seconds.val(previousSettings.hideSeconds ? 'H' : 'S');
    this.hourlyForecast.val(previousSettings.hourlyForecast);
    this.indoor.val(previousSettings.indoorOption);
    this.latitude.val(previousSettings.latitude);
    this.longitude.val(previousSettings.longitude);
    this.onscreenKB.prop('checked', previousSettings.onscreenKB);
    this.outdoor.val(previousSettings.outdoorOption);
    this.recentLocations = clone(previousSettings.recentLocations);
    this.serviceSetting = previousSettings.service;
    this.skyColors.val(previousSettings.showSkyColors.toString());
    this.showSkyMap.prop('checked', previousSettings.showSkyMap);
    this.skyFacing.val(previousSettings.skyFacing);
    this.format.val(['24', 'AMPM', 'UTC'][previousSettings.timeFormat] ?? '24');
    this.userId.val(previousSettings.userId);

    this.keyboard.enable(previousSettings.onscreenKB);
    this.enableAutocomplete(!previousSettings.onscreenKB);
    this.updateWeatherServiceSelection();
    this.submitSearch.enable(true);
    this.getGps.enable(false);
    this.defaultLocation = undefined;
    this.getDefaults();
    this.searchCity.enable(true);
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

    this.reloadButton.on('click', () => setTimeout(() => window.location.reload()));

    let recentHtml = '<label>Recent locations:</label>';

    this.recentLocations.forEach(loc => {
      recentHtml += `<div class="recent-location">${htmlEncode(loc.city)}<span>✕</span></div>`;
    });

    $('.recent-locations').html(recentHtml).find('.recent-location').each((index, elem) => {
      elem.addEventListener('click', evt => {
        if ((evt.target as HTMLElement).localName === 'span') {
          this.recentLocations.splice(index, 1);
          (evt.target as HTMLElement).parentElement.remove();
        }
        else {
          const loc = this.recentLocations[index];

          this.currentCity.val(loc.city);
          this.latitude.val(loc.latitude);
          this.longitude.val(loc.longitude);
          this.selectTab(0);
        }
      });
    });
  }

  private updateWeatherServiceSelection(): void {
    let service = this.serviceSetting;

    if (service && this.weatherServices.indexOf(service) < 0)
      service = '';

    setTimeout(() => this.weatherService.val(service));
  }

  private doOK = (): void => {
    const newSettings = new Settings();

    newSettings.background = this.background.val() as string;
    newSettings.celsius = (this.temperature.val() as string || '').startsWith('C');
    newSettings.city = (this.currentCity.val() as string).trim();
    newSettings.clockFace = this.clockFace.val() as string;
    newSettings.dimming = +this.dimming.val();
    newSettings.dimmingEnd = this.dimmingEnd.val() as string;
    newSettings.dimmingStart = this.dimmingStart.val() as string;
    newSettings.drawConstellations = this.drawConstellations.is(':checked');
    newSettings.floatHands = this.floatHands.is(':checked');
    newSettings.hidePlanets = (this.planets.val() as string) === 'H';
    newSettings.hideSeconds = (this.seconds.val() as string) === 'H';
    newSettings.hourlyForecast = this.hourlyForecast.val() as HourlyForecast;
    newSettings.indoorOption = this.indoor.val() as string;
    newSettings.knots = (this.temperature.val() as string || '').endsWith('K');
    newSettings.latitude = toNumber(this.latitude.val());
    newSettings.longitude = toNumber(this.longitude.val());
    newSettings.onscreenKB = this.onscreenKB.is(':checked');
    newSettings.outdoorOption = this.outdoor.val() as string;
    newSettings.service = this.weatherService.val() as string;
    newSettings.showSkyColors = toBoolean(this.skyColors.val() as string);
    newSettings.showSkyMap = this.showSkyMap.is(':checked');
    newSettings.skyFacing = toNumber(this.skyFacing.val() as string);
    newSettings.timeFormat = toTimeFormat(this.format.val() as string);
    newSettings.userId = this.userId.val() as string;

    if (newSettings.hourlyForecast === HourlyForecast.CIRCULAR && newSettings.showSkyMap)
      newSettings.hourlyForecast = HourlyForecast.VERTICAL;

    if (!newSettings.city) {
      this.alert('Current city must be specified.', () => {
        this.selectTab(0);
        this.currentCity.trigger('focus');
      });

      return;
    }
    else if (isNaN(newSettings.latitude) || newSettings.latitude < -90 || newSettings.latitude > 90) {
      this.selectTab(0);
      this.alert('A valid latitude must be provided from -90 to 90 degrees.', () =>
        this.latitude.trigger('focus'));

      return;
    }
    else if (isNaN(newSettings.longitude) || newSettings.longitude < -180 || newSettings.longitude > 180) {
      this.selectTab(0);
      this.alert('A valid longitude must be provided from -180 to 180 degrees.', () =>
        this.longitude.trigger('focus'));

      return;
    }

    const newLocation = { city: newSettings.city, latitude: newSettings.latitude, longitude: newSettings.longitude };
    const match = this.recentLocations.findIndex(loc => isEqual(loc, newLocation));

    if (match >= 0)
      this.recentLocations.splice(match, 1);

    this.recentLocations.splice(0, 0, newLocation);

    if (this.recentLocations.length > MAX_RECENT_LOCATIONS)
      this.recentLocations.splice(-1, 1);

    newSettings.recentLocations = this.recentLocations;
    decrementDialogCounter();
    popKeydownListener();
    this.okButton.off('click', this.doOK);
    this.dialog.css('display', 'none');
    this.appService.updateSettings(newSettings);
  };

  private doReturnAction = (): void => {
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

  private getDefaults(): void {
    getJson<AwcDefaults>(`${apiServer}/defaults`).then(data => {
      this.updateButton.css('display', (data.allowAdmin && raspbianChromium) || updateTest ? 'inline' : 'none');
      this.updateButton.prop('disabled', !data.updateAvailable && !updateTest);
      this.shutdownButton.css('display', data.allowAdmin ? 'inline' : 'none');
      this.rebootButton.css('display', data.allowAdmin ? 'inline' : 'none');
      this.quitButton.css('display', data.allowAdmin && raspbianChromium ? 'inline' : 'none');
      this.latestVersion = data.latestVersion;
      this.weatherServices = data.services;

      let weatherOptions = '<option value="">Default weather service</option>\n';

      if (data.services && data.services.length > 2) {
        this.weatherService.removeAttr('disabled');
        weatherOptions += '<option value="wu">Weather Underground</option>\n';

        if (data.services?.includes('vc'))
          weatherOptions += '<option value="vc">Visual Crossing</option>\n';

        if (data.services?.includes('we'))
          weatherOptions += '<option value="we">Weatherbit.io</option>\n';

        this.updateWeatherServiceSelection();
      }
      else
        this.weatherService.attr('disabled', 'disabled');

      this.weatherService.html(weatherOptions);

      if (data?.latitude != null && data?.longitude != null) {
        this.defaultLocation = data;
        this.getGps.enable(true);
      }
    })
      .catch(err => console.error(err));
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
