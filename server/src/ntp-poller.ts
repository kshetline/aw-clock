import { TimePoller } from './time-poller';
import { Ntp } from './ntp';
import { NtpData } from './ntp-data';
import { splitIpAndPort } from './util';

export class NtpPoller extends TimePoller {
  private readonly ntp: Ntp;

  static closeAll(): void {
    Ntp.closeAll();
  }

  constructor(
    private server = 'pool.ntp.org',
    private port = 123
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

    this.reset(typeof baseTime === 'number' ? baseTime : baseTime.getTime());
  }

  protected getNtpData(requestTime: number): Promise<NtpData> {
    return this.ntp.getTime(requestTime);
  }

  protected canPoll() {
    return !!this.ntp;
  }
}
