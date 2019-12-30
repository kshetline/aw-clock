import { Ntp, NtpData } from './ntp';
import { processMillis, splitIpAndPort } from './util';

const MILLIS_PER_DAY = 86400000;
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
const MIDNIGHT_POLLING_AVOIDANCE = 5000;
const DEBUG = false;

export interface TimeInfo {
  time: number;
  leapSecond: number;
  leapExcess: number;
  text: string;
}

export interface ClockReferencePoint {
  t: number;
  pt: number;
}

export class NtpPoller {
  private readonly ntp: Ntp;

  private clockReferencePoints: ClockReferencePoint[];
  private clockSpeed: number;
  private consecutiveGoodPolls: number;
  private errorCount: number;
  private lastNtpReceivedProcTime: number;
  private lastNtpTime: number;
  private lastReportedTime: number;
  private ntpAcquired: boolean;
  private ntpAdjustmentReceivedProcTime: number;
  private ntpAdjustmentTime: number;
  private pendingLeapSecond: number;
  private pollCount: number;
  private pollTimer: any;

  constructor(
    private server = 'pool.ntp.org', // Set to null to skip creation of NTP connection (for subclass that uses HTTP).
    private port = 123
  ) {
    if (server !== null) {
      [this.server, this.port] = splitIpAndPort(server, port);
      this.ntp = new Ntp(this.server, this.port);
    }

    this.reset();
  }

  protected reset(baseTime = Date.now()): void {
    this.lastNtpTime = this.lastReportedTime = this.ntpAdjustmentTime = baseTime;
    this.ntpAdjustmentReceivedProcTime = this.lastNtpReceivedProcTime = processMillis();
    this.clockReferencePoints = [];
    this.errorCount = 0;
    this.clockSpeed = 1;
    this.consecutiveGoodPolls = 0;
    this.ntpAcquired = false;
    this.pendingLeapSecond = 0;
    this.pollCount = -1;
    this.clearPollTimer();
    this.pollTimer = setTimeout(() => this.pollNtpTime());
  }

  clearDebugTime(): void {
    if (this.ntp)
      this.ntp.clearDebugTime();

    this.reset();
  }

  setDebugTime(baseTime: Date | number, leap = 0): void {
    if (this.ntp)
      this.ntp.setDebugTime(baseTime, leap);

    this.reset(typeof baseTime === 'number' ? baseTime : baseTime.getTime());
  }

  protected getNtpData(requestTime: number): Promise<NtpData> {
    return this.ntp.getTime(requestTime);
  }

  private async pollNtpTime(): Promise<void> {
    this.clearPollTimer();

    if (!this.ntp && this.server !== null)
      return;

    const ntpRequestedProcTime = processMillis();
    const ntpRequested = this.getNtpTimeInfo(true).time;
    // Avoid polling close to midnight to ensure better leap second handling
    const proximity = (ntpRequested + MIDNIGHT_POLLING_AVOIDANCE) % MILLIS_PER_DAY;

    if (proximity < MIDNIGHT_POLLING_AVOIDANCE * 2) {
      this.pollTimer = setTimeout(() => this.pollNtpTime(), MIDNIGHT_POLLING_AVOIDANCE * 2 - proximity + 500);
      return;
    }

    let ntpData: NtpData;

    try {
      ntpData = await this.getNtpData(ntpRequested);
    }
    catch (err) {
      if (++this.errorCount > MAX_ERRORS && this.server !== null) {
        console.error('NTP polling stopped');
        this.ntpAcquired = false;
      }
      else {
        this.pollCount = 0;
        this.pollTimer = setTimeout(() => this.pollNtpTime(), DELAY_AFTER_ERROR);
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
        this.pendingLeapSecond = [0, 1, -1][ntpData.li] || 0; // No leap second, positive leap, negative leap

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

    this.pollTimer = setTimeout(() => this.pollNtpTime(), repoll);
  }

  private clearPollTimer(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
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
      } as TimeInfo;

      if (!internalAdjust && this.pendingLeapSecond) {
        const date = new Date(timeInfo.time + (this.pendingLeapSecond < 0 ? 1000 : 0));
        const day = date.getUTCDate();
        const millisIntoDay = timeInfo.time % MILLIS_PER_DAY;

        if (day === 1) {
          if (this.pendingLeapSecond > 0) {
            if (millisIntoDay < 1000) {
              timeInfo.leapExcess = millisIntoDay + 1;
              timeInfo.time -= timeInfo.leapExcess; // Hold at 23:59:59.999 of previous day
            }
            else {
              timeInfo.time -= 1000;
              timeInfo.leapSecond = this.pendingLeapSecond = 0;
              this.lastNtpReceivedProcTime += 1000;
              this.ntpAdjustmentReceivedProcTime += 1000;
            }
          }
          else { // Handle (very unlikely!) negative leap second
            timeInfo.time += 1000;
            timeInfo.leapSecond = this.pendingLeapSecond = 0;
            this.lastNtpReceivedProcTime -= 1000;
            this.ntpAdjustmentReceivedProcTime -= 1000;
          }
        }
      }
    }
    else
      timeInfo = {
        time: Date.now(),
        leapSecond: 0,
        leapExcess: 0
      } as TimeInfo;

    // Time should be monotonic. Don't go backward in time unless the updated time is way-off backward.
    if (!internalAdjust && timeInfo.time < this.lastReportedTime && timeInfo.time > this.lastReportedTime - BACK_IN_TIME_THRESHOLD)
      timeInfo.time = this.lastReportedTime;
    else
      this.lastReportedTime = timeInfo.time;

    timeInfo.text = new Date(timeInfo.time).toISOString().replace('T', ' ');

    if (timeInfo.leapExcess > 0)
      timeInfo.text = timeInfo.text.substr(0, 17) + ((59999 + timeInfo.leapExcess) / 1000).toFixed(3) + 'Z';

    return timeInfo;
  }
}
