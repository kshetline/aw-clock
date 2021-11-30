import { TimePoller } from './time-poller';
import { NtpData } from './ntp-data';
import { isNumber, isString, processMillis } from '@tubular/util';
import { NtpPoller } from './ntp-poller';
import { BACK_IN_TIME_THRESHOLD, TimeInfo } from './shared-types';
import { abs, round } from '@tubular/math';
import { dateAndTimeFromMillis_SGC, millisFromDateTime_SGC } from '@tubular/time';

const DAY_MSEC = 84_000_000;
const DEFAULT_POOL = [
  '0.debian.pool.ntp.org', '1.debian.pool.ntp.org', '2.debian.pool.ntp.org', '3.debian.pool.ntp.org',
  'time.cloudflare.com', 'mail.geiger-online.ch', 'ns1.customer-resolver.net', 'pool.ntp.org'
];

function average(values: number[]): number {
  return values.length && values.reduce((sum, value) => sum + value) / values.length;
}

function averageAndStdDev(values: number[]): number[] {
  const avg = average(values);
  const squaredDiffs = values.map(value => {
    const diff = avg - value;
    return diff * diff;
  });

  return [avg, Math.sqrt(average(squaredDiffs))];
}

export class NtpPoolPoller extends TimePoller {
  private static allOpenPollers = new Set<NtpPoolPoller>();

  static closeAll(): void {
    NtpPoolPoller.allOpenPollers.forEach(poller => poller.close());
  }

  private mightSmear = new Set<NtpPoller>();
  private minLeapExcess = 0;
  private minTime = 0;
  private ntpPollers: NtpPoller[] = [];
  private leapSecondVicinity = Number.MIN_SAFE_INTEGER;

  constructor(pool: (string | NtpPoller)[] = DEFAULT_POOL) {
    super();
    pool.forEach(poller => this.ntpPollers.push(isString(poller) ? new NtpPoller(poller) : poller));
    NtpPoolPoller.allOpenPollers.add(this);
    this.reset();
  }

  clearDebugTime(): void {
    this.ntpPollers.forEach(poller => poller.clearDebugTime());
    this.reset();
  }

  setDebugTime(baseTime: Date | number, leap = 0): void {
    this.ntpPollers.forEach(poller => poller.setDebugTime(baseTime, leap));
    this.reset(isNumber(baseTime) ? baseTime : baseTime.getTime());
  }

  getNtpData(requestTime: number): Promise<NtpData> {
    const promises = Promise.allSettled(this.ntpPollers.map(poller => poller.getNtpData(requestTime)));

    return new Promise<NtpData>((resolve, reject) => {
      promises.then(results => {
        const firstSuccess = results.find(result => result.status === 'fulfilled');

        if (firstSuccess)
          resolve((firstSuccess as PromiseFulfilledResult<NtpData>).value);
        else
          reject((results[0] as PromiseRejectedResult).reason);
      });
    });
  }

  isTimeAcquired(): boolean {
    return !!this.ntpPollers.find(poller => poller.isTimeAcquired());
  }

  getTimeInfo(internalAdjustOrBias?: boolean | number): TimeInfo {
    let times = [] as TimeInfo[];
    let pollers = this.ntpPollers.filter(poller => poller.isTimeAcquired());

    if (pollers.length === 0)
      pollers = this.ntpPollers;

    pollers.forEach(poller => times.push(poller.getTimeInfo(internalAdjustOrBias)));

    let leapSecond = 0;
    let leapExcess = 0;
    let leapBoundary = 0;
    let reconstituteLeapInfo = false;
    const now = processMillis();
    const leapPollerIndex = pollers.findIndex(poller => poller.pendingLeapSecond);

    // Averaging clock times gets MUCH more complicated when leap seconds enter the picture,
    // especially if leap-smearing NTP servers are involved.
    if (leapPollerIndex >= 0) {
      const leapPoller = pollers[leapPollerIndex];
      const time = times[leapPollerIndex].time;
      const dt = dateAndTimeFromMillis_SGC(time - DAY_MSEC / 2);

      leapSecond = leapPoller.pendingLeapSecond;

      if (dt.m < 6)
        leapBoundary = millisFromDateTime_SGC(dt.y, 6, 30, 23, 59, 59, 999);
      else
        leapBoundary = millisFromDateTime_SGC(dt.y, 12, 31, 23, 59, 59, 999);

      if (leapSecond < 0)
        leapBoundary -= 1000;

      if (time >= leapBoundary - DAY_MSEC / 2)
        this.leapSecondVicinity = now;

      pollers.forEach((poller, index) => {
        const t = times[index].time;

        if (t <= leapBoundary) {
          if (poller.pendingLeapSecond)
            this.mightSmear.delete(poller);
          else
            this.mightSmear.add(poller);
        }
      });
    }

    if (this.leapSecondVicinity + DAY_MSEC / 2 > now) {
      pollers.forEach((poller, index) => {
        if (this.mightSmear.has(poller))
          times[index] = null;
      });

      times = times.filter(time => !!time);

      if (leapSecond > 0) {
        times.forEach(time => time.time += (time.time > leapBoundary ? 1000 : time.leapExcess));
        reconstituteLeapInfo = true;
      }
      else if (leapSecond < 0) {
        times.forEach(time => time.time -= (time.time > leapBoundary ? 1000 : 0));
        reconstituteLeapInfo = true;
      }
    }

    let [averageTime, sd] = averageAndStdDev(times.map(time => time.time));
    const filtered = times.filter(time => abs(time.time - averageTime) <= sd);

    if (filtered.length > 0 && filtered.length !== times.length) {
      times = filtered;
      averageTime = average(filtered.map(time => time.time));
    }

    averageTime = round(averageTime);

    if (reconstituteLeapInfo) {
      if (this.minTime > leapBoundary)
        averageTime += (leapSecond > 0 ? -1000 : 1000);

      if (leapSecond > 0 && averageTime > leapBoundary + 1000) {
        averageTime -= 1000;
        leapSecond = 0;
      }
      else if (leapSecond > 0 && averageTime > leapBoundary) {
        leapExcess = averageTime - leapBoundary;
        averageTime = leapBoundary;
      }
      else if (leapSecond < 0 && averageTime > leapBoundary) {
        averageTime += 1000;
        leapSecond = 0;
      }
    }

    // No backsliding.
    if (averageTime > this.minTime - BACK_IN_TIME_THRESHOLD &&
      (averageTime < this.minTime || (averageTime === this.minTime && leapExcess < this.minLeapExcess))) {
      averageTime = this.minTime;
      leapExcess = this.minLeapExcess;
    }
    else {
      this.minTime = averageTime;
      this.minLeapExcess = leapExcess;
    }

    return {
      leapExcess,
      leapSecond,
      text: this.formatTime(averageTime, leapExcess),
      time: averageTime
    };
  }

  canPoll(): boolean {
    return !!this.ntpPollers.find(poller => poller.canPoll());
  }

  close(): void {
    this.ntpPollers.forEach(poller => poller.close());
  }
}
