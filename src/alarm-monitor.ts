import $ from 'jquery';
import { AppService } from './app.service';
import { AlarmInfo, Settings } from './settings';
import { beep, htmlEscape, isEqual, noop, processMillis } from '@tubular/util';
import { DateTime } from '@tubular/time';
import { floor, min } from '@tubular/math';
import { domAlert, findRepeatTime } from './awc-util';
import { TimeFormat } from './shared-types';

const FALLBACK_AUDIO = 'Beep-beep-beep-beep.mp3';
const NOTHING_PENDING = Number.MAX_SAFE_INTEGER;

export class AlarmMonitor {
  private activeAlarms: AlarmInfo[] = [];
  private alarmDisableCountdown: JQuery;
  private alarmDisplay: JQuery;
  private alarmIndicator: JQuery;
  private alarmMessages: JQuery;
  private alarmSlash: JQuery;
  private alarmsPending = NOTHING_PENDING;
  private cantPlayAlertShown = false;
  private clearSnoozeDisplay: JQuery;
  private currentSound: string;
  private disableDuration = 0;
  private disableStartTime = 0;
  private fallbackBeep: any;
  private nowPlaying: HTMLAudioElement;
  private silencedAlarms: { stoppedAt: number; alarm: AlarmInfo }[] = [];
  private snoozedAlarms: { restartAt: number; alarm: AlarmInfo }[] = [];
  private readonly startTime: number;

  constructor(private appService: AppService) {
    this.alarmDisableCountdown = $('#alarm-disable-countdown');
    this.alarmDisplay = $('#current-alarm-display');
    this.alarmIndicator = $('#alarm-indicator');
    this.alarmMessages = $('#alarm-messages');
    this.alarmSlash = $('#alarm-slash');
    this.clearSnoozeDisplay = $('#clear-snooze-display');

    $('#stop-alarm, #clear-snooze-display').on('click', () => this.stopAlarms());
    $('#snooze-5').on('click', () => this.snoozeAlarms(5));
    $('#snooze-10').on('click', () => this.snoozeAlarms(10));
    $('#snooze-15').on('click', () => this.snoozeAlarms(15));
    $('#alarm-disable').on('click', () => this.alarmDisable());

    const settings = new Settings();

    settings.load();
    this.disableDuration = settings.alarmDisableDuration;
    this.disableStartTime = settings.alarmDisableStartTime;

    this.startTime = processMillis();
  }

  checkAlarms(alarmCheckTime: number, alarms: AlarmInfo[]): AlarmInfo[] {
    let updatePrefs = false;
    const now = new DateTime(alarmCheckTime, this.appService.timezone);
    const minutesInDay = now.getMinutesInDay();
    const nowMinutes = floor(now.utcSeconds / 60);
    const newActiveAlarms = [];
    let sound = '';
    let next24Hours = NOTHING_PENDING;

    this.silencedAlarms = this.silencedAlarms.filter(sa => sa.stoppedAt > nowMinutes - 65);
    alarmCheckTime += now.utcOffsetSeconds * 1000;

    for (let i = alarms.length - 1; i >= 0; --i) {
      const alarm = alarms[i];
      const isDaily = alarm.time < 1440;
      let alarmTime = findRepeatTime(alarm.time, alarm.repeat, alarmCheckTime);
      let canAddAlarm = true;

      if (this.activeAlarms.find(a => isEqual(a, alarm)) || this.silencedAlarms.find(sa => isEqual(sa.alarm, alarm)))
        canAddAlarm = false;

      const snoozed = this.snoozedAlarms.find(sa => isEqual(sa.alarm, alarm));

      if (snoozed)
        alarmTime = snoozed.restartAt;
      else if (isDaily) {
        const wt = now.wallTime;
        const alarmDT = new DateTime([wt.y, wt.m, wt.d, floor(alarmTime / 60), alarmTime % 60], this.appService.timezone);

        alarmTime = floor(alarmDT.utcSeconds / 60);
      }
      else {
        const wt = new DateTime(alarmTime * 60000, 'UTC').wallTime;
        const alarmDT = new DateTime([wt.y, wt.m, wt.d, wt.hrs, wt.min], this.appService.timezone);

        alarmTime = floor(alarmDT.utcSeconds / 60);
      }

      if (!snoozed) {
        if (!isDaily && !alarm.repeat && alarmTime < nowMinutes - 65 && processMillis() > this.startTime + 60000) { // Expired alarm?
          updatePrefs = true;
          alarms.splice(i, 1);
          continue;
        }
        else if (!alarm.enabled)
          continue;
        else if (isDaily) {
          const tomorrow = now.clone().add('day', 1).format('dd', 'en').toUpperCase();

          if (alarm.days?.includes(tomorrow) && alarmTime < nowMinutes)
            next24Hours = min(alarmTime + minutesInDay, next24Hours);

          const today = now.format('dd', 'en').toUpperCase();

          if (!alarm.days?.includes(today))
            continue;
          else if (alarmTime > nowMinutes && alarmTime < nowMinutes + minutesInDay)
            next24Hours = min(alarmTime, next24Hours);
        }
        else if (alarmTime > nowMinutes && alarmTime < nowMinutes + minutesInDay)
          next24Hours = min(alarmTime, next24Hours);
      }

      if (canAddAlarm && alarmTime <= nowMinutes && alarmTime >= nowMinutes - 60) {
        newActiveAlarms.push(alarm);

        if (snoozed)
          this.snoozedAlarms.splice(this.snoozedAlarms.indexOf(snoozed), 1);

        if (!sound)
          sound = alarm.sound;
      }
    }

    if (updatePrefs) {
      const settings = new Settings();

      settings.load();
      settings.alarms = alarms;
      settings.save();
    }

    this.alarmsPending = next24Hours;
    this.updateAlarmDisabling(nowMinutes);

    if (this.disableStartTime === 0)
      this.updateActiveAlarms(newActiveAlarms, sound);
    else
      this.silencedAlarms.push(...newActiveAlarms.map(alarm => ({ stoppedAt: nowMinutes, alarm })));

    return alarms;
  }

