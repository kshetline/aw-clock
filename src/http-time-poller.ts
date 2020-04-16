import * as $ from 'jquery';
import { NtpData } from '../server/src/ntp-data';
import { localServer } from './settings';
import { TimeInfo } from '../server/src/shared-types';
import { TimePoller } from '../server/src/time-poller';

export class HttpTimePoller extends TimePoller {
  private fromGps = false;

  constructor(private weatherServer: string) {
    super();
  }

  protected getNtpData(/* requestTime: number */): Promise<NtpData> {
    const url = `${this.weatherServer}/time`;

    return new Promise<NtpData>((resolve, reject) => {
      // noinspection JSIgnoredPromiseFromCall
      $.ajax({
        url: url,
        dataType: 'json',
        success: (data: TimeInfo) => {
          this.fromGps = data.fromGps && localServer;

          resolve({
            li: [2, 0, 1][data.leapSecond + 1],
            rxTm: data.time,
            txTm: data.time,
          } as NtpData);
        },
        error: (jqXHR: JQueryXHR, textStatus: string, errorThrown: string) => reject(errorThrown)
      });
    });
  }

  getTimeInfo(internalAdjustOrBias?: boolean | number): TimeInfo {
    const ti = super.getTimeInfo(internalAdjustOrBias);

    ti.fromGps = this.fromGps;

    return ti;
  }

  resetGpsState(): void {
    this.fromGps = false;
    this.getNtpData().catch(); // No need to handle returned Promise
  }
}
