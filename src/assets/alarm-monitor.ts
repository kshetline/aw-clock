import $ from 'jquery';
import { AppService } from '../app.service';
import { AlarmInfo, Settings } from '../settings';
import { isEqual, noop, processMillis } from '@tubular/util';
import { DateTime } from '@tubular/time';
import { floor } from '@tubular/math';
import { domAlert, htmlEncode } from '../awc-util';

export class AlarmMonitor {
  private activeAlarms: AlarmInfo[] = [];
  private alarmDisplay: JQuery;
  private alarmMessages: JQuery;
  private cantPlayAlertShown = false;
  private currentSound: string;
  private nowPlaying: HTMLAudioElement;
  private silencedAlarms: { stoppedAt: number, alarm: AlarmInfo }[] = [];
  private readonly startTime: number;

  constructor(private appService: AppService) {
    this.alarmDisplay = $('#current-alarm-display');
    this.alarmMessages = $('#alarm-messages');
    $('#stop-alarm').on('click', () => this.stopAlarms());
    this.startTime = processMillis();
  }

  checkAlarms(alarmCheckTime: number, alarms: AlarmInfo[]): void {
    let updatePrefs = false;
    const now = new DateTime(alarmCheckTime, this.appService.timezone);
    const nowMinutes = floor(now.utcSeconds / 60);
    const newActiveAlarms = [];
    let sound = '';

    this.silencedAlarms = this.silencedAlarms.filter(sa => sa.stoppedAt > nowMinutes - 60);

    for (let i = alarms.length - 1; i >= 0; --i) {
      const alarm = alarms[i];
      const isDaily = alarm.time < 1440;
      let alarmTime = alarm.time;

      if (this.activeAlarms.find(a => isEqual(a, alarm)) || this.silencedAlarms.find(sa => isEqual(sa.alarm, alarm)))
        continue;

      if (isDaily)
        alarmTime = floor(new DateTime([now.wallTime.y, now.wallTime.m, now.wallTime.d], this.appService.timezone).utcSeconds / 60) +
          alarmTime;
      else
        alarmTime -= floor(now.utcOffsetSeconds / 60);

      console.log(alarm, nowMinutes, alarmTime, alarmTime - nowMinutes);

      if (!isDaily && alarmTime < nowMinutes - 60 && processMillis() > this.startTime + 120000) { // Expired alarm?
        updatePrefs = true;
        alarms.splice(i, 1);
        continue;
      }
      else if (!alarm.enabled)
        continue;
      else if (isDaily) {
        const today = now.format('dd', 'en').toUpperCase();

        if (!alarm.days?.includes(today))
          continue;
      }

      if (alarmTime <= nowMinutes) {
        newActiveAlarms.push(alarm);

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

    this.updateActiveAlarms(newActiveAlarms, sound);
  }

  private updateActiveAlarms(newAlarms: AlarmInfo[], latestSound: string): void {
    this.activeAlarms.push(...newAlarms);

    if (this.activeAlarms.length > 0)
      this.alarmDisplay.css('display', 'flex');

    if (latestSound && latestSound !== this.currentSound) {
      this.stopAudio();

      let somewhatReady = false;
      let playStarted = false;

      this.currentSound = latestSound;
      this.nowPlaying = new Audio(`/assets/audio/${encodeURI(latestSound)}`);

      this.nowPlaying.addEventListener('canplay', () => somewhatReady = true);
      this.nowPlaying.addEventListener('canplaythrough', () => !playStarted && (playStarted = true) && this.playAudio());
      this.nowPlaying.addEventListener('loadstart', () => somewhatReady = true);
      setTimeout(() => !playStarted && somewhatReady && (playStarted = true) && this.playAudio(), 333);
    }

    const messages: string[] = [];

    for (const alarm of this.activeAlarms) {
      if (alarm.message)
        messages.push(alarm.message);
    }

    if (messages.length === 1)
      this.alarmMessages.text(messages[0]);
    else if (messages.length > 1)
      this.alarmMessages.html('<ul><li>' + messages.map(msg => htmlEncode(msg)).join('</li>\n<li>') + '</li></ul>');
  }

  private playAudio(): void {
    if (this.nowPlaying) {
      this.nowPlaying.autoplay = true;
      this.nowPlaying.loop = true;
      this.nowPlaying.play().catch(() => {
        if (!this.cantPlayAlertShown) {
          this.cantPlayAlertShown = true;
          domAlert('Click OK to allow alarm audio to play', () => this.nowPlaying.play().catch(() => noop));
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
  }

  stopAlarms(): void {
    const stoppedAt = floor(this.appService.getCurrentTime() / 60000);

    this.stopAudio();
    this.alarmDisplay.css('display', 'none');
    this.silencedAlarms.push(...this.activeAlarms.map(alarm => ({ stoppedAt, alarm })));
    this.activeAlarms = [];
  }
}