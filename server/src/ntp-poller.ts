import { Ntp, NtpData } from './ntp';
import { processMillis, splitIpAndPort } from './util';

const MAX_ERRORS = 5;
const MAX_DELAY = 250;
const MAX_RESYNC_POLLS = 10;
const DELAY_AFTER_ERROR = 60000;
const EARLY_POLLING_RATE = 150000; // 2.5 minutes
const NORMAL_POLLING_RATE = 600000; // 10 minutes
const RESYNC_POLLING_RATE = 500;
const RETRY_POLLING_DELAY = 5000;
const BACK_IN_TIME_THRESHOLD = 2000;
const CLOCK_SPEED_WINDOW = 10800000; // 3 hours
const DEBUG = false;

export interface TimeInfo {
  time: number;
  leapSecond: number;
  leapExcess: number;
}

interface ClockReferencePoint {
  t: number;
  pt: number;
}

export class NtpPoller {
  private readonly ntp: Ntp;

  private clockReferencePoints: ClockReferencePoint[] = [];
  private clockSpeed = 1;
  private consecutiveGoodPolls = 0;
  private errorCount = 0;
  private lastNtpReceivedProcTime: number;
  private lastNtpTime: number;
  private lastReportedTime: number;
  private ntpAcquired = false;
  private ntpAdjustmentReceivedProcTime: number;
  private ntpAdjustmentTime: number;
  private pendingLeapSecond = 0;
  private pollCount = -1;

  constructor(
    private server = 'pool.ntp.org',
    private port = 123
  ) {
    [this.server, this.port] = splitIpAndPort(server, port);
    this.ntp = new Ntp(this.server, this.port);
    this.lastNtpTime = this.lastReportedTime = this.ntpAdjustmentTime = Date.now();
    this.ntpAdjustmentReceivedProcTime = this.lastNtpReceivedProcTime = processMillis();
    // noinspection JSIgnoredPromiseFromCall
    this.pollNtpTime();
  }

  private async pollNtpTime(): Promise<void> {
    if (!this.ntp)
      return;

    const ntpRequested = this.getNtpTimeInfo(true).time;
    const ntpRequestedProcTime = processMillis();

    let ntpData: NtpData;

    try {
      ntpData = await this.ntp.getTime(ntpRequested);
    }
    catch (err) {
      if (++this.errorCount > MAX_ERRORS) {
        console.error('NTP polling stopped');
        this.ntpAcquired = false;
      }
      else {
        this.pollCount = 0;
        setTimeout(() => this.pollNtpTime(), DELAY_AFTER_ERROR);
      }

      return;
    }

    let repoll = RESYNC_POLLING_RATE;
    const expectedNtpTime = this.getNtpTimeInfo(true).time;
    const receivedProcTime = processMillis();
    const roundTripDelay = receivedProcTime - ntpRequestedProcTime - (ntpData.txTm - ntpData.rxTm);
    const sendDelay = ntpData.rxTm - ntpRequested;
    let syncDelta: number;

    if (roundTripDelay < MAX_DELAY) {
      let newNtpTime;

      this.ntpAcquired = true;
      ++this.pollCount;
      this.pendingLeapSecond = [0, 1, -1][ntpData.li] || 0; // No leap second, positive leap, negative leap

      if (this.pollCount > 1)
       newNtpTime = ntpData.txTm + roundTripDelay - Math.min(Math.max(sendDelay, 0), roundTripDelay);
      else
        newNtpTime = ntpData.txTm + roundTripDelay / 2;

      let delta = newNtpTime - expectedNtpTime;
      const origDelta = delta;

      if (Math.abs(delta) > 5 && Math.abs(delta) < 1000)
        delta = Math.max(Math.abs(delta) / 4, 5) * Math.sign(delta);

      if (this.pollCount === 0) {
        this.ntpAdjustmentTime = newNtpTime;
        delta = 0;
      }
      else
        this.ntpAdjustmentTime = expectedNtpTime + delta;

      this.ntpAdjustmentReceivedProcTime = receivedProcTime;

      if (Math.abs(origDelta) > 5)
        this.consecutiveGoodPolls = 0;
      else
        ++this.consecutiveGoodPolls;

      if (this.consecutiveGoodPolls === 2 || this.pollCount > MAX_RESYNC_POLLS) {
        this.consecutiveGoodPolls = 0;
        this.pollCount = 0;
        repoll = (this.clockReferencePoints.length < 3 ? EARLY_POLLING_RATE : NORMAL_POLLING_RATE);
        syncDelta = expectedNtpTime - this.getNtpTimeInfo().time;
        this.lastNtpTime = this.ntpAdjustmentTime;
        this.lastNtpReceivedProcTime = this.ntpAdjustmentReceivedProcTime;

        const newReferencePt = {t: this.getNtpTimeInfo().time, pt: processMillis() };

        this.clockReferencePoints.push(newReferencePt);

        if (this.clockReferencePoints.length > 1)  {
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

      if (DEBUG) console.log(new Date(this.ntpAdjustmentTime).toISOString().substr(11) +
        ', orig delta: ' + origDelta.toFixed(2) +
        ', applied delta: ' + delta.toFixed(2) +
        ', sys delta: ' + (this.ntpAdjustmentTime - Date.now()).toFixed(2) +
        ', rt delay: ' + roundTripDelay.toFixed(2) +
        ', send delay: ' + sendDelay.toFixed(2) +
        (syncDelta !== undefined ?
         ', sync delta: ' + syncDelta +
         ', clock speed: ' + this.clockSpeed.toFixed(8) : ''));
    }
    else
      repoll = RETRY_POLLING_DELAY;

    setTimeout(() => this.pollNtpTime(), repoll);
  }

  getNtpTimeInfo(internalAdjust = false): TimeInfo {
    let timeInfo: TimeInfo;

    if (this.ntpAcquired) {
      const t = internalAdjust ? this.ntpAdjustmentTime : this.lastNtpTime;
      const pt = internalAdjust ? this.ntpAdjustmentReceivedProcTime : this.lastNtpReceivedProcTime;

      timeInfo = {
        time: Math.floor(t + (processMillis() - pt) / this.clockSpeed),
        leapSecond: this.pendingLeapSecond,
        leapExcess: 0
      };

      if (!internalAdjust && this.pendingLeapSecond) {
        const date = new Date(timeInfo.time);
        const day = date.getDate();
        const millisIntoDay = timeInfo.time % 86400000;

        if (day === 1) {
          if (this.pendingLeapSecond > 0) {
            if (millisIntoDay < 1000) {
              timeInfo.leapExcess = millisIntoDay + 1;
              timeInfo.time -= timeInfo.leapExcess; // Hold at 23:59:59.999 of previous day
            }
            else {
              timeInfo.time += 1000;
              timeInfo.leapSecond = this.pendingLeapSecond = 0;
              this.lastNtpReceivedProcTime += 1000;
              this.ntpAdjustmentReceivedProcTime += 1000;
            }
          }
          else
            timeInfo.leapSecond = this.pendingLeapSecond = 0; // Clear flag for (very unlikely!) negative leap second
        }
      }
    }
    else
      timeInfo = {
        time: Date.now(),
        leapSecond: 0,
        leapExcess: 0
      };

    // Time should be monotonic. Don't go backward in time unless the updated time is way-off backward.
    if (!internalAdjust && timeInfo.time < this.lastReportedTime && timeInfo.time > this.lastReportedTime - BACK_IN_TIME_THRESHOLD)
      timeInfo.time = this.lastReportedTime;
    else
      this.lastReportedTime = timeInfo.time;

    return timeInfo;
  }
}
