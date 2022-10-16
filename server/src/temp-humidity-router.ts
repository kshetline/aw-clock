import { Request, Response, Router } from 'express';
import { processMillis } from '@tubular/util';
import { jsonOrJsonp, noCache } from './awcs-util';
import { TempHumidityItem, TempHumidityData } from './shared-types';
import { purgeCache, requestJson } from './request-cache';

export const router = Router();

let callbackId = -1;
const MAX_DATA_AGE = 900_000; // 15 minutes
const DEAD_AIR_WARNING_DURATION = 90_000; // 90 seconds
const readings: Record<string, TempHumidityItem> = {};
let addSensorDataListener: (pin: number | string, callback: (data: any) => void) => number;
let removeSensorDataListener: (id: number) => void;
let lastDeadAir = -1;

export let defaultOutdoorChannel = 'A';

function removeOldData(): void {
  const oldestAllowed = Date.now() - MAX_DATA_AGE;

  Object.keys(readings).forEach(key => {
    if (readings[key].time < oldestAllowed)
      delete readings[key];
  });
}

// Convert deprecated environment variable
if (!process.env.AWC_WIRELESS_TH_GPIO && process.env.AWC_WIRELESS_TEMP)
  process.env.AWC_WIRELESS_TH_GPIO = process.env.AWC_WIRELESS_TEMP;

if (process.env.AWC_WIRELESS_TH_GPIO && !process.env.AWC_ALT_DEV_SERVER) {
  try {
    ({ addSensorDataListener, removeSensorDataListener } = require('rpi-acu-rite-temperature'));

    callbackId = addSensorDataListener(process.env.AWC_WIRELESS_TH_GPIO, originalData => {
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

export async function getTempHumidityData(): Promise<TempHumidityData> {
  let result: TempHumidityData;

  if (process.env.AWC_ALT_DEV_SERVER) {
    const url = process.env.AWC_ALT_DEV_SERVER + '/wireless-th';

    try {
      result = await requestJson(/\blocalhost\b/.test(process.env.AWC_ALT_DEV_SERVER) ? 30 : 600, url);
    }
    catch (err) {
      purgeCache(url);
      result = { error: err };
    }
  }
  else if (callbackId >= 0) {
    removeOldData();
    result = {};
    Object.keys(readings).forEach(key => (result as any)[key] = readings[key]);

    if (lastDeadAir >= 0 && lastDeadAir + DEAD_AIR_WARNING_DURATION > processMillis())
      result.deadAir = true;
  }
  else
    result = { error: 'n/a' };

  defaultOutdoorChannel = 'A';

  for (const chan of ['A', 'B', 'C']) {
    if ((result as any)[chan]?.reliable) {
      defaultOutdoorChannel = chan;
      break;
    }
  }

  return result;
}

router.get('/', async (req: Request, res: Response) => {
  noCache(res);

  const result: TempHumidityData = await getTempHumidityData();

  if (result.error)
    res.status(500).send('Error connecting to development server: ' + result.error);
  else
    jsonOrJsonp(req, res, result);
});

export function cleanUp(): void {
  if (removeSensorDataListener && callbackId >= 0)
    removeSensorDataListener(callbackId);
}
