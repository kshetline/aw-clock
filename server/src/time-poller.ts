import { isNumber, processMillis } from '@tubular/util';
import { NtpData } from './ntp-data';
import { BACK_IN_TIME_THRESHOLD, TimeInfo } from './shared-types';

const MILLIS_PER_DAY = 86_400_000;
const MAX_ERRORS = 5;
const MAX_DELAY = 250;
const MAX_RESYNC_POLLS = 10;
const DELAY_AFTER_ERROR = 60_000;
const EARLY_POLLING_RATE = 150_000; // 2.5 minutes
const NORMAL_POLLING_RATE = 1_800_000; // 30 minutes
const RESYNC_POLLING_RATE = 500;
const RETRY_POLLING_DELAY = 5000;
const CLOCK_SPEED_WINDOW = 10_800_000; // 3 hours
const MIDNIGHT_POLLING_AVOIDANCE = 5000;

export interface ClockReferencePoint {
  t: number;
  pt: number;
}

function unref(timer: any): any {
  if (timer?.unref)
    timer.unref();

  return timer;
}

export abstract class TimePoller {
  private clockReferencePoints: ClockReferencePoint[];
  private clockSpeed: number;
  private consecutiveGoodPolls: number;
  private earlyPollingRate = EARLY_POLLING_RATE;
  private errorCount: number;
  private lastPollReceivedProcTime: number;
  private lastPolledTime: number;
  private lastReportedTime: number;
  private normalPollingRate = NORMAL_POLLING_RATE;
  private pollingAdjustmentTime: number;
  private _pendingLeapSecond = 0;
  private pollCount: number;
  private pollTimer: any;
  private timeAcquired: boolean;
  private timeAdjustmentReceivedProcTime: number;

  protected displayPollingResults = false;

  protected constructor() {
    this.reset();
  }

  protected reset(baseTime = Date.now(), pendingLeap = 0): void {
    this.lastPolledTime = this.lastReportedTime = this.pollingAdjustmentTime = baseTime;
    this.timeAdjustmentReceivedProcTime = this.lastPollReceivedProcTime = processMillis();
    this.clockReferencePoints = [];
    this.errorCount = 0;
    this.clockSpeed = 1;
    this.consecutiveGoodPolls = 0;
    this.timeAcquired = false;
    this._pendingLeapSecond = pendingLeap;
    this.pollCount = -1;
    this.clearPollTimer();
    this.pollTimer = setTimeout(() => this.pollCurrentTime());
  }

  abstract getNtpData(requestTime: number): Promise<NtpData> | NtpData;

  get pendingLeapSecond(): number { return this._pendingLeapSecond; }

  canPoll(): boolean {
    return true;
  }

  private async pollCurrentTime(): Promise<void> {
    this.clearPollTimer();

    if (!this.canPoll())
      return;

    const timeRequestedProcTime = processMillis();
    const timeRequested = this.getTimeInfo(true).time;
    // Avoid polling close to midnight to ensure better leap second handling
    const proximity = (timeRequested + MIDNIGHT_POLLING_AVOIDANCE) % MILLIS_PER_DAY;

    if (proximity < MIDNIGHT_POLLING_AVOIDANCE * 2) {
      this.pollTimer = unref(setTimeout(() => this.pollCurrentTime(), MIDNIGHT_POLLING_AVOIDANCE * 2 - proximity + 500));
      return;
    }

    let ntpData: NtpData;

    try {
      const nd = this.getNtpData(timeRequested);
      ntpData = (nd instanceof Promise ? await nd : nd);
    }
    catch {
      if (++this.errorCount > MAX_ERRORS) {
        console.error('Time polling failing');
        this.timeAcquired = false;
      }

      this.pollCount = 0;
      this.errorCount = 0;
      this.pollTimer = unref(setTimeout(() => this.pollCurrentTime(), DELAY_AFTER_ERROR));

      return;
    }

    let repoll = RESYNC_POLLING_RATE;
    const expectedPolledTime = this.getTimeInfo(true).time;
    const receivedProcTime = processMillis();
    const roundTripDelay = receivedProcTime - timeRequestedProcTime - (ntpData.txTm - ntpData.rxTm);
    const sendDelay = ntpData.rxTm - timeRequested;
    let syncDelta: number;

    if (roundTripDelay < MAX_DELAY) {
      let newTime;

      this.timeAcquired = true;
      ++this.pollCount;

      if (this.pollCount > 1)
        newTime = ntpData.txTm + roundTripDelay - Math.min(Math.max(sendDelay, 0), roundTripDelay);
      else
        newTime = ntpData.txTm + roundTripDelay / 2;

      let delta = newTime - expectedPolledTime;
      const origDelta = delta;

      if (Math.abs(delta) > 5 && Math.abs(delta) < 1000)
        delta = Math.max(Math.abs(delta) / 4, 5) * Math.sign(delta);

      if (this.pollCount === 0) {
        this.pollingAdjustmentTime = newTime;
        delta = 0;
      }
      else
        this.pollingAdjustmentTime = expectedPolledTime + delta;

      this.timeAdjustmentReceivedProcTime = receivedProcTime;

      if (Math.abs(origDelta) > 5)
        this.consecutiveGoodPolls = 0;
      else
        ++this.consecutiveGoodPolls;

      if (this.consecutiveGoodPolls === 2 || this.pollCount > MAX_RESYNC_POLLS) {
        this.consecutiveGoodPolls = 0;
        this.pollCount = 0;
        repoll = (this.clockReferencePoints.length < 3 ? this.earlyPollingRate : this.normalPollingRate);
        syncDelta = expectedPolledTime - this.getTimeInfo().time;
        this.lastPolledTime = this.pollingAdjustmentTime;
        this.lastPollReceivedProcTime = this.timeAdjustmentReceivedProcTime;
        this._pendingLeapSecond = ntpData.leapExcess ? 1 : [0, 1, -1][ntpData.li] ?? 0; // No leap second, positive leap, negative leap

        const newReferencePt = { t: this.getTimeInfo().time, pt: processMillis() };

        this.clockReferencePoints.push(newReferencePt);

        if (this.clockReferencePoints.length > 1) {
          let base = this.clockReferencePoints[0];

          if (this.clockReferencePoints.length > 2 && base.pt < newReferencePt.pt - CLOCK_SPEED_WINDOW) {
            this.clockReferencePoints.splice(0, 1);
            base = this.clockReferencePoints[0];
          }

          const newClockSpeed = (newReferencePt.pt - base.pt) / (newReferencePt.t - base.t);

          if (newClockSpeed < 0.99 || newClockSpeed > 1.01) {
            // Something has to have really gone wrong to be off this far -- the real processor clock
            // shouldn't be so slow (maybe the process was sleeping?) or fast. Reset to 1 and start over.
            this.clockSpeed = 1;
            this.clockReferencePoints = [];
          }
          else
            this.clockSpeed = Math.min(Math.max(0.998, newClockSpeed), 1.002);
        }
      }

      if (this.displayPollingResults) console.log(new Date(this.pollingAdjustmentTime).toISOString().substr(11) +
        ', orig delta: ' + origDelta.toFixed(2) +
        ', applied delta: ' + delta.toFixed(2) +
        ', sys delta: ' + (this.pollingAdjustmentTime - Date.now()).toFixed(2) +
        ', rt delay: ' + roundTripDelay.toFixed(2) +
        ', send delay: ' + sendDelay.toFixed(2) +
        (syncDelta !== undefined ?
          ', sync delta: ' + syncDelta +
          ', clock speed: ' + this.clockSpeed.toFixed(8) : ''));
    }
    else
      repoll = RETRY_POLLING_DELAY;

    this.pollTimer = unref(setTimeout(() => this.pollCurrentTime(), repoll));
  }

