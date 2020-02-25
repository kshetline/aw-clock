import { expect } from 'chai';
import { TaiUtc } from './tai-utc';
import { afterEach, beforeEach, it } from 'mocha';
import nock from 'nock';

// @ts-ignore
describe('tai-utc', () => {
  beforeEach(() => {
    nock('http://example.com')
      .get('/1').reply(200, '3644697600 36 # 1 Jul 2015\n3692217600 37 # 1 Jan 2017')
      .get('/2').times(2).reply(200, '3692217600 37 # 1 Jan 2017\n3849984000 38 # 1 Jan 2022')
      .get('/3').times(2).reply(200, '3692217600 37 # 1 Jan 2017\n3849984000 36 # 1 Jan 2022');
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('should get TAI-UTC and pending leap second', async function () {
    this.slow(5000);
    this.timeout(20_000);
    let data: any;

    data = await (new TaiUtc('http://example.com/1', () => new Date(2016, 6, 1).getTime()).getCurrentDelta());
    delete data.dut1;
    expect(data).to.eql({ delta: 36, pendingLeap: 1, pendingLeapDate: '2016-12-31' });

    data = await (new TaiUtc('http://example.com/2', () => new Date(2020, 0, 1).getTime()).getCurrentDelta());
    delete data.dut1;
    expect(data).to.eql({ delta: 37, pendingLeap: 1, pendingLeapDate: '2021-12-31' });

    data = await (new TaiUtc('http://example.com/2', () => new Date(2022, 0, 1).getTime()).getCurrentDelta());
    delete data.dut1;
    expect(data).to.eql({ delta: 38, pendingLeap: 0, pendingLeapDate: null });

    data = await (new TaiUtc('http://example.com/3', () => new Date(2020, 0, 1).getTime()).getCurrentDelta());
    delete data.dut1;
    expect(data).to.eql({ delta: 37, pendingLeap: -1, pendingLeapDate: '2021-12-31' });

    data = await (new TaiUtc('http://example.com/3', () => new Date(2022, 0, 1).getTime()).getCurrentDelta());
    delete data.dut1;
    expect(data).to.eql({ delta: 36, pendingLeap: 0, pendingLeapDate: null });
  });

  it('should get leap second history', async function () {
    this.slow(5000);
    this.timeout(20_000);
    let data: any;

    data = await (new TaiUtc('http://example.com/1', () => new Date(2016, 6, 1).getTime()).getLeapSecondHistory());
    expect(data).to.eql([{ ntp: 3_644_697_600, utc: 1_435_708_800, delta: 36 }, { ntp: 3692217600, utc: 1_483_228_800, delta: 37 }]);

    data = await (new TaiUtc('http://example.com/2', () => new Date(2020, 0, 1).getTime()).getLeapSecondHistory());
    expect(data).to.eql([{ ntp: 3_692_217_600, utc: 1_483_228_800, delta: 37 }, { ntp: 3_849_984_000, utc: 1_640_995_200, delta: 38 }]);
  });
});
