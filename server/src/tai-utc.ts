import { requestText } from 'by-request';
import { getDateFromDayNumber_SGC, getISOFormatDate } from 'ks-date-time-zone';

export interface CurrentDelta {
  delta: number;
  pendingLeap: number;
  pendingLeapDate: string;
}

export interface LeapSecond {
  ntp: number;
  utc: number;
  delta: number;
}

const NTP_BASE = 2208988800; // Seconds before 1970-01-01 epoch for 1900-01-01 epoch
const MILLIS_PER_DAY = 86400000;
const DAYS_BETWEEN_POLLS = 7;
const TIMEOUT = 5000;
const TIME_AND_DELTA = /^(\d{10,})\s+(\d{2,4})\s*#\s*1\s+[A-Za-z]{3}\s+\d{4}/;

export class TaiUtc {
  private lastPollDay = 0;
  private lastPollMonth = -1;
  private leapSeconds: LeapSecond[] = [];

  constructor(
    private sourceUrl = 'https://hpiers.obspm.fr/iers/bul/bulc/ntp/leap-seconds.list',
    private getUtcMillis: () => number = Date.now
  ) { }

  async getCurrentDelta(): Promise<CurrentDelta> {
    await this.updateTaiUtc();

    if (this.leapSeconds.length < 2)
      return { delta: 0, pendingLeap: 0, pendingLeapDate: null };

    const now = Math.floor(this.getUtcMillis() / 1000);
    const nextIndex = this.leapSeconds.findIndex((ls, index) => index > 0 && ls.utc > now);

    if (nextIndex > 0)
      return {
        delta: this.leapSeconds[nextIndex - 1].delta,
        pendingLeap: this.leapSeconds[nextIndex].delta - this.leapSeconds[nextIndex - 1].delta,
        pendingLeapDate: getISOFormatDate(getDateFromDayNumber_SGC(Math.floor((this.leapSeconds[nextIndex].utc - 1) / 86400)))
      };

    return { delta: this.leapSeconds[this.leapSeconds.length - 1].delta, pendingLeap: 0, pendingLeapDate: null };
  }

  async getLeapSecondHistory(): Promise<LeapSecond[]> {
    await this.updateTaiUtc();

    return this.leapSeconds;
  }

  private async updateTaiUtc(): Promise<void> {
    const now = this.getUtcMillis();
    const day = Math.floor(now / MILLIS_PER_DAY);
    const month = new Date(now).getMonth() + 1;

    if (this.leapSeconds.length > 1 && this.lastPollDay < day + DAYS_BETWEEN_POLLS && this.lastPollMonth === month)
      return;

    let leapList: string;

    try {
      leapList = await requestText(this.sourceUrl, { timeout: TIMEOUT });
    }
    catch (err) {
      this.lastPollDay = 0;
      this.lastPollMonth = -1;
    }

    const lines = leapList.split(/\r\n|\r|\n/).filter(line => TIME_AND_DELTA.test(line));

    if (lines.length > 1) {
      this.leapSeconds = [];

      lines.forEach(line => {
        const $ = TIME_AND_DELTA.exec(line);
        this.leapSeconds.push({ ntp: Number($[1]), utc: Number($[1]) - NTP_BASE, delta: Number($[2]) });
      });

      this.lastPollDay = day;
      this.lastPollMonth = month;
    }
  }
}
