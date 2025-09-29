import { expect } from 'chai';
import { NtpPoolPoller } from './ntp-pool-poller';
import { afterEach, describe, it } from 'mocha';
import { processMillis, toNumber } from '@tubular/util';
import { round } from '@tubular/math';

describe('ntp-pool-poller', () => {
  let poller: NtpPoolPoller;

  afterEach(() => {
    if (poller) {
      poller.close();
      poller = undefined;
    }
  });

  it('should handle averaging NTP poller, with or without leap seconds', async function () {
    this.slow(135000);
    this.timeout(200000);

    for (let ii = 0; ii < 9; ++ii) {
      const i = ii % 3;
      poller = new NtpPoolPoller();
      const debugTime = new Date('2091-12-31T23:59:50Z');
      poller.setDebugTime(debugTime, [0, 1, -1][i]);

      await new Promise<void>(resolve => {
        const checkAcquired = (): void => {
          if (poller.isTimeAcquired())
            resolve();
          else
            setTimeout(checkAcquired, 100);
        };

        checkAcquired();
      });

      let lastTime = 0;
      let secs = '';
      let change = 0;

      await new Promise<void>(resolve => {
        const checkTime = (): void => {
          const t = poller.getTimeInfo();

          if (/^209[12]/.test(t.text)) {
            expect(t.time > lastTime);
            lastTime = t.time;
            const sec = t.text.substr(17, 2);
            const nsec = toNumber(sec);
            const now = processMillis();

            if (!secs.endsWith(sec)) {
              secs += (secs ? ',' : '') + sec;
              console.log(secs);

              if (nsec > 55 || nsec < 3) {
                if (i === 2)
                  expect(nsec).to.not.equal(59);

                expect(now).to.be.greaterThan(change + 750, // TODO: Investigate sporadic failure of this test with negative leap seconds.
                  `changed too quickly (${round(now - change)}ms) from ${secs.slice(-5, -3)} to ${sec}`);
                expect(now).to.be.lessThan(change + 1750,
                  `changed too slowly (${round(now - change)}ms) from ${secs.slice(-5, -3)} to ${sec}`);
              }

              change = now;
            }
          }

          if (t.time > +debugTime + 12000)
            resolve();
          else
            setTimeout(checkTime, 25);
        };

        checkTime();
      });

      expect(secs).match([/57,58,59,00,01,02$/, /57,58,59,60,00,01,02$/, /57,58,00,01,02$/][i]);
    }
  });
});
