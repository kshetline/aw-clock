import { ChildProcess } from 'child_process';
import { ErrorMode, monitorProcess, spawn } from './process-util';

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
  private gpspipe: ChildProcess;
  private lastCoordinates: Coordinates = {} as Coordinates;
  private lastFix = 0;
  private lastSatCount = 0;

  constructor() {
    this.gpspipe = spawn('gpspipe', ['-w']);

    this.gpspipe.stdout.on('data', data => {
      try {
        const obj = JSON.parse(data.toString());

        if (obj?.class === 'TPV' && obj.lat != null) {
          this.lastCoordinates = {
            latitude: obj.lat,
            longitude: obj.lon,
            altitude: obj.altHAE ?? obj.alt ?? 0
          };
          this.lastFix = obj.mode ?? this.lastFix;
          console.log(this.lastCoordinates, this.lastFix, this.lastSatCount);
        }
        else if (obj?.class === 'SKY' && Array.isArray(obj.satellites))
          this.lastSatCount = obj.satellites.length;
      }
      catch {}
    });
  }

  public close(): void {
    this.gpspipe.kill('SIGINT');
  }
}
