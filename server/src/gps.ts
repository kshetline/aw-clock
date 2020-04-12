import { requestJson } from 'by-request';
import { ChildProcess } from 'child_process';
import { parseISODate } from 'ks-date-time-zone';
import { processMillis } from 'ks-util';
import { NtpData } from './ntp-data';
import { ErrorMode, monitorProcess, spawn } from './process-util';
import { TaiUtc } from './tai-utc';
import { TimePoller } from './time-poller';
import { TimeInfo } from './time-types';
import { roughDistanceBetweenLocationsInKm } from './util';

const BILLION = BigInt('1000000000');
const THOUSAND = BigInt('1000');
const TWO_MILLION = BigInt('2000000');
const CLOCK_CHECK = 30_000; // Half minute
const CHECK_LOCATION_RETRY_DELAY = 300_000; // 5 minutes

export interface GpsData {
  altitude?: number; // in meters
  averageSNR?: number, // in dBHz
  estimatedPositionError?: number, // max of epx and epy, in meters.
  fix: number; // 0 = invalid, 1 = GPS, 2 = DGPS
  latitude?: number;
  longitude?: number;
  name?: string;
  pps?: boolean;
  satellites?: number;
  signalQuality: number;
  timezone?: string;
}

export class Gps extends TimePoller {
  private clockCheckTimeout: any;
  private checkingLocation = false;
  private checkLocationRetry = 0;
  private deltaGps: number;
  private gpsData: GpsData = { fix: 0, signalQuality: 0 };
  private googleKey: string;
  private gpspipe: ChildProcess;
  private leapSecond = 0;
  private namedGpsData: GpsData;
  private systemTimeIsGps = false;

  constructor(private taiUtc : TaiUtc) {
    super();
    this.gpspipe = spawn('gpspipe', ['-w']);
    this.googleKey = process.env.AWC_GOOGLE_API_KEY;

    this.gpspipe.stdout.on('data', data => {
      try {
        const obj = JSON.parse(data.toString());

        if (obj?.class === 'TPV' && obj.lat != null) {
          this.gpsData.latitude = obj.lat;
          this.gpsData.longitude = obj.lon;
          this.gpsData.altitude = obj.altHAE ?? obj.alt ?? 0;
          this.gpsData.fix = obj.status ?? this.gpsData.fix ?? 0;
          this.gpsData.pps = this.systemTimeIsGps;

          if (obj.epx != null && obj.epy != null)
            this.gpsData.estimatedPositionError = Math.max(obj.epx, obj.epy);
          else
            delete this.gpsData.estimatedPositionError;

          if ((this.gpsData.fix || 0) === 0)
            this.gpsData.signalQuality = 0;
          else {
            this.gpsData.signalQuality = (this.gpsData.fix === 1 ? 75 : 100);

            if (!this.gpsData.pps)
              this.gpsData.signalQuality /= 2;

            if (this.gpsData.estimatedPositionError == null || this.gpsData.estimatedPositionError > 100)
              this.gpsData.signalQuality /= 2;
            else if (this.gpsData.estimatedPositionError > 10)
              this.gpsData.signalQuality *= 3 / 4;
          }

          this.checkLocation();
        }
        else if (obj?.class === 'SKY' && Array.isArray(obj.satellites)) {
          this.gpsData.satellites = obj.satellites.length;

          let usedCount = 0;
          let totalSNR = 0;

          for (const sat of obj.satellites) {
            if (sat.used && sat.ss != null) {
              ++usedCount;
              totalSNR += sat.ss;
            }

            if (usedCount > 0)
              this.gpsData.averageSNR = Math.round(totalSNR / usedCount);
            else
              delete this.gpsData.averageSNR;
          }
        }
        else if (obj?.class === 'PPS' && obj.real_sec) {
          const gpsTime = BigInt(obj.real_sec) * BILLION + BigInt(obj.real_nsec);
          const clockTime = BigInt(obj.clock_sec) * BILLION + BigInt(obj.clock_nsec);
          const diff = (gpsTime - clockTime) / THOUSAND;

          if (-TWO_MILLION < diff && diff < TWO_MILLION)
            this.deltaGps = Number(diff) / 1000;
          else
            this.deltaGps = undefined;
        }
      }
      catch {}
    });

    this.checkSystemTime();
  }

