import * as $ from 'jquery';
import { NtpData } from '../server/src/ntp';
import { NtpPoller, TimeInfo } from '../server/src/ntp-poller';

export class HttpNtpPoller extends NtpPoller {
  private readonly weatherServer: string;

  constructor() {
    super(null);
    const weatherPort = (document.location.port === '4200' ? '4201' : '8080');
    this.weatherServer = new URL(window.location.href).searchParams.get('weather_server') || 'http://localhost:' + weatherPort;
  }

  protected getNtpData(requestTime: number): Promise<NtpData> {
    const runningDev = (document.location.port === '4200');
    const site = (runningDev ? this.weatherServer || '' : '');
    const url = `${site}/ntp`;

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
