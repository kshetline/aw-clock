import { expect } from 'chai';
import { NtpPoller } from './ntp-poller';
import { afterEach, describe, it } from 'mocha';

async function waitForSecondsToChange(poller: NtpPoller, from: string): Promise<string> {
  return new Promise<string>(resolve => {
    const getSeconds = () => {
      const text = poller.getTimeInfo().text;
      const secs = text.substr(17, 2);

      if (secs !== from)
        resolve(secs);
      else
        setTimeout(getSeconds, 10);
    };

    getSeconds();
  });
}

describe('ntp-poller', () => {
  let poller: NtpPoller;

  afterEach(() => {
    if (poller) {
      poller.close();
      poller = undefined;
    }
  });

  it('should handle positive leap second', async function () {
    this.slow(100000);
    this.timeout(15000);
    poller = new NtpPoller('time.apple.com');

    const sampleDate = Date.UTC(2021, 12 - 1, 31, 23, 59, 53);
    let time = '';

    poller.setDebugTime(sampleDate, 1);

    while ((time = await waitForSecondsToChange(poller, time)) !== '59') {}

    const time2 = await waitForSecondsToChange(poller, time);
    const time3 = await waitForSecondsToChange(poller, time2);

    expect(time + time2 + time3).equals('596000');
    expect(poller.isTimeAcquired()).equals(true);
  });

  it('should handle negative leap second', async function () {
    this.slow(100000);
    this.timeout(15000);
    poller = new NtpPoller('time.apple.com');

    const sampleDate = Date.UTC(2021, 12 - 1, 31, 23, 59, 53);
    let time = '';

    poller.setDebugTime(sampleDate, -1);

    while ((time = await waitForSecondsToChange(poller, time)) !== '57') {}

    const time2 = await waitForSecondsToChange(poller, time);
    const time3 = await waitForSecondsToChange(poller, time2);

    expect(time + time2 + time3).equals('575800');
  });
});
