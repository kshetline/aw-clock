import { expect } from 'chai';
import { Ntp } from './ntp';

describe('ntp', () => {
  it('should get time', async () => {
    const ntp = new Ntp();
    const time = await ntp.getTime();

    console.log(time);
    Object.keys(time).forEach(key => {
      if (/[a-z]Tm$/.test(key))
        console.log(' '.repeat(6 - key.length) + key + ': ' + new Date((time as any)[key] as number).toISOString());
    });
    expect(time).to.be.ok;
  });
});
