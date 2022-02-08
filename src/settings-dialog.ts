import { AppService } from './app.service';
import { HourlyForecast, TimeFormat } from './shared-types';
import $ from 'jquery';
import { Keyboard } from './keyboard';
import {
  AlarmInfo, apiServer, localServer, MAX_RECENT_LOCATIONS, raspbianChromium, RecentLocation, Settings,
  toTimeFormat, updateTest
} from './settings';
import { AWC_VERSION, AwcDefaults } from '../server/src/shared-types';
import {
  adjustCityName, ClickishEvent, decrementDialogCounter, domAlert, domConfirm, getJson, getText, incrementDialogCounter,
  popKeydownListener, pushKeydownListener, safeCompareVersions
} from './awc-util';
import { abs, floor, mod } from '@tubular/math';
import { clone, eventToKey, htmlEscape, isEqual, noop, toBoolean, toNumber } from '@tubular/util';
import ttime, { DateTime, isValidDate_SGC } from '@tubular/time';

const ERROR_BACKGROUND = '#FCC';
const WARNING_BACKGROUND = '#FFC';
const LIMIT_REACHED_BACKGROUND = '#FC9';

const days = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

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

// noinspection JSUnusedGlobalSymbols
enum Tab { OPTIONS, LOCATION, ALARMS, UPDATE }

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

function p2(n: number): string {
  return n.toString().padStart(2, '0');
}

function formatDegrees(angle, compassPointsPosNeg, degreeDigits): string {
  const compass = compassPointsPosNeg.charAt(angle < 0 ? 1 : 0);
  angle = Math.abs(angle);
  const degrees = angle.toFixed(3);
  angle = Number(degrees.split('.')[0]);

  return (degreeDigits > 2 && angle < 100 ? '\u2007' : '') +
    (degreeDigits > 1 && angle < 10 ? '\u2007' : '') + degrees + '\u00B0' + compass;
}

function numberKeyHandler(evt: JQuery.KeyDownEvent, elem: HTMLInputElement, mn: number, mx: number, inc: number): void {
  const keyCode = eventToKey(evt.originalEvent);

  if (keyCode.length === 1 && (keyCode < '0' || keyCode > '9')) {
    evt.preventDefault();
    return;
  }

  let val = toNumber(elem.value);
  let modified = false;
  const digits = 2 + (mx > 100 ? 2 : 0);

  if (keyCode === 'ArrowUp') {
    val += inc;
    modified = true;
  }
  else if (keyCode === 'ArrowDown') {
    val -= inc;
    modified = true;
  }

  if (modified) {
    val = floor(mod(val - mn, mx - mn + 1) / inc) * inc + mn;
    evt.stopPropagation();
    elem.value = p2(val);
    setTimeout(() => elem.setSelectionRange(0, digits));
  }
  else {
    setTimeout(() => {
      if (elem.value.length > digits) {
        if (elem.selectionStart === elem.selectionEnd && elem.selectionStart >= digits)
          elem.value = elem.value.substr(elem.selectionStart - digits, elem.selectionStart);
        else {
          elem.value = elem.value.substr(-digits);
          elem.setSelectionRange(digits, digits);
        }
      }
    });
  }
}

function formatAlarmTime(time: number, amPm: boolean): string {
  let hour = floor(time / 60) % 24;
  const minute = time % 60;
  let suffix = '';

  if (amPm && hour < 12) {
    hour = (hour === 0 ? 12 : hour);
    suffix = ' AM';
  }
  else if (amPm) {
    hour = (hour === 12 ? hour : hour - 12);
    suffix = ' PM';
  }

  return p2(hour) + ':' + p2(minute) + suffix;
}

function formatAlarmDate(time: number): string {
  return new DateTime(time * 60000, 'UTC').format('DD MMM yyyy');
}

