// import { processMillis, toNumber } from 'ks-util';
// import { floor, round } from 'ks-math';
import { TaiUtc } from './tai-utc';
import { CurrentDelta } from './time-types';

const LEAP_SECOND_POLL_RATE = 86_400_000; // Once per day
const LEAP_SECOND_RETRY_RATE = 300_000; // Once per five minutes

export interface Coordinates {
  latitude: number;
  longitude: number;
  altitude: number;
}

export class Gps {
  // private lastCoordinates: Coordinates;
  // private lastLocationRead = 0;
  // private lastSatCount = 0;
  private leapSecondInfo: CurrentDelta;

  constructor(
    pin: number | string,
    private taiUtc: TaiUtc
  ) {
    this.leapSecondCheck();
  }

  private leapSecondCheck(): void {
    this.taiUtc.getCurrentDelta().then(cd => {
      this.leapSecondInfo = cd;
      console.log(this.leapSecondInfo);
      setTimeout(() => this.leapSecondCheck, LEAP_SECOND_POLL_RATE);
    }).catch(() => setTimeout(() => this.leapSecondCheck, LEAP_SECOND_RETRY_RATE));
  }
}
