import * as dgram from 'dgram';
import { mod, processMillis } from './util';
import Timer = NodeJS.Timer;
import { RemoteInfo } from 'dgram';

const NTP_BASE = 2208988800; // Seconds before 1970-01-01 epoch for 1900-01-01 epoch
const MAX_RESPONSE_WAIT = 3000;
const DEFAULT_MAX_RETRIES = 5;
const LI_UNSYNCHRONIZED = 3;

type ErrorCallback = (err: any) => void;
type TimeCallback = (data: NtpData) => void;

export interface NtpData {
  li: number; // 2 bits from 0th byte
  vn: number; // 3 bits from 0th byte
  mode: number; // 3 bits from 0th byte
  stratum: number; // 1 byte
  poll: number; // 1 byte
  precision: number; // 1 byte
  rootDelay: number; // 4 bytes
  rootDispersion: number; // 4 bytes
  refId: string; // 4 bytes
  refTm_s: number; // 4 bytes
  refTm_f: number; // 4 bytes
  refTm?: number; // (FP of previous two fields)
  origTm_s: number; // 4 bytes
  origTm_f: number; // 4 bytes
  origTm?: number; // (FP of previous two fields)
  rxTm_s: number; // 4 bytes
  rxTm_f: number; // 4 bytes
  rxTm?: number; // (FP of previous two fields)
  txTm_s: number; // 4 bytes
  txTm_f: number; // 4 bytes
  txTm?: number; // (FP of previous two fields)

  address?: string; // from socket
  roundTripTime?: number; // derived
  sendDelay?: number; // derived
}

export class Ntp {
  private static allOpenNtp = new Set<Ntp>();

  private currentPromise: Promise<NtpData>;
  private errorCallback: ErrorCallback;
  private pollTime: number;
  private pollTime_s = 0;
  private pollTime_f = 0;
  private pollProcTime: number;
  private responseTimer: Timer;
  private retries: number;
  private socket = dgram.createSocket('udp4');
  private timeCallback: TimeCallback;

  constructor(
    private server = 'pool.ntp.org',
    private port = 123,
    private maxRetries = DEFAULT_MAX_RETRIES
  ) {
    Ntp.allOpenNtp.add(this);
    this.socket.on('error', err => this.handleError(err));
    this.socket.on('message', (msg, remoteInfo) => this.handleMessage(msg, remoteInfo));
  }

  poll(timeCallback: TimeCallback, errorCallback: ErrorCallback, pollTime = Date.now(), retry = 0) {
    const packet = Buffer.concat([Buffer.from([0xE3]), Buffer.alloc(47)]);

    this.retries = retry;
    this.pollTime = pollTime;
    this.pollProcTime = processMillis();
    this.timeCallback = timeCallback;
    this.errorCallback = errorCallback;

    const txTm = pollTime + NTP_BASE * 1000;

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
      li,
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

    response.refTm = (response.refTm_s + response.refTm_f / 0x100000000 - NTP_BASE) * 1000;
    response.origTm = (response.origTm_s + response.origTm_f / 0x100000000 - NTP_BASE) * 1000;
    response.rxTm = (response.rxTm_s + response.rxTm_f / 0x100000000 - NTP_BASE) * 1000;
    response.txTm = (response.txTm_s + response.txTm_f / 0x100000000 - NTP_BASE) * 1000;
    response.address = remoteInfo.address;
    response.roundTripTime = processMillis() - this.pollProcTime;
    response.sendDelay = response.rxTm - this.pollTime;

    if (this.timeCallback)
      this.timeCallback(response);
  }
}