  resetAlarmState(): void {
    this.silencedAlarms = [];
    this.snoozedAlarms = [];
  }

  private updateActiveAlarms(newAlarms: AlarmInfo[], latestSound: string): void {
    this.activeAlarms.push(...newAlarms);

    if (this.activeAlarms.length > 0) {
      this.alarmDisplay.css('display', 'flex');
      this.clearSnoozeDisplay.css('display', 'none');
    }

    if (latestSound && latestSound !== this.currentSound) {
      this.stopAudio();
      this.createAudio(latestSound);
    }

    const messages: string[] = [];

    for (const alarm of this.activeAlarms) {
      if (alarm.message)
        messages.push(alarm.message);
    }

    if (messages.length === 1)
      this.alarmMessages.text(messages[0]);
    else if (messages.length > 1)
      this.alarmMessages.html('<ul><li>' + messages.map(msg => htmlEscape(msg)).join('</li>\n<li>') + '</li></ul>');
  }

  private createAudio(fileName: string): void {
    let somewhatReady = false;
    let playStarted = false;
    let gotError = false;

    this.currentSound = fileName;
    this.nowPlaying = new Audio(`/assets/audio/${encodeURI(fileName)}`);

    this.nowPlaying.addEventListener('canplay', () => somewhatReady = true);
    this.nowPlaying.addEventListener('canplaythrough', () => !playStarted && (playStarted = true) && this.playAudio());
    this.nowPlaying.addEventListener('loadstart', () => somewhatReady = true);
    this.nowPlaying.addEventListener('error', err => {
      if (gotError)
        return;

      const wasPlaying = this.currentSound;

      gotError = true;
      console.error(err);
      this.stopAudio();

      if (wasPlaying !== FALLBACK_AUDIO)
        this.createAudio(FALLBACK_AUDIO);
      else
        this.fallbackBeep = setInterval(beep, 500);
    });

    setTimeout(() => !playStarted && somewhatReady && (playStarted = true) && this.playAudio(), 333);
  }

  private playAudio(): void {
    if (this.nowPlaying) {
      this.nowPlaying.autoplay = true;
      this.nowPlaying.loop = true;
      this.nowPlaying.play().catch(() => {
        if (!this.cantPlayAlertShown) {
          this.cantPlayAlertShown = true;
          domAlert('Click OK to allow alarm audio to play', (): any => this.nowPlaying.play().catch(noop));
        }
      });
    }
  }

