import { mod, processMillis, splitIpAndPort } from './util';
import { RemoteInfo } from 'dgram';
import { NtpData } from './ntp-data';

let dgram: any;

try {
  // Make this module optional
  dgram = require('dgram');
}
catch (err) {}

const NTP_BASE = 2208988800; // Seconds before 1970-01-01 epoch for 1900-01-01 epoch
const MAX_RESPONSE_WAIT = 3000;
const DEFAULT_MAX_RETRIES = 5;
const LI_UNSYNCHRONIZED = 3;

type ErrorCallback = (err: any) => void;
type TimeCallback = (data: NtpData) => void;

export class Ntp {
  private static allOpenNtp = new Set<Ntp>();

  static closeAll(): void {
    Ntp.allOpenNtp.forEach(ntp => ntp.close());
  }

  private currentPromise: Promise<NtpData>;
  private debugOffset = 0;
  private debugLeap = 0;
  private errorCallback: ErrorCallback;
  private pollTime: number;
  private pollTime_s = 0;
  private pollTime_f = 0;
  private pollProcTime: number;
  private responseTimer: any;
  private retries: number;
  private socket = dgram.createSocket('udp4');
  private timeCallback: TimeCallback;

  constructor(
    private server = 'pool.ntp.org',
    private port = 123,
    private maxRetries = DEFAULT_MAX_RETRIES
  ) {
    [this.server, this.port] = splitIpAndPort(server, port);
    Ntp.allOpenNtp.add(this);
    this.socket.on('error', (err: Error) => this.handleError(err));
    this.socket.on('message', (msg: Buffer, remoteInfo: RemoteInfo) => this.handleMessage(msg, remoteInfo));
  }

  clearDebugTime(): void {
    this.debugOffset = 0;
    this.debugLeap = 0;
  }

  setDebugTime(baseTime: Date | number, leap = 0): void {
    const base = typeof baseTime === 'number' ? baseTime : baseTime.getTime();

    // Assumes system time is at least close to NTP server time
    this.debugOffset = base - Date.now();
    this.debugLeap = leap;
  }

  poll(timeCallback: TimeCallback, errorCallback: ErrorCallback, pollTime = Date.now(), retry = 0) {
    if (!this.socket) {
      this.timeCallback({ li: 0, rxTm: Date.now(), txTm: Date.now(), } as NtpData);
      return;
    }

    const packet = Buffer.concat([Buffer.from([0xE3]), Buffer.alloc(47)]);

    this.retries = retry;
    this.pollTime = pollTime;
    this.pollProcTime = processMillis();
    this.timeCallback = timeCallback;
    this.errorCallback = errorCallback;

    const txTm = pollTime - this.debugOffset + NTP_BASE * 1000;

    packet.writeUInt32BE(this.pollTime_s = Math.floor(txTm / 1000), 40);
    packet.writeUInt32BE(this.pollTime_f = Math.floor(mod(txTm, 1000) / 1000 * 0x100000000), 44);

    try {
      this.socket.send(packet, 0, 48, this.port, this.server);
    }
    catch (err) {
      errorCallback(err);
      return;
    }

    this.responseTimer = setTimeout(() => {
      if (this.responseTimer) {
        this.responseTimer = undefined;

        if (this.retries < this.maxRetries)
          this.poll(timeCallback, errorCallback, this.pollTime + processMillis() - this.pollProcTime, this.retries + 1);
        else {
          this.currentPromise = undefined;
          errorCallback(new Error('NTP failed'));
        }
      }
    }, MAX_RESPONSE_WAIT);
  }

  getTime(pollTime = Date.now()): Promise<NtpData> {
    if (!this.currentPromise) {
      this.currentPromise = new Promise((resolve, reject) => {
        this.poll(ntpData => resolve(ntpData), err => reject(err), pollTime);
      });
    }

    return this.currentPromise;
  }

  private clearResponseTimer(): void {
    this.currentPromise = undefined;

    if (this.responseTimer) {
      clearTimeout(this.responseTimer);
      this.responseTimer = undefined;
    }
  }

  private handleError(err: Error): void {
    this.clearResponseTimer();

    if (++this.retries === this.maxRetries) {
      if (this.errorCallback)
        this.errorCallback('NTP failed: ' + err);
    }
    else if (this.timeCallback) {
      this.poll(this.timeCallback, this.errorCallback, this.pollTime + processMillis() - this.pollProcTime, this.retries);
    }
  }

  private handleMessage(msg: Buffer, remoteInfo: RemoteInfo): void {
    this.clearResponseTimer();

    function char(offset: number): string { return String.fromCharCode(msg[offset] | 32); }

    const stratum = msg.readUInt8(1);
    let refId;

    if (stratum < 2)
      refId = (char(12) + char(13) + char(14) + char(15)).trim(); // As short ID string
    else if (remoteInfo.family === 'IPv4')
      refId = msg[12] + ':' + msg[13] + ':' + msg[14] + ':' + msg[15]; // As IPv4 address
    else
      refId = (0x100000000 + msg.readUInt32BE(12)).toString(16).substr(1); // As hash

    if (stratum === 0) {
      if (this.errorCallback)
        this.errorCallback(new Error('NTP "kiss of death": ' + refId));

      return;
    }

    const li = (msg.readUInt8(0) & 0xC0) >> 6;

    if (li === LI_UNSYNCHRONIZED) {
      this.handleError(new Error('NTP unsynchronized'));

      return;
    }

    const response: NtpData = {
      li: this.debugOffset ? (this.debugLeap < 0 ? 2 : this.debugLeap) : li,
      vn: (msg.readUInt8(0) & 0x38) >> 3,
      mode: msg.readUInt8(0) & 0x07,

      stratum,
      poll: msg.readInt8(2),
      precision: msg.readInt8(3),

      rootDelay: msg.readUInt32BE(4),
      rootDispersion: msg.readUInt32BE(8),
      refId,

      refTm_s: msg.readUInt32BE(16),
      refTm_f: msg.readUInt32BE(20),

      origTm_s: msg.readUInt32BE(24),
      origTm_f: msg.readUInt32BE(28),

      rxTm_s: msg.readUInt32BE(32),
      rxTm_f: msg.readUInt32BE(36),

      txTm_s: msg.readUInt32BE(40),
      txTm_f: msg.readUInt32BE(44)
    };

    if (this.pollTime_s !== response.origTm_s && this.pollTime_f !== response.origTm_f)
      return;
    else
      this.pollTime_s = this.pollTime_f = 0;

    response.refTm = (response.refTm_s + response.refTm_f / 0x100000000 - NTP_BASE) * 1000 + this.debugOffset;
    response.origTm = (response.origTm_s + response.origTm_f / 0x100000000 - NTP_BASE) * 1000 + this.debugOffset;
    response.rxTm = (response.rxTm_s + response.rxTm_f / 0x100000000 - NTP_BASE) * 1000 + this.debugOffset;
    response.txTm = (response.txTm_s + response.txTm_f / 0x100000000 - NTP_BASE) * 1000 + this.debugOffset;
    response.address = remoteInfo.address;
    response.roundTripTime = processMillis() - this.pollProcTime;
    response.sendDelay = response.rxTm - this.pollTime;

    if (this.debugLeap && new Date(response.txTm).getUTCDate() === 1 && response.txTm % 86400000 >= 1000) {
      this.debugOffset -= this.debugLeap * 1000;
      this.debugLeap = response.li = 0;
    }

    if (this.timeCallback)
      this.timeCallback(response);
  }

  close(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = undefined;
      Ntp.allOpenNtp.delete(this);
    }
  }
}