  private clearPollTimer(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  isTimeAcquired(): boolean {
    return this.timeAcquired;
  }

  getTimeInfo(internalAdjustOrBias?: boolean | number): TimeInfo {
    const internalAdjust = (internalAdjustOrBias === true);
    const bias = (isNumber(internalAdjustOrBias) ? internalAdjustOrBias : 0);
    let time: number;
    let timeInfo: TimeInfo;

    if (this.timeAcquired) {
      const t = internalAdjust ? this.pollingAdjustmentTime : this.lastPolledTime;
      const pt = internalAdjust ? this.timeAdjustmentReceivedProcTime : this.lastPollReceivedProcTime;

      time = Math.floor(t + (processMillis() - pt) / this.clockSpeed);
    }
    else
      time = Date.now();

    // Time should be monotonic. Don't go backward in time unless the updated time is way-off backward.
    if (!internalAdjust && time < this.lastReportedTime && time > this.lastReportedTime - BACK_IN_TIME_THRESHOLD)
      time = this.lastReportedTime;
    else
      this.lastReportedTime = time;

    if (this.timeAcquired) {
      timeInfo = {
        time: time + bias,
        leapSecond: this._pendingLeapSecond,
        leapExcess: 0
      } as TimeInfo;

      if (!internalAdjust && this._pendingLeapSecond) {
        const date = new Date(timeInfo.time + (this._pendingLeapSecond < 0 ? 1000 : 0));
        const day = date.getUTCDate();
        const millisIntoDay = timeInfo.time % MILLIS_PER_DAY;

        if (day === 1) {
          if (this._pendingLeapSecond > 0) {
            if (millisIntoDay < 1000) {
              timeInfo.leapExcess = millisIntoDay + 1;
              timeInfo.time -= timeInfo.leapExcess; // Hold at 23:59:59.999 of previous day
            }
            else {
              timeInfo.time -= 1000;
              timeInfo.leapSecond = this._pendingLeapSecond = 0;
              this.timeAdjustmentReceivedProcTime += 1000;
              this.lastPollReceivedProcTime += 1000;
              this.lastReportedTime -= 1000;
            }
          }
          else { // Handle (unlikely) negative leap second
            timeInfo.time += 1000;
            timeInfo.leapSecond = this._pendingLeapSecond = 0;
            this.timeAdjustmentReceivedProcTime -= 1000;
            this.lastPollReceivedProcTime -= 1000;
            this.lastReportedTime += 1000;
          }
        }
      }
    }
    else {
      timeInfo = {
        time: time + bias,
        leapSecond: 0,
        leapExcess: 0
      } as TimeInfo;
    }

    timeInfo.text = this.formatTime(timeInfo.time, timeInfo.leapExcess);

    return timeInfo;
  }

  formatTime(time: number, leapExcess = 0): string {
    let text = new Date(time).toISOString().replace('T', ' ');

    if (leapExcess > 0)
      text = text.substr(0, 17) + ((59_999 + leapExcess) / 1000).toFixed(3) + 'Z';

    return text;
  }
}
