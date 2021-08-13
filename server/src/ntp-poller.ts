import { TimePoller } from './time-poller';
import { DEFAULT_NTP_SERVER, Ntp } from './ntp';
import { NtpData } from './ntp-data';
import { splitIpAndPort } from './awcs-util';
import { isNumber } from '@tubular/util';

export class NtpPoller extends TimePoller {
  private static allOpenPollers = new Set<NtpPoller>();

  static closeAll(): void {
    NtpPoller.allOpenPollers.forEach(poller => poller.close());
  }

  private ntp: Ntp;

  constructor(
    private readonly server = DEFAULT_NTP_SERVER,
    private readonly port = 123
  ) {
    super();

    [this.server, this.port] = splitIpAndPort(server, port);
    this.ntp = new Ntp(this.server, this.port);
    this.reset();
  }

  clearDebugTime(): void {
    if (this.ntp)
      this.ntp.clearDebugTime();

    this.reset();
  }

  setDebugTime(baseTime: Date | number, leap = 0): void {
    if (this.ntp)
      this.ntp.setDebugTime(baseTime, leap);

    this.reset(isNumber(baseTime) ? baseTime : baseTime.getTime());
  }

  protected getNtpData(requestTime: number): Promise<NtpData> {
    return this.ntp.getTime(requestTime);
  }

  protected canPoll(): boolean {
    return !!this.ntp;
  }

  close(): void {
    this.ntp.close();
    this.ntp = undefined;
    NtpPoller.allOpenPollers.delete(this);
  }
}
