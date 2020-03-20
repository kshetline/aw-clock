import { jsonOrJsonp } from './common';
import { Request, Response, Router } from 'express';
import { DhtSensorData } from './forecast-types';
import { toBoolean } from 'ks-util';
import request from 'request';
import { average, noCache, stdDev } from './util';

export const router = Router();

const DHT22_OR_AM2302 = 22;

type DhtSensorCallback = (err: any, temperature: number, humidity: number) => void;

interface NodeDhtSensor {
  read: (sensorType: number, gpio: number, callback: DhtSensorCallback) => void;
}

let indoorSensor: NodeDhtSensor;

if (toBoolean(process.env.AWC_WIRED_TH_GPIO))
  indoorSensor = require('node-dht-sensor');

let lastTemp: number;
let lastHumidity: number;
let temps: number[] = [];
let humidities: number[] = [];
let consecutiveSensorErrors = 0;
const MAX_ERRORS = 5;
const MAX_POINTS = 10;
const sensorGpio = parseInt(process.env.AWC_WIRED_TH_GPIO, 10) || 4;

function readSensor() {
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

    setTimeout(readSensor, 10000);
  });
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

router.get('/', (req: Request, res: Response) => {
  noCache(res);

  let result: DhtSensorData;

  if (indoorSensor) {
    if (consecutiveSensorErrors >= MAX_ERRORS || lastTemp === undefined || lastHumidity === undefined) {
      console.error('Failed to read indoor temp/humidity sensor.');
      result = { temperature: 0, humidity: -1, error: 'Sensor error' };
    }
    else
      result = { temperature: lastTemp, humidity: lastHumidity };
  }
  else if (process.env.AWC_ALT_DEV_SERVER) {
    req.pipe(request({
      url: process.env.AWC_ALT_DEV_SERVER + '/indoor',
      method: req.method
    }))
      .on('error', err => {
        res.status(500).send('Error connecting to development server: ' + err);
      })
      .pipe(res);

    return;
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
