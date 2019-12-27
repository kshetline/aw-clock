import { expect } from 'chai';
import { splitIpAndPort } from './util';

describe('util', () => {
  it('should parse IP address or domain when possibly combined with port', () => {
    let [ip, port] = splitIpAndPort('1.2.3.4:5');

    expect(ip).to.equal('1.2.3.4');
    expect(port).to.equal(5);

    [ip, port] = splitIpAndPort('7.8.9.0', 123);

    expect(ip).to.equal('7.8.9.0');
    expect(port).to.equal(123);

    [ip, port] = splitIpAndPort('[2001:0:ce49:7601:e866:efff:62c3:fffe]:8080');

    expect(ip).to.equal('2001:0:ce49:7601:e866:efff:62c3:fffe');
    expect(port).to.equal(8080);

    [ip, port] = splitIpAndPort('2001:0:ce49:7601:e866:efff:62c3:1234');

    expect(ip).to.equal('2001:0:ce49:7601:e866:efff:62c3:1234');
    expect(port).to.equal(undefined);

    [ip, port] = splitIpAndPort('example.com:8088');

    expect(ip).to.equal('example.com');
    expect(port).to.equal(8088);
  });
});
