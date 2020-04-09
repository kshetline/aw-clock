import { ChildProcess } from 'child_process';
import { ErrorMode, monitorProcess, spawn } from './process-util';

const BILLION = BigInt('1000000000');
const THOUSAND = BigInt('1000');
const TWO_MILLION = BigInt('2000000');
const CLOCK_CHECK = 30_000; // Half minute

export interface Coordinates {
  latitude: number;
  longitude: number;
  altitude: number;
}

async function hasCommand(command: string): Promise<boolean> {
  return !!(await monitorProcess(spawn('which', [command]), null, ErrorMode.ANY_ERROR)).trim();
}

export async function hasGps(): Promise<boolean> {
  return await hasCommand('gpspipe') || await hasCommand('ntpq');
}

export class Gps {
  private clockCheckTimeout: any;
  private coordinates: Coordinates = {} as Coordinates;
  private deltaGps: number;
  private fix = 0;
  private gpspipe: ChildProcess;
  private satelliteCount = 0;
  private systemTimeIsGps = false;

  constructor() {
    this.gpspipe = spawn('gpspipe', ['-w']);

    this.gpspipe.stdout.on('data', data => {
      try {
        const obj = JSON.parse(data.toString());

        if (obj?.class === 'TPV' && obj.lat != null) {
          this.coordinates = {
            latitude: obj.lat,
            longitude: obj.lon,
            altitude: obj.altHAE ?? obj.alt ?? 0
          };
          this.fix = obj.mode ?? this.fix;
        }
        else if (obj?.class === 'SKY' && Array.isArray(obj.satellites))
          this.satelliteCount = obj.satellites.length;
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

  public getCoordinates(): Coordinates {
    return this.coordinates;
  }

  public getFix(): number {
    return this.fix;
  }

  public getSatelliteCount(): number {
    return this.satelliteCount;
  }

  public close(): void {
    this.gpspipe.kill('SIGINT');

    if (this.clockCheckTimeout)
      clearTimeout(this.clockCheckTimeout);
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
    this.clockCheckTimeout = setTimeout(() => {
      this.clockCheckTimeout = undefined;
      this.checkSystemTime();
    }, CLOCK_CHECK);
  }
}
