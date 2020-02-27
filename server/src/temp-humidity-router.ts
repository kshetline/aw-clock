import { Request, Response, Router } from 'express';
import { jsonOrJsonp } from './common';
import { noCache } from './util';

export interface TempHumidityData {
  batteryLow: boolean;
  channel: string;
  humidity: number;
  reliable: boolean;
  signalQuality: number;
  temperature: number;
  time: number;
}

export const router = Router();

let callbackId = -1;
const MAX_DATA_AGE = 900_000; // 15 minutes
const readings: Record<string, TempHumidityData> = {};
let addSensorDataListener: (pin: number | string, callback: (data: any) => void) => number;
let removeSensorDataListener: (id: number) => void;

function removeOldData() {
  const oldestAllowed = Date.now() - MAX_DATA_AGE;

  Object.keys(readings).forEach(key => {
    if (readings[key].time < oldestAllowed)
      delete readings[key];
  });
}

if (process.env.AWC_WIRELESS_TEMP) {
  try {
    ({ addSensorDataListener, removeSensorDataListener } = require('rpi-acu-rite-temperature'));

    callbackId = addSensorDataListener(process.env.AWC_WIRELESS_TEMP, originalData => {
      removeOldData();

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

  let result: any;

  if (callbackId >= 0) {
    removeOldData();
    result = readings;
  }
  else
    result = { error: 'n/a' };

  jsonOrJsonp(req, res, result);
});

export function cleanUp() {
  if (removeSensorDataListener && callbackId >= 0)
    removeSensorDataListener(callbackId);
}