function soundName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
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
  private readonly quitButton: JQuery;
  private readonly rebootButton: JQuery;
  private readonly searchCity: JQuery;
  private readonly shutdownButton: JQuery;
  private readonly tabPanels: JQuery;
  private readonly tabs: JQuery;
  private readonly updateBtnBackdrop: JQuery;
  private readonly updateButton: JQuery;

  private addAlarm: JQuery;
  private alarmAudio: JQuery;
  private alarmCancel: JQuery;
  private alarmDay: JQuery;
  private alarmDelete: JQuery;
  private alarmEdit: JQuery;
  private alarmHour: JQuery;
  private alarmList: JQuery;
  private alarmMessage: JQuery;
  private alarmMeridiem: JQuery
  private alarmMinute: JQuery;
  private alarmMonth: JQuery;
  private alarmSave: JQuery;
  private alarmSetPanel: JQuery;
  private alarmYear: JQuery;
  private background: JQuery;
  private cancelButton: JQuery;
  private cityTable: JQuery;
  private cityTableWrapper: JQuery;
  private clockFace: JQuery;
  private colorOptions: JQuery;
  private currentCity: JQuery;
  private dailyAlarmBtn: JQuery;
  private datePanel: JQuery;
  private dayOfWeekPanel: JQuery;
  private dimming: JQuery;
  private dimmingTo: JQuery;
  private drawConstellations: JQuery;
  private floatHands: JQuery;
  private format: JQuery;
  private getGps: JQuery;
  private hideUpdate: JQuery;
  private hourlyForecast: JQuery;
  private indoor: JQuery;
  private indoorOutdoorOptions: JQuery;
  private keyboard: Keyboard;
  private lastCityClick: JQuery;
  private latitude: JQuery;
  private longitude: JQuery;
  private okButton: JQuery;
  private oneTimeAlarmBtn: JQuery;
  private onscreenKB: JQuery;
  private outdoor: JQuery;
  private planets: JQuery;
  private play: JQuery;
  private reloadButton: JQuery;
  private searching: JQuery;
  private searchMessage: JQuery;
  private seconds: JQuery;
  private showSkyMap: JQuery;
  private skyColors: JQuery;
  private skyFacing: JQuery;
  private submitSearch: JQuery;
  private temperature: JQuery;
  private userId: JQuery;
  private weatherService: JQuery;

  private activeTab = Tab.OPTIONS;
  private alarmAmPm = false;
  private alarmEditing = false;
  private dailyAlarm = true;
  private defaultLocation: any;
  private editAlarm = -1;
  private latestVersion = AWC_VERSION;
  private newAlarms: AlarmInfo[] = [];
  private nowPlaying: HTMLAudioElement;
  private previousSettings: Settings;
  private recentLocations: RecentLocation[] = [];
  private searchFieldFocused = false;
  private searchButtonFocused = false;
  private serviceSetting = '';
  private selectedAlarm = -1;
  private updateFocused = false;
  private weatherServices = '';

  constructor(private appService: AppService) {
    this.keyboard = new Keyboard();

    this.alarmCancel = $('#alarm-cancel');
    this.alarmDay = $('#alarm-day');
    this.alarmDelete = $('#alarm-delete');
    this.alarmEdit = $('#alarm-edit');
    this.alarmHour = $('#alarm-hour');
    this.alarmList = $('#alarm-list');
    this.alarmMeridiem = $('#alarm-meridiem');
    this.alarmMessage = $('#alarm-message');
    this.alarmMinute = $('#alarm-minute');
    this.alarmMonth = $('#alarm-month');
    this.alarmSave = $('#alarm-save');
    this.alarmSetPanel = $('#alarm-set-panel');
    this.alarmYear = $('#alarm-year');
    this.background = $('#app-background');
    this.cancelButton = $('#settings-cancel');
    this.cityTable = $('#city-table > tbody');
    this.cityTableWrapper = $('.city-table-wrapper');
    this.clockFace = $('#clock-background');
    this.colorOptions = $('#color-options');
    this.currentCity = $('#current-city');
    this.datePanel = $('#date-panel');
    this.dayOfWeekPanel = $('#day-of-week-panel');
    this.dialog = $('#settings-dialog'); this.keyboard.setTopElement(this.dialog[0]);
    this.dimming = $('#dimming');
    this.dimmingEnd = $('#dimming-end');
    this.dimmingStart = $('#dimming-start');
    this.dimmingTo = $('#dimming-to');
    this.drawConstellations = $('#constellations-option');
    this.floatHands = $('#float-hands-option');
    this.format = $('#format-option');
    this.getGps = $('#get-gps');
    this.hourlyForecast = $('#hourly-forecast-option');
    this.indoor = $('#indoor-option');
    this.indoorOutdoorOptions = $('.indoor-outdoor-options');
    this.latitude = $('#latitude');
    this.longitude = $('#longitude');
    this.okButton = $('#settings-ok');
    this.onscreenKB = $('#onscreen-kb');
    this.outdoor = $('#outdoor-option');
    this.planets = $('#planets-option');
    this.quitButton = $('#settings-quit');
    this.rebootButton = $('#settings-reboot');
    this.reloadButton = $('#settings-reload');
    this.searchCity = $('#search-city');
    this.searching = $('.searching');
    this.searchMessage = $('#search-message');
    this.seconds = $('#seconds-option');
    this.showSkyMap = $('#sky-map-option');
    this.shutdownButton = $('#settings-shutdown');
    this.skyColors = $('#sky-colors-option');
    this.skyFacing = $('#sky-facing-option');
    this.submitSearch = $('#submit-search');
    this.tabPanels = $('#settings-dialog .tab-wrapper .tab-panel');
    this.tabs = $('#settings-dialog .my-tabs li');
    this.temperature = $('#temperature-option');
    this.updateBtnBackdrop = $('#update-btn-backdrop');
    this.updateButton = $('#settings-update');
    this.userId = $('#user-id');
    this.weatherService = $('#weather-service-option');

    this.searchCity.on('focus', () => this.searchFieldFocused = true);
    this.searchCity.on('blur', () => this.searchFieldFocused = false);
    this.submitSearch.on('focus', () => this.searchButtonFocused = true);
    this.submitSearch.on('blur', () => this.searchButtonFocused = false);
    this.updateButton.on('focus', () => this.updateFocused = true);
    this.updateButton.on('blur', () => this.updateFocused = false);
    this.getGps.on('click', () => this.fillInGpsLocation());
    this.tabs.on('click', (evt) => this.tabClicked(evt));

    this.dimming.on('change', () => {
      this.enableDimmingRange(this.dimming.val() !== '0');
    });

    this.format.on('change', () => {
      const amPm = this.format.val() === 'AMPM';

      SettingsDialog.fillInTimeChoices(this.dimmingStart, amPm);
      SettingsDialog.fillInTimeChoices(this.dimmingEnd, amPm);
      this.adjustAlarmTime(amPm);
      this.renderAlarmList(this.newAlarms);
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
    const sow = ttime.getStartOfWeek(ttime.defaultLocale);

    for (let i = 0; i < 7; ++i) {
      const ii = (i + sow) % 7;
      const id = 'dow_cb_' + ii;

      dayOfWeekCheckboxes += `<div><input id="${id}" type="checkbox" value="${days[ii]}"><label for="${id}">${days[ii]}</label></div>`;
    }

    this.dayOfWeekPanel.html(dayOfWeekCheckboxes);

    this.alarmAudio = $('.audio-selection > select');
    this.play = $('.audio-selection > button');

    getJson<string[]>(`${apiServer}/assets/audio`).then(data => {
      let options = data.reduce((prev, current) =>
        prev + `<option value="${current}">${soundName(current)}</option>`, '');

      options += '<option value="">(Silent)</option>';
      this.alarmAudio.html(options).on('change', () => {
        this.stopAudio();

        if (this.alarmAudio.val()) {
          this.play.css('opacity', '1');
          this.play.css('pointer-events', 'all');
        }
        else {
          this.play.css('opacity', '0.33');
          this.play.css('pointer-events', 'none');
        }
      });
    });

    this.play.on('click', () => {
      if (this.nowPlaying)
        this.stopAudio();
      else {
        let somewhatReady = false;
        let playStarted = false;

        this.nowPlaying = new Audio(`/assets/audio/${encodeURI(this.alarmAudio.val() as string)}`);

        this.nowPlaying.addEventListener('canplay', () => somewhatReady = true);
        this.nowPlaying.addEventListener('canplaythrough', () => !playStarted && (playStarted = true) && this.playAudio());
        this.nowPlaying.addEventListener('ended', () => this.stopAudio());
        this.nowPlaying.addEventListener('loadstart', () => somewhatReady = true);
        setTimeout(() => !playStarted && somewhatReady && (playStarted = true) && this.playAudio(), 333);
      }
    });

    this.addAlarm = $('#add-alarm');
    this.dailyAlarmBtn = $('#daily-alarm');
    this.oneTimeAlarmBtn = $('#one-time-alarm');

    this.addAlarm.on('click', () => {
      this.dailyAlarm = true;
      this.alarmEditing = true;
      this.addAlarm.prop('disabled', true);
      this.alarmSetPanel.css('opacity', '1');
      this.alarmSetPanel.css('pointer-events', 'all');
    });

    this.dailyAlarmBtn.on('click', () => {
      this.dailyAlarm = true;
      this.datePanel.css('display', 'none');
      this.dayOfWeekPanel.css('display', 'flex');
      this.dailyAlarmBtn.prop('checked', true);
      this.oneTimeAlarmBtn.prop('checked', false);
    });

    this.oneTimeAlarmBtn.on('click', () => {
      this.dailyAlarm = false;
      this.datePanel.css('display', 'flex');
      this.dayOfWeekPanel.css('display', 'none');
      this.dailyAlarmBtn.prop('checked', false);
      this.oneTimeAlarmBtn.prop('checked', true);
    });

    const self = this;

    this.alarmHour.on('keydown', function (evt) {
      if (self.alarmAmPm)
        numberKeyHandler(evt, this as HTMLInputElement, 1, 12, 1);
      else
        numberKeyHandler(evt, this as HTMLInputElement, 0, 23, 1);
    });

    this.alarmMinute.on('keydown', function (evt) { numberKeyHandler(evt, this as HTMLInputElement, 0, 59, 5); });

    this.alarmDay.on('keydown', function (evt) {
      const month = toNumber(self.alarmMonth.val());
      let year = toNumber(self.alarmYear.val(), -1);

      if (year < 0)
        year = new Date().getFullYear();

      numberKeyHandler(evt, this as HTMLInputElement, 1, new DateTime([year, month, 1]).getDaysInMonth(), 1);
    });

    this.alarmMonth.on('change', () => {
      const day = toNumber(this.alarmDay.val());
      const month = toNumber(this.alarmMonth.val());
      const year = toNumber(this.alarmYear.val(), -1);
      const days = new DateTime([year, month, 1]).getDaysInMonth();

      if (day > days)
        this.alarmDay.val(days);
      else if (day < 1)
        this.alarmDay.val('01');
    });

    this.alarmYear.on('keydown', function (evt) {
      const lowYear = new Date().getFullYear();

      numberKeyHandler(evt, this as HTMLInputElement, lowYear, lowYear + 1000, 1);
    });

    this.alarmSave.on('click', () => this.saveAlarm());
    this.alarmCancel.on('click', () => {
      this.stopAudio();
      this.editAlarm = -1;
      this.clearAlarmTime();
      this.alarmDelete.prop('disabled', this.selectedAlarm < 0);
      this.alarmEdit.prop('disabled', this.selectedAlarm < 0);
    });
    this.alarmDelete.on('click', () => this.deleteSelectedAlarm());
    this.alarmEdit.on('click', () => this.editSelectedAlarm());
  }

  private saveAlarm(): void {
    let hour = toNumber(this.alarmHour.val());
    const minute = toNumber(this.alarmMinute.val());
    const newAlarm = {
      enabled: this.editAlarm < 0 ? true : this.newAlarms[this.editAlarm].enabled,
      message: (this.alarmMessage.val() as string).trim(),
      sound: this.alarmAudio.val()
    } as AlarmInfo;

    if ((this.alarmAmPm && (hour < 1 || hour > 12)) ||
        (!this.alarmAmPm && (hour < 0 || hour > 23)) ||
        (minute < 0 || minute > 59)) {
      this.alert('Invalid alarm time.');
      return;
    }

    hour = (this.alarmAmPm ? hour - (hour === 12 ? 12 : 0) + (this.alarmMeridiem.val() === 'P' ? 12 : 0) : hour);
    newAlarm.time = hour * 60 + minute;

    if (this.dailyAlarm) {
      let days = '';

      this.dayOfWeekPanel.find('input[type=checkbox]').each((_index, elem: HTMLInputElement) => {
        if (elem.checked)
          days += elem.value + ' ';
      });

      if (!days) {
        this.alert('At least one day of the week must be selected.');
        return;
      }

      newAlarm.days = days.trim();
    }
    else {
      const day = toNumber(this.alarmDay.val());
      const month = toNumber(this.alarmMonth.val());
      const year = toNumber(this.alarmYear.val());

      if (year <= 0 || day <= 0 || !isValidDate_SGC(year, month, day)) {
        this.alert('Invalid date.');
        return;
      }

      if (new DateTime([year, month, day, hour, minute], this.appService.timezone).utcMillis < Date.now()) {
        this.alert('The date/time of this alarm has already passed.');
        return;
      }

      newAlarm.time += new DateTime([year, month, day], 'UTC').wallTime.n * 1440;
    }

    if (this.editAlarm < 0) {
      this.newAlarms.push(newAlarm);
      setTimeout(() => this.alarmList.scrollTop(Number.MAX_SAFE_INTEGER));
    }
    else {
      this.newAlarms[this.editAlarm] = newAlarm;
      this.editAlarm = -1;
    }

    this.selectAlarm(-1);
    this.renderAlarmList(this.newAlarms);
    this.clearAlarmTime();
  }

  private renderAlarmList(list: AlarmInfo[]): void {
    let alarmHtml = '';

    for (let i = 0; i < list.length; ++i) {
      const alarm = list[i];
      const time = formatAlarmTime(alarm.time, this.alarmAmPm);
      const days = alarm.time < 1440 ? alarm.days : formatAlarmDate(alarm.time);

      alarmHtml += `
<div class="alarm-item" data-index="${i}">
  <div>
    <span class="time">${time}</span>
    <span class="days">${days}</span>
    <span>
      <input type="checkbox" id="alarm-item-${i}" name="alarm-item-${i}"${alarm.enabled ? ' checked' : ''}>
      <label for="alarm-item-${i}">Enabled</label>
    </span>
  </div>
  <div>
    <span class="sound">${alarm.sound ? '🔈' : '🔇'} ${soundName(alarm.sound)}</span>
    <span class="message">${alarm.message ? '📜 ' + htmlEscape(alarm.message) : ''}</span>
  </div>
</div>
`;
    }

    this.alarmList.html(alarmHtml);
    this.alarmList.find('.alarm-item').each((index, elem) =>
      elem.addEventListener('click', () => this.selectAlarm(index)));
    this.alarmList.find('.alarm-item input[type="checkbox"]').each((index, elem) =>
      elem.addEventListener('click', evt => {
        this.newAlarms[index].enabled = !this.newAlarms[index].enabled;
        evt.stopPropagation();
      }));
  }

  private playAudio(): void {
    if (this.nowPlaying) {
      this.nowPlaying.play().catch(noop);
      this.play.text('⏹');
    }
  }

  private stopAudio(): void {
    if (this.nowPlaying) {
      this.nowPlaying.pause();
      this.nowPlaying.currentTime = 0;
      this.nowPlaying = undefined;
    }

    this.play.text('▶️');
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
  <td class="name">${htmlEscape(city.displayName)}</td>
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

        this.cityTable.find('tr').each(function () {
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
        });
      }).catch(reason => {
        this.submitSearch.enable(true);
        this.searchCity.enable(true);
        this.searching.css('visibility', 'hidden');
        this.alert(reason || 'Unable to access geographic database.');
      });
    }
  }

  private selectAlarm(index: number): void {
    if (index === this.selectedAlarm || this.editAlarm >= 0)
      return;

    if (this.selectedAlarm >= 0)
      $('.alarm-item.selected').removeClass('selected');

    if (index >= 0)
      $(`.alarm-item[data-index="${index}"]`).addClass('selected');

    this.alarmDelete.prop('disabled', index < 0);
    this.alarmEdit.prop('disabled', index < 0);
    this.selectedAlarm = index;
  }

  private adjustAlarmTime(amPm): void {
    const wasAmPm = this.alarmMeridiem.css('display') !== 'none';

    if (amPm === wasAmPm)
      return;

    const hour = toNumber(this.alarmHour.val());

    if (amPm) {
      this.alarmMeridiem.css('display', 'inline');
      this.alarmMeridiem.val(hour < 12 ? 'A' : 'P');
      this.alarmHour.val(p2(hour === 0 ? 12 : hour < 12 ? hour : hour - 12));
    }
    else {
      const isAm = this.alarmMeridiem.val() === 'A';

      this.alarmMeridiem.css('display', 'none');
      this.alarmHour.val(p2(isAm ? (hour === 12 ? 0 : hour) : (hour === 12 ? 12 : hour + 12)));
    }

    this.alarmAmPm = amPm;
  }

  private deleteSelectedAlarm(): void {
    if (this.selectedAlarm >= 0) {
      this.keyboard.hide();
      domConfirm('Delete the selected alarm?', yep => {
        if (yep) {
          this.newAlarms.splice(this.selectedAlarm, 1);
          this.renderAlarmList(this.newAlarms);
          this.selectAlarm(-1);
        }
      });
    }
  }

  private editSelectedAlarm(): void {
    if (this.selectedAlarm >= 0) {
      const alarm = this.newAlarms[this.selectedAlarm];
      const time = formatAlarmTime(alarm.time, this.alarmAmPm);
      const daily = (alarm.time < 1440);

      this.clearAlarmTime(daily);
      this.dailyAlarm = daily;
      this.dailyAlarmBtn.prop('checked', daily);
      this.oneTimeAlarmBtn.prop('checked', !daily);
      this.alarmEditing = true;
      this.addAlarm.prop('disabled', true);
      this.editAlarm = this.selectedAlarm;
      this.alarmDelete.prop('disabled', true);
      this.alarmEdit.prop('disabled', true);
      this.alarmSetPanel.css('opacity', '1');
      this.alarmSetPanel.css('pointer-events', 'all');
      this.datePanel.css('display', daily ? 'none' : 'flex');
      this.dayOfWeekPanel.css('display', daily ? 'flex' : 'none');
      this.alarmHour.val(time.substring(0, 2));
      this.alarmMinute.val(time.substring(3, 5));
      this.alarmMeridiem.val(time.substring(7, 8));
      this.alarmAudio.val(alarm.sound);
      this.alarmMessage.val(alarm.message);

      if (alarm.time < 1440)
        alarm.days.split(' ').forEach(day => this.dayOfWeekPanel.find(`input[value="${day}"]`).prop('checked', true));
      else {
        const date = new DateTime(alarm.time * 60000, 'UTC').wallTime;

        this.alarmDay.val(p2(date.day));
        this.alarmMonth.val(date.month);
        this.alarmYear.val(date.year);
      }
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
      this.dimmingStart.prop('disabled', false);
      this.dimmingTo.css('opacity', '1');
      this.dimmingEnd.prop('disabled', false);
    }
    else {
      this.dimmingStart.prop('disabled', true);
      this.dimmingTo.css('opacity', '0.33');
      this.dimmingEnd.prop('disabled', true);
    }
  }

  private tabClicked(evt: ClickishEvent): void {
    const tabIndex = this.tabs.index(evt.target) as Tab;

    if (tabIndex !== this.activeTab)
      this.abortForUnsavedAlarm(abort => abort || this.selectTab(tabIndex));
  }

  private abortForUnsavedAlarm(callback: (abort: boolean) => void): void {
    if (!this.alarmEditing) {
      callback(false);
      return;
    }

    this.keyboard.hide();
    domConfirm('You have unsaved alarm changes.\n\nContinue anyway?', yesGoOn => {
      if (yesGoOn)
        this.clearAlarmTime();

      callback(!yesGoOn);
    });
  }

  private selectTab(tabIndex: Tab): void {
    this.activeTab = tabIndex;
    this.tabs.removeClass('tab-active');
    this.tabs.eq(tabIndex).addClass('tab-active');
    this.tabPanels.css('visibility', 'hidden');
    this.tabPanels.eq(tabIndex).css('visibility', 'visible');
  }

  public openSettings(previousSettings: Settings, emphasizeUpdate = false): void {
    this.previousSettings = previousSettings;
    this.newAlarms = clone(previousSettings.alarms) || [];
    this.selectTab(emphasizeUpdate ? Tab.UPDATE : Tab.OPTIONS);

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
      this.stopAudio();
      decrementDialogCounter();
      popKeydownListener();
      this.okButton.off('click', this.doOK);
      this.dialog.css('display', 'none');
    });

    this.reloadButton.on('click', () => setTimeout(() => window.location.reload()));

    let recentHtml = '<label>Recent locations:</label>';

    this.recentLocations.forEach(loc => {
      recentHtml += `<div class="recent-location">${htmlEscape(loc.city)}<span>✕</span></div>`;
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
          this.selectTab(Tab.OPTIONS);
        }
      });
    });

    this.alarmAmPm = (previousSettings.timeFormat === TimeFormat.AMPM);
    this.selectedAlarm = -1;
    this.alarmDelete.prop('disabled', true);
    this.alarmEdit.prop('disabled', true);
    this.clearAlarmTime();
    this.renderAlarmList(this.newAlarms);

    const defaults = this.appService.getLatestDefaults();
    const updateVersionInfo = $('#update-version-info');

    $('.latest-version-text').text(defaults?.latestVersion || '(unknown)');
    $('.your-version-text').text(AWC_VERSION);
    updateVersionInfo.html(defaults?.latestVersionInfo || '');
    $('#hide-update-panel').css('display',
      safeCompareVersions(AWC_VERSION, defaults?.latestVersion) < 0 ? 'flex' : 'none');
    this.hideUpdate = $('#hide-update');
    this.hideUpdate.prop('checked', previousSettings.updateToHide === defaults?.latestVersion);

    getText(this.appService.getApiServer() + '/changelog').then(text => updateVersionInfo.html(text)).catch(noop);
  }

  private clearAlarmTime(clearAllDays = false): void {
    this.alarmEditing = false;
    this.addAlarm.prop('disabled', false);
    this.dailyAlarm = true;
    this.dailyAlarmBtn.prop('checked', true);
    this.oneTimeAlarmBtn.prop('checked', false);
    this.alarmSetPanel.css('opacity', '0.33');
    this.alarmSetPanel.css('pointer-events', 'none');
    this.alarmHour.val('06');
    this.alarmMinute.val('00');
    this.alarmMeridiem.val('A');
    this.adjustAlarmTime(this.alarmAmPm);
    this.alarmMessage.val('');
    (this.alarmAudio[0] as HTMLSelectElement).selectedIndex = 0;
    this.play.css('opacity', '1');
    this.play.css('pointer-events', 'all');

    const weekEnd = ttime.getWeekend(ttime.defaultLocale);

    this.dayOfWeekPanel.find('input[type="checkbox"').each(function () {
      $(this).prop('checked', !clearAllDays && !weekEnd.includes(toNumber(this.id.substr(-1))));
    });

    const now = new DateTime(null, this.appService.timezone).wallTime;

    this.alarmDay.val(p2(now.day));
    this.alarmMonth.val(now.month);
    this.alarmYear.val(now.year);
  }

  private updateWeatherServiceSelection(): void {
    let service = this.serviceSetting;

    if (service && this.weatherServices.indexOf(service) < 0)
      service = '';

    setTimeout(() => this.weatherService.val(service));
  }

  private doOK = (): void => {
    this.stopAudio();

    if (this.alarmEditing) {
      this.abortForUnsavedAlarm(abort => abort || this.doOK());
      return;
    }

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
        this.selectTab(Tab.OPTIONS);
        this.currentCity.trigger('focus');
      });

      return;
    }
    else if (isNaN(newSettings.latitude) || newSettings.latitude < -90 || newSettings.latitude > 90) {
      this.selectTab(Tab.OPTIONS);
      this.alert('A valid latitude must be provided from -90 to 90 degrees.', () =>
        this.latitude.trigger('focus'));

      return;
    }
    else if (isNaN(newSettings.longitude) || newSettings.longitude < -180 || newSettings.longitude > 180) {
      this.selectTab(Tab.OPTIONS);
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

    newSettings.updateToHide = this.hideUpdate.prop('checked') ? (this.appService.getLatestDefaults()?.latestVersion || '') : '';

    newSettings.recentLocations = this.recentLocations;
    newSettings.alarms = this.newAlarms;
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
        this.weatherService.prop('disabled', false);
        weatherOptions += '<option value="wu">Weather Underground</option>\n';

        if (data.services?.includes('vc'))
          weatherOptions += '<option value="vc">Visual Crossing</option>\n';

        if (data.services?.includes('we'))
          weatherOptions += '<option value="we">Weatherbit.io</option>\n';

        this.updateWeatherServiceSelection();
      }
      else
        this.weatherService.prop('disabled', true);

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