  private stopAudio(): void {
    if (this.nowPlaying) {
      this.nowPlaying.pause();
      this.nowPlaying.currentTime = 0;
      this.nowPlaying = undefined;
      this.currentSound = undefined;
    }

    if (this.fallbackBeep) {
      clearInterval(this.fallbackBeep);
      this.fallbackBeep = undefined;
    }
  }

  stopAlarms(): void {
    const stoppedAt = floor(this.appService.getAlarmTime() / 60000);

    this.stopAudio();
    this.alarmDisplay.css('display', 'none');
    this.clearSnoozeDisplay.css('display', 'none');
    this.silencedAlarms.push(...this.activeAlarms.map(alarm => ({ stoppedAt, alarm })));
    this.silencedAlarms.push(...this.snoozedAlarms.map(sa => ({ stoppedAt, alarm: sa.alarm })));
    this.activeAlarms = [];
    this.snoozedAlarms = [];
  }

  snoozeAlarms(snoozeTime: number): void {
    const restartAt = floor(this.appService.getAlarmTime() / 60000) + snoozeTime;

    this.stopAudio();
    this.alarmDisplay.css('display', 'none');
    this.clearSnoozeDisplay.css('display', 'block');
    this.snoozedAlarms.push(...this.activeAlarms.map(alarm => ({ restartAt, alarm })));
    this.activeAlarms = [];
  }

  private alarmDisable(reset = false): void {
    this.stopAlarms();

    if (this.alarmsPending !== NOTHING_PENDING || reset || this.disableStartTime > 0) {
      const nowMinutes = floor(new DateTime(this.appService.getCurrentTime(), this.appService.timezone).utcSeconds / 60);

      if (this.disableDuration === 1440 || reset) {
        this.disableDuration = 0;
        this.disableStartTime = 0;
      }
      else {
        const remaining = (this.disableStartTime || nowMinutes) + this.disableDuration - nowMinutes;

        if (this.disableDuration === 0 || remaining < 179)
          this.disableDuration = 180;
        else if (this.disableDuration < 359)
          this.disableDuration = 360;
        else if (this.disableDuration < 719)
          this.disableDuration = 720;
        else
          this.disableDuration = 1440;

        this.disableStartTime = nowMinutes;
      }

      this.updateAlarmDisableSettings();

      if (!reset) {
        this.updateAlarmDisabling(nowMinutes);
        beep(this.disableStartTime ? 440 : 220);
      }
    }
  }

  private updateAlarmDisableSettings(): void {
    const settings = new Settings();

    settings.load();
    settings.alarmDisableDuration = this.disableDuration;
    settings.alarmDisableStartTime = this.disableStartTime;
    settings.save();
  }

  private updateAlarmDisabling(nowMinutes: number): void {
    const format = (this.appService.getTimeFormat() === TimeFormat.AMPM ? 'IxS' : 'HH:mm');

    if (this.disableStartTime === 0 || nowMinutes >= this.disableStartTime + this.disableDuration) {
      this.alarmSlash.css('opacity', '0');
      this.alarmIndicator.css('opacity', this.alarmsPending !== NOTHING_PENDING ? '1' : '0');
      this.alarmIndicator.css('fill', '#0C0');
      this.alarmIndicator.css('stroke', '#0C0');

      if (this.alarmsPending === NOTHING_PENDING)
        this.alarmDisableCountdown.text('');
      else
        this.alarmDisableCountdown.html('<tspan x="25" dy="-1em" dx="1">next:</tspan><tspan x="25" dy="1em">' +
          new DateTime(this.alarmsPending * 60000, this.appService.timezone).format(format) + '</tspan>');

      if (this.disableStartTime !== 0) {
        this.disableStartTime = 0;
        this.disableDuration = 0;
        this.alarmDisable(true);
        this.updateAlarmDisableSettings();
      }
    }
    else {
      this.alarmSlash.css('opacity', '1');
      this.alarmIndicator.css('opacity', '1');
      this.alarmIndicator.css('fill', '#999');
      this.alarmIndicator.css('stroke', '#999');

      const endTime = (this.disableStartTime + this.disableDuration) * 60000;

      this.alarmDisableCountdown.html('<tspan x="25" dy="-1em">until</tspan><tspan x="25" dy="1em">' +
        new DateTime(endTime, this.appService.timezone).format(format) + '</tspan>');
    }
  }
}
