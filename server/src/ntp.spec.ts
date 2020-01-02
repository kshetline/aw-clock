import { expect } from 'chai';
import { Ntp } from './ntp';

const NTP_BASE = 2208988800; // Seconds before 1970-01-01 epoch for 1900-01-01 epoch

describe('ntp', () => {
  let ntp: Ntp;

  afterEach(() => {
    if (ntp) {
      ntp.close();
      ntp = undefined;
    }
  });

  it('should get time', async function () {
    this.slow(500);
    this.timeout(1000);
    ntp = new Ntp();

    const time = await ntp.getTime();

    expect(time.rxTm_s).to.be.closeTo(Math.floor(time.rxTm / 1000) + NTP_BASE, 1);
    expect(time.rxTm_s).to.be.closeTo(Math.floor(Date.now() / 1000) + NTP_BASE, 10);
  });

  it('should debug time', async function () {
    this.slow(500);
    this.timeout(1000);
    ntp = new Ntp();

    const sampleDate = new Date(2020, 1 - 1, 1, 0, 0, 0).getTime();
    let time: number;

    ntp.setDebugTime(sampleDate);
    time = (await ntp.getTime()).rxTm;
    expect(time).to.be.closeTo(sampleDate, 2000);

    ntp.clearDebugTime();
    time = (await ntp.getTime()).rxTm;
    expect(time).to.be.closeTo(Date.now(), 10000);
  });
});
