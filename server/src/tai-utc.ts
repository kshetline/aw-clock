import { requestText } from 'by-request';
import { getDateFromDayNumber_SGC, getDayNumber_SGC, getISOFormatDate, parseISODate } from 'ks-date-time-zone';
import { interpolate } from 'ks-math';
import PromiseFtp from 'promise-ftp';
import { URL } from 'url';

export interface CurrentDelta {
  delta: number;
  dut1: number[] | null;
  pendingLeap: number;
  pendingLeapDate: string;
}

export interface LeapSecond {
  ntp: number;
  utc: number;
  delta: number;
}

export const DEFAULT_LEAP_SECOND_HTTPS_URL = 'https://hpiers.obspm.fr/iers/bul/bulc/ntp/leap-seconds.list';
export const DEFAULT_LEAP_SECOND_FTP_URL = 'ftp://ftp.nist.gov/pub/time/leap-seconds.list';
export const DEFAULT_LEAP_SECOND_URLS = DEFAULT_LEAP_SECOND_HTTPS_URL + ';' + DEFAULT_LEAP_SECOND_FTP_URL;

interface DeltaUt1Utc {
  utc: number;
  delta: number;
}

interface DebugTime {
  leap: number;
  leapUtc: number;
}

const IERS_BULLETIN_A_URL = 'ftp://ftp.iers.org/products/eop/rapid/daily/finals.daily';

const NTP_BASE = 2208988800; // Seconds before 1970-01-01 epoch for 1900-01-01 epoch
const MILLIS_PER_DAY = 86400000;
const DAYS_BETWEEN_POLLS = 7;
const MAX_RANDOM_LEAP_SECOND_POLL_DELAY = 180000; // Three minutes
const TIMEOUT = 5000;
const TIME_AND_DELTA = /^(\d{10,})\s+(\d{2,4})\s*#\s*1\s+[A-Za-z]{3}\s+\d{4}/;

function makeError(err: any): Error {
  return err instanceof Error ? err : new Error(err.toString);
}

function getUtcFromMJD(mjd: number): number {
  return getDateFromDayNumber_SGC(mjd - 40587).n * 86400;
}

export class TaiUtc {
  private deltaUt1s: DeltaUt1Utc[] = [];
  private firstLeapSecondPoll = true;
  private lastPollDay = 0;
  private lastPollMonth = -1;
  private leapSeconds: LeapSecond[] = [];
  private pendingPromise: Promise<void>;
  private urls: string[] = [];

  constructor(
    sourceUrls = DEFAULT_LEAP_SECOND_URLS,
    private getUtcMillis: () => number = Date.now
  ) {
    this.urls = sourceUrls.split(';');
    setTimeout(() => this.updateTaiUtc());
  }

  async getCurrentDelta(): Promise<CurrentDelta> {
    await this.updateTaiUtc();

    const now = Math.floor(this.getUtcMillis() / 1000);
    const dut1 = this.getDeltaUtc1(now);

    if (this.leapSeconds.length < 2)
      return { delta: 0, dut1, pendingLeap: 0, pendingLeapDate: null };

    const nextIndex = this.leapSeconds.findIndex((ls, index) => index > 0 && ls.utc > now);

    if (nextIndex > 0)
      return {
        delta: this.leapSeconds[nextIndex - 1].delta,
        dut1,
        pendingLeap: this.leapSeconds[nextIndex].delta - this.leapSeconds[nextIndex - 1].delta,
        pendingLeapDate: getISOFormatDate(getDateFromDayNumber_SGC(Math.floor((this.leapSeconds[nextIndex].utc - 1) / 86400)))
      };

    return { delta: this.leapSeconds[this.leapSeconds.length - 1].delta, dut1, pendingLeap: 0, pendingLeapDate: null };
  }

  async getLeapSecondHistory(): Promise<LeapSecond[]> {
    await this.updateTaiUtc();

    return this.leapSeconds;
  }

  private async updateTaiUtc(): Promise<void> {
    if (!this.pendingPromise) {
      this.pendingPromise = this.updateTaiUtcAux();
      (this.pendingPromise).then(() => this.pendingPromise = undefined);
    }

    return this.pendingPromise;
  }

