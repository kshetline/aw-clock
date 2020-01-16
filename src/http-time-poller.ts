import * as $ from 'jquery';
import { NtpData } from '../server/src/ntp-data';
import { TimePoller, TimeInfo } from '../server/src/time-poller';

export class HttpTimePoller extends TimePoller {
  constructor(private weatherServer: string) {
    super();
  }

  protected getNtpData(/* requestTime: number */): Promise<NtpData> {
    const url = `${this.weatherServer}/ntp`;

    return new Promise<NtpData>((resolve, reject) => {
      // noinspection JSIgnoredPromiseFromCall
      $.ajax({
        url: url,
        dataType: 'json',
        success: (data: TimeInfo) => {
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
}
