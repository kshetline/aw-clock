import { Socket } from 'net';
import { processMillis, splitIpAndPort } from './util';
import { getDateFromDayNumber_SGC, getISOFormatDate } from 'ks-date-time-zone';

export interface DaytimeData {
  text: string;
  mjd: number;
  dateTime: string;
  millis: number;
  dst: boolean;
  nextDstChange?: string;
  leapSecond: number;
}

export const DEFAULT_DAYTIME_SERVER = 'time-a-g.nist.gov';

const REPOLL_DELAY = 7_200_000; // Two hours

function getDateFromMJD(mjd: number): string {
  return getISOFormatDate(getDateFromDayNumber_SGC(mjd - 40_587));
}

export class Daytime {
  private lastPoll = 0;
  private lastTime = '';

  constructor(
    private server = DEFAULT_DAYTIME_SERVER,
    private port = 13
  ) {
    [this.server, this.port] = splitIpAndPort(server, port);
  }

  async getDaytime(): Promise<DaytimeData> {
    let now: number;
    let nowPT: number;
    let isoDate: string;
    let $: string[];

    while (true) {
      now = Date.now();
      isoDate = new Date(now).toISOString();
      nowPT = processMillis();
      const shortDate = isoDate.substr(2, 8);
      // 58857 20-01-09 01:27:34 00 0 0 285.3 UTC(NIST) *
      // MJD   date     time     DS L H msADV ID        OTM
      $ = /^\s*(\d{5,6})\s+(\d\d-\d\d-\d\d)\s+(\d\d:\d\d:\d\d)\s+(\d\d)\s+(\d)\s+(\d)\s+([\d.]+)\s+UTC\(NIST\)\s+\*(\s*)$/.exec(this.lastTime);

      if (!$ && this.lastTime) {
        this.lastTime = '';
        throw new Error('Invalid daytime: ' + this.lastTime);
      }

      if (!$ || nowPT > this.lastPoll + REPOLL_DELAY || shortDate !== $[2]) {
        this.lastTime = await this.getDaytimeFromServer();
        this.lastPoll = nowPT;
      }
      else
        break;
    }

    this.lastTime = [$[1], $[2], isoDate.substr(11, 8), $[4], $[5], $[6], '0 UTC(NIST) *'].join(' ');

    const dstCode = Number($[4]);
    const data = {
      text: this.lastTime,
      mjd: Number($[1]),
      dateTime: isoDate,
      millis: now,
      dst: dstCode === 51 || dstCode === 50 || (dstCode < 50 && dstCode > 1),
      leapSecond: [0, 1, -1][Number($[5])] ?? 0
    } as DaytimeData;

    if (dstCode < 50 && dstCode > 0)
      data.nextDstChange = getDateFromMJD(data.mjd + dstCode - 1);
    else if (dstCode > 50)
      data.nextDstChange = getDateFromMJD(data.mjd + dstCode - 51);

    return data;
  }

  private async getDaytimeFromServer(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const socket = new Socket();

      socket.on('error', err => reject(err));

      socket.on('data', (data: Buffer) => {
        socket.destroy();
        resolve(data.toString('ascii'));
      });

      socket.connect(this.port, this.server, () => {
        socket.write('?'); // What we send doesn't matter
      });
    });
  }
}
