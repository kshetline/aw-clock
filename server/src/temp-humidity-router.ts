import { Request, Response, Router } from 'express';
import { addSensorDataListener, removeSensorDataListener } from 'rpi-acu-rite-temperature';
import { jsonOrJsonp } from './common';

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
const MAX_DATA_AGE = 1800000; // half an hour
const readings: Record<string, TempHumidityData> = {};

function removeOldData() {
  const oldestAllowed = Date.now() - MAX_DATA_AGE;

  Object.keys(readings).forEach(key => {
    if (readings[key].time < oldestAllowed)
      delete readings[key];
  });
}

if (process.env.AWC_WIRELESS_TEMP) {
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
  });
}

router.get('/', (req: Request, res: Response) => {
  res.setHeader('cache-control', 'no-cache, no-store');

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
  if (callbackId >= 0)
    removeSensorDataListener(callbackId);
}