  public isTimeGpsSynced(): boolean {
    return this.systemTimeIsGps && Math.abs(this.deltaGps) < 2000;
  }

  public getGpsData(): GpsData {
    const result = {} as GpsData;

    Object.assign(result, this.gpsData);

    if (this.namedGpsData?.name)
      result.name = this.namedGpsData.name;

    if (this.namedGpsData?.timezone)
      result.timezone = this.namedGpsData.timezone;

    return result;
  }

  public close(): void {
    this.gpspipe.kill('SIGINT');

    if (this.clockCheckTimeout)
      clearTimeout(this.clockCheckTimeout);
  }

  getTimeInfo(internalAdjustOrBias?: boolean | number): TimeInfo {
    const ti = super.getTimeInfo(internalAdjustOrBias);

    if (this.isTimeGpsSynced())
      ti.fromGps = true;

    return ti;
  }

  protected getNtpData(): NtpData {
    const now = Date.now() + Math.round(this.deltaGps || 0);

    return {
      li: [2, 0, 1][this.leapSecond + 1],
      rxTm: now,
      txTm: now,
    } as NtpData;
  }

  private async checkSystemTime(): Promise<void> {
    const ntpInfo = (await monitorProcess(spawn('ntpq', ['-p']), null, ErrorMode.NO_ERRORS)).split('\n');
    let gpsFound = false;

    for (const line of ntpInfo) {
      const $ = /^\*SHM\b.+\.PPS\.\s+0\s+l\s+.+?\s(-?[.\d]+)\s+[.\d]+\s*$/.exec(line);

      if ($ && Number($[1]) < 0.1) {
        gpsFound = true;
        break;
      }
    }

    this.systemTimeIsGps = gpsFound;

    const cd = await this.taiUtc.getCurrentDelta();

    if (cd.pendingLeapDate) {
      const ymd = parseISODate(cd.pendingLeapDate);
      const now = new Date();

      if (ymd.y === now.getUTCFullYear() && ymd.m === now.getUTCMonth() + 1)
        this.leapSecond = cd.pendingLeap;
      else
        this.leapSecond = 0;
    }
    else
      this.leapSecond = 0;

    this.clockCheckTimeout = setTimeout(() => {
      this.clockCheckTimeout = undefined;
      this.checkSystemTime();
    }, CLOCK_CHECK);
  }

  private async checkLocation(): Promise<void> {
    if (this.checkingLocation)
      return;

    this.checkingLocation = true;

    const now = processMillis();
    let coords = this.gpsData;

    // If there are old coordinates wait for at least a tenth of a kilometer change in
    // position before looking up name and timezone for new location.
    if (this.namedGpsData == null || now >= this.checkLocationRetry || roughDistanceBetweenLocationsInKm(
        this.namedGpsData.latitude, this.namedGpsData.longitude, coords.latitude, coords.longitude) >= 0.1) {
      delete this.gpsData.name;
      delete this.gpsData.timezone;

      this.namedGpsData = coords = {
        fix: this.gpsData.fix,
        signalQuality: this.gpsData.signalQuality,
        latitude: coords.latitude,
        longitude: coords.longitude,
        altitude: coords.altitude
      };

      if (this.googleKey) {
        try {
          const url = `https://maps.googleapis.com/maps/api/geocode/json?key=${this.googleKey}` +
            `&result_type=locality|administrative_area_level_3&latlng=${coords.latitude},${coords.longitude}`;
          const data = await requestJson(url);

          if (data?.status === 'OK' && data.results?.length > 0)
            coords.name = data.results[0].formatted_address;
        }
        catch (err) {
          this.checkLocationRetry = now + CHECK_LOCATION_RETRY_DELAY;
          console.error(err);
        }

        try {
          const url = `https://maps.googleapis.com/maps/api/timezone/json?key=${this.googleKey}` +
            `&location=${coords.latitude},${coords.longitude}&timestamp=${Math.floor(Date.now() / 1000)}`;
          const data = await requestJson(url);

          if (data?.status === 'OK' && data.timeZoneId)
            coords.timezone = data.timeZoneId;
        }
        catch (err) {
          this.checkLocationRetry = now + CHECK_LOCATION_RETRY_DELAY;
          console.error(err);
        }
      }
    }

    this.checkingLocation = false;
  }
}
