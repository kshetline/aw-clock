import { Request, Response, Router } from 'express';
import { jsonOrJsonp } from './common';
import request from 'request';
import { noCache } from './util';
import { processMillis } from 'ks-util';

export interface TempHumidityItem {
  batteryLow: boolean;
  channel: string;
  humidity: number;
  reliable: boolean;
  signalQuality: number;
  temperature: number;
  time: number;
}

export interface TempHumidityData {
  A?: TempHumidityItem;
  B?: TempHumidityItem;
  C?: TempHumidityItem;
  deadAir?: boolean;
  error?: string;
}

export const router = Router();

let callbackId = -1;
const MAX_DATA_AGE = 900_000; // 15 minutes
const DEAD_AIR_WARINING_DURATION = 90_000; // 90 seconds
const readings: Record<string, TempHumidityItem> = {};
let addSensorDataListener: (pin: number | string, callback: (data: any) => void) => number;
let removeSensorDataListener: (id: number) => void;
let lastDeadAir = -1;

function removeOldData() {
  const oldestAllowed = Date.now() - MAX_DATA_AGE;

  Object.keys(readings).forEach(key => {
    if (readings[key].time < oldestAllowed)
      delete readings[key];
  });
}

if (process.env.AWC_WIRELESS_TEMP && !process.env.AWC_ALT_DEV_SERVER) {
  try {
    ({ addSensorDataListener, removeSensorDataListener } = require('rpi-acu-rite-temperature'));

    callbackId = addSensorDataListener(process.env.AWC_WIRELESS_TEMP, originalData => {
      removeOldData();

      if (originalData.channel === '-') {
        lastDeadAir = processMillis();
        return;
      }

      const data = {
        batteryLow: originalData.batteryLow,
        channel: originalData.channel,
        humidity: originalData.humidity,
        reliable: originalData.validChecksum,
        signalQuality: originalData.signalQuality,
        temperature: originalData.tempCelsius,
        time: Date.now()
      };

      const oldData = readings[data.channel];

      if (!oldData)
        lastDeadAir = -1;

      if (data.reliable || !oldData || !oldData.reliable)
        readings[data.channel] = data;
      else
        oldData.signalQuality = data.signalQuality;
    });
  }
  catch (err) {
    console.error(err);
  }
}

router.get('/', (req: Request, res: Response) => {
  noCache(res);

  let result: TempHumidityData;

  if (process.env.AWC_ALT_DEV_SERVER) {
    req.pipe(request({
      url: process.env.AWC_ALT_DEV_SERVER + '/wireless-th',
      method: req.method
    }))
      .on('error', err => {
        res.status(500).send('Error connecting to development server: ' + err);
      })
      .pipe(res);

    return;
  }
  else if (callbackId >= 0) {
    removeOldData();
    result = {};
    Object.keys(readings).forEach(key => (result as any)[key] = readings[key]);

    if (lastDeadAir >= 0 && lastDeadAir + DEAD_AIR_WARINING_DURATION > processMillis())
      result.deadAir = true;
  }
  else
    result = { error: 'n/a' };

  jsonOrJsonp(req, res, result);
});

export function cleanUp() {
  if (removeSensorDataListener && callbackId >= 0)
    removeSensorDataListener(callbackId);
}
