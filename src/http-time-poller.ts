import { NtpData } from '../server/src/ntp-data';
import { localServer } from './settings';
import { TimeInfo } from '../server/src/shared-types';
import { TimePoller } from '../server/src/time-poller';
import { getJson } from './awc-util';

export class HttpTimePoller extends TimePoller {
  private fromGps = false;

  constructor(private weatherServer: string) {
    super();
  }

  async getNtpData(_requestTime?: number): Promise<NtpData> {
    const url = `${this.weatherServer}/time`;
    const data = await getJson<TimeInfo>(url);

    this.fromGps = data.fromGps && localServer;

    return {
      li: [2, 0, 1][data.leapSecond + 1],
      rxTm: data.time,
      txTm: data.time,
    } as NtpData;
  }

  getTimeInfo(internalAdjustOrBias?: boolean | number): TimeInfo {
    const ti = super.getTimeInfo(internalAdjustOrBias);

    ti.fromGps = this.fromGps;

    return ti;
  }

  resetGpsState(): void {
    this.fromGps = false;
    this.getNtpData().finally(); // No need to handle returned Promise
  }
}