  private async updateTaiUtcAux(): Promise<void> {
    const now = this.getUtcMillis();
    const day = Math.floor(now / MILLIS_PER_DAY);
    const month = new Date(now).getMonth() + 1;

    if (this.leapSeconds.length > 1 && this.lastPollDay < day + DAYS_BETWEEN_POLLS && this.lastPollMonth === month)
      return;

    await new Promise<void>(resolve => {
      // Randomly delay polling so that multiple TaiUtc instances don't all poll at the same time every day.
      const delay = (this.firstLeapSecondPoll ? 0 : Math.floor(Math.random() * MAX_RANDOM_LEAP_SECOND_POLL_DELAY));
      this.firstLeapSecondPoll = false;
      setTimeout(() => resolve(), delay);
    });

    try {
      await this.getIersBulletinA();
    }
    catch (err) {
      console.error(err);
    }

    const promises: Promise<string | Error>[] = [];

    this.urls.forEach(url => {
      if (new URL(url).protocol === 'ftp:')
        promises.push(TaiUtc.getFtpText(url));
      else
        promises.push(requestText(url, { timeout: TIMEOUT }).catch(err => makeError(err)));
    });

    const docs = await Promise.all(promises);
    let newLeaps: LeapSecond[] = [];

    docs.forEach(doc => {
      if (typeof doc !== 'string')
        return;

      const lines = doc.split(/\r\n|\r|\n/).filter(line => TIME_AND_DELTA.test(line));

      if (lines.length > 1 && lines.length > newLeaps.length) {
        newLeaps = [];

        lines.forEach(line => {
          const $ = TIME_AND_DELTA.exec(line);
          newLeaps.push({ ntp: Number($[1]), utc: Number($[1]) - NTP_BASE, delta: Number($[2]) });
        });
      }
    });

    if (newLeaps.length > 1) {
      this.leapSeconds = newLeaps;
      this.lastPollDay = day;
      this.lastPollMonth = month;

      const dt = TaiUtc.getDebugTime();

      if (dt) {
        let index = this.leapSeconds.findIndex(ls => ls.utc > dt.leapUtc);

        if (index < 0)
          index = this.leapSeconds.length;

        this.leapSeconds.splice(index, 0,
          { ntp: dt.leapUtc + NTP_BASE, utc: dt.leapUtc, delta: this.leapSeconds[index - 1].delta + dt.leap });
      }
    }
  }

  private static getDebugTime(): DebugTime {
    if (process.env.AWC_DEBUG_TIME) {
      const parts = process.env.AWC_DEBUG_TIME.split(';');
      const leap = Number(parts[1] || 0);

      if (leap) {
        const startDate = parseISODate(parts[0].substr(0, 10));
        const leapSecondDay = getDayNumber_SGC(startDate.y, startDate.m + 1, 1);
        const leapUtc = leapSecondDay * 86400;

        return { leap, leapUtc };
      }
    }

    return undefined;
  }

  private getDeltaUtc1(utc: number): number[] | null {
    const index = this.deltaUt1s.findIndex(entry => entry.utc > utc) - 1;
    const entry = (index < 0 ? null : this.deltaUt1s[index]);

    if (index < 0 || entry.utc > utc + 86400)
      return null;
    else if (this.deltaUt1s.length === index + 1)
      return [entry.delta, entry.delta, entry.delta];

    const next = this.deltaUt1s[index + 1];
    let nextDelta = next.delta;

    if (nextDelta > entry.delta + 0.5)
      nextDelta -= 1;
    else if (nextDelta < entry.delta - 0.5)
      nextDelta += 1;

    return [entry.delta, interpolate(entry.utc, utc, next.utc, entry.delta, nextDelta), nextDelta];
  }

  // IERS Bulletin A provides (among other things) current and predicted UTC1-UTC values.
  private async getIersBulletinA(): Promise<void> {
    const lines = (await TaiUtc.getFtpText(IERS_BULLETIN_A_URL, true)).toString().split(/\r\n|\r|\n/);
    const newDeltas: DeltaUt1Utc[] = [];

    lines.forEach(line => {
      const $ = /[ \d]{6}\s+(\d{5,})[.\d]*\s+[IP](?:\s+[-.\d]+){4}\s+[IP](?:[ +]?)([-.\d]+)/i.exec(line);

      if ($)
        newDeltas.push({ utc: getUtcFromMJD(Number($[1])), delta: Number($[2]) });
    });

    if (newDeltas.length > 0) {
      this.deltaUt1s = newDeltas;

      const dt = TaiUtc.getDebugTime();

      if (dt)
        this.deltaUt1s.forEach(dut1 => dut1.delta += (dut1.utc >= dt.leapUtc ? dt.leap : 0));
    }
  }

  private static getFtpText(url: string, throwError = false): Promise<string | Error> {
    const parsed = new URL(url);
    const port = Number(parsed.port || 21);
    const options: PromiseFtp.Options = { host: parsed.hostname, port, connTimeout: TIMEOUT, pasvTimeout: TIMEOUT };

    if (parsed.username)
      options.user = parsed.username;

    if (parsed.password != null)
      options.password = parsed.password;

    const ftp = new PromiseFtp();

    return ftp.connect(options)
      .then(() => ftp.ascii())
      .then(() => ftp.get(parsed.pathname))
      .then(stream => {
        const chunks: string[] = [];

        return new Promise<string>((resolve, reject) => {
          stream.once('error', err => reject(err));
          stream.once('end', () => resolve(chunks.join('')));
          stream.on('data', chunk => chunks.push(chunk.toString()));
          stream.resume();
        });
      })
      .then(text => {
        // noinspection JSIgnoredPromiseFromCall
        ftp.end();
        return text;
      })
      .catch(err => throwError ? Promise.reject(err) : makeError(err));
  }
}
