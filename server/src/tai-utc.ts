import { requestText } from 'by-request';
import { getDateFromDayNumber_SGC, getISOFormatDate } from 'ks-date-time-zone';
import PromiseFtp from 'promise-ftp';
import { parse as parseUrl } from 'url';

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

export const DEFAULT_LEAP_SECOND_HTTPS_URL = 'https://hpiers.obspm.fr/iers/bul/bulc/ntp/leap-seconds.list';
export const DEFAULT_LEAP_SECOND_FTP_URL = 'ftp://ftp.nist.gov/pub/time/leap-seconds.list';
export const DEFAULT_LEAP_SECOND_URLS = DEFAULT_LEAP_SECOND_HTTPS_URL + ';' + DEFAULT_LEAP_SECOND_FTP_URL;

const NTP_BASE = 2208988800; // Seconds before 1970-01-01 epoch for 1900-01-01 epoch
const MILLIS_PER_DAY = 86400000;
const DAYS_BETWEEN_POLLS = 7;
const TIMEOUT = 5000;
const TIME_AND_DELTA = /^(\d{10,})\s+(\d{2,4})\s*#\s*1\s+[A-Za-z]{3}\s+\d{4}/;

function makeError(err: any): Error {
  return err instanceof Error ? err : new Error(err.toString);
}

export class TaiUtc {
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

    const promises: Promise<string | Error>[] = [];

    this.urls.forEach(url => {
      if (parseUrl(url).protocol === 'ftp:')
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
    }
  }

  private static getFtpText(url: string): Promise<string | Error> {
    const parsed = parseUrl(url);
    const port = Number(parsed.port || 21);
    const options: PromiseFtp.Options = { host: parsed.hostname, port, connTimeout: TIMEOUT, pasvTimeout: TIMEOUT };
    const [user, password] = (parsed.auth ?? '').split(':');

    if (user)
      options.user = user;

    if (password != null)
      options.password = password;

    const ftp = new PromiseFtp();

    return ftp.connect(options)
      .then(() => ftp.ascii())
      .then(() => ftp.get(parsed.path))
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
        ftp.end();
        return text;
      })
      .catch(err => makeError(err));
  }
}
