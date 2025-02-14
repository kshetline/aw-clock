import { Request, Response, Router } from 'express';
import { average, filterError, jsonOrJsonp, noCache, stdDev, timeStamp, unref } from './awcs-util';
import { DhtSensorData } from './shared-types';
import { convertPinToGpio } from './rpi-pin-conversions';
import { purgeCache, requestJson } from './request-cache';

export const router = Router();

const DHT22_OR_AM2302 = 22;
const POLLING_INTERVAL = 10_000; // 10 seconds

type DhtSensorCallback = (err: any, temperature: number, humidity: number) => void;

interface NodeDhtSensor {
  read: (sensorType: number, gpio: number, callback: DhtSensorCallback) => void;
}

let indoorSensor: NodeDhtSensor;
let sensorGpio = process.env.AWC_WIRED_TH_GPIO ? convertPinToGpio(process.env.AWC_WIRED_TH_GPIO) : -1;

if (sensorGpio >= 0) {
  try {
    indoorSensor = require('node-dht-sensor');
  }
  catch {}

  if (!indoorSensor) {
    try {
      indoorSensor = require('node-dht-sensor-rp5');
    }
    catch {}
  }
}

let lastTemp: number;
let lastHumidity: number;
let temps: number[] = [];
let humidities: number[] = [];
let consecutiveSensorErrors = 0;
const MAX_ERRORS = 30;
const MAX_POINTS = 10;

if (process.env.AWC_WIRED_TH_GPIO && sensorGpio < 0) {
  console.warn(`Invalid value "${process.env.AWC_WIRED_TH_GPIO}" for AWC_WIRED_TH_GPIO, using GPIO 17.`);
  sensorGpio = 17;
}

export function hasWiredIndoorSensor(): boolean {
  return !!indoorSensor;
}

// The DHT-22 temperature/humidity sensor appears to be prone to spurious bad readings, so we'll attempt to
// screen out the noise.
function readSensor(): void {
  try {
    indoorSensor.read(DHT22_OR_AM2302, sensorGpio, (err: any, temperature: number, humidity: number) => {
      if (err || temperature < -10 || temperature > 50 || humidity < 0 || humidity > 100)
        ++consecutiveSensorErrors;
      else {
        consecutiveSensorErrors = 0;
        temps.push(temperature);
        humidities.push(humidity);

        if (temps.length > MAX_POINTS) {
          temps.shift();
          humidities.shift();
        }

        lastTemp = useLatestValueIfNotOutlier(temps);
        lastHumidity = useLatestValueIfNotOutlier(humidities);
      }

      if (consecutiveSensorErrors === MAX_ERRORS) {
        lastTemp = undefined;
        lastHumidity = undefined;
        temps = [];
        humidities = [];
      }

      unref(setTimeout(readSensor, POLLING_INTERVAL));
    });
  }
  catch (err) {
    // I'm not sure if indoorSensor.read() can actually throw an error or not, but sometimes the indoor
    // sensor never reports a value without restarting the server. One possible explanation is that the
    // first read attempt fails, throws an error, and without the code below would never be polled again.
    console.error('readSensor error: ' + filterError(err));
    unref(setTimeout(readSensor, POLLING_INTERVAL));
  }
}

// Report the latest temperature and humidity values that are no more than two standard deviations from the average.
// Use the average itself in case no point matches that criterion.
function useLatestValueIfNotOutlier(values: number[]): number {
  const avg = average(values);
  const sd2 = stdDev(values) * 2;
  let result = avg;

  for (let i = values.length - 1; i >= 0; --i) {
    const value = values[i];

    if (Math.abs(value - avg) < sd2) {
      result = value;
      break;
    }
  }

  return result;
}

if (indoorSensor)
  readSensor();

let warnIndoorNA = true;

router.get('/', async (req: Request, res: Response) => {
  noCache(res);

  let result: DhtSensorData;

  if (indoorSensor) {
    if (consecutiveSensorErrors >= MAX_ERRORS || lastTemp === undefined || lastHumidity === undefined) {
      console.error(timeStamp(), 'Failed to read indoor temp/humidity sensor.');
      result = { temperature: 0, humidity: -1, error: 'Sensor error' };
    }
    else
      result = { temperature: lastTemp, humidity: lastHumidity };
  }
  else if (process.env.AWC_ALT_DEV_SERVER) {
    const url = process.env.AWC_ALT_DEV_SERVER + '/indoor';

    try {
      result = await requestJson(/\blocalhost\b/.test(process.env.AWC_ALT_DEV_SERVER) ? 30 : 600, url);
    }
    catch (err) {
      purgeCache(url);
      res.status(500).send('Error connecting to development server: ' + err);
    }
  }
  else {
    if (warnIndoorNA) {
      console.warn('Indoor temp/humidity sensor not available.');
      warnIndoorNA = false;
    }

    result = { temperature: 0, humidity: -1, error: 'n/a' };
  }

  jsonOrJsonp(req, res, result);
});
