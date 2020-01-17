// #!/usr/bin/env node
import { NtpPoller } from './ntp-poller';
import { average, normalizePort, stdDev, toBoolean } from './util';

import * as http from 'http';
import express from 'express';
import * as path from 'path';
import cookieParser from 'cookie-parser';
import logger from 'morgan';
import request from 'request';
import { Daytime, DaytimeData, DEFAULT_DAYTIME_SERVER } from './daytime';
import { DEFAULT_LEAP_SECOND_URLS, TaiUtc } from './tai-utc';
import { DEFAULT_NTP_SERVER } from './ntp';

const debug = require('debug')('express:server');

const DHT22_OR_AM2302 = 22;

type DhtSensorCallback = (err: any, temperature: number, humidity: number) => void;

interface NodeDhtSensor {
  read: (sensorType: number, gpio: number, callback: DhtSensorCallback) => void;
}

let indoorSensor: NodeDhtSensor;

if (toBoolean(process.env.AWC_HAS_INDOOR_SENSOR)) {
  indoorSensor = require('node-dht-sensor');
}

const allowCors = toBoolean(process.env.AWC_ALLOW_CORS);

// create http server
const httpPort = normalizePort(process.env.AWC_PORT || 8080);
const app = getApp();
const httpServer = http.createServer(app);

// listen on provided ports
httpServer.listen(httpPort);

process.on('SIGTERM', () => {
  console.log('*** closing server ***');
  NtpPoller.closeAll();
  httpServer.close();
});

// add error handler
httpServer.on('error', onError);

// start listening on port
httpServer.on('listening', onListening);

// The DHT-22 temperature/humidity sensor appears to be prone to spurious bad readings, so we'll attempt to
// screen out the noise.

let lastTemp: number;
let lastHumidity: number;
let temps: number[] = [];
let humidities: number[] = [];
let consecutiveSensorErrors = 0;
const MAX_ERRORS = 5;
const MAX_POINTS = 10;
const sensorGpio = parseInt(process.env.AWC_TH_SENSOR_GPIO, 10) || 4;
const ntpServer = process.env.AWC_NTP_SERVER || DEFAULT_NTP_SERVER;
const ntpPoller = new NtpPoller(ntpServer);
const daytimeServer = process.env.AWC_DAYTIME_SERVER || DEFAULT_DAYTIME_SERVER;
const daytime = new Daytime(daytimeServer);
const leapSecondsUrl = process.env.AWC_LEAP_SECONDS_URL || DEFAULT_LEAP_SECOND_URLS;
const taiUtc = new TaiUtc(leapSecondsUrl);

if (process.env.AWC_DEBUG_TIME) {
  const parts = process.env.AWC_DEBUG_TIME.split(';'); // UTC-time [;optional-leap-second]
  ntpPoller.setDebugTime(new Date(parts[0]), Number(parts[1] || 0));
}

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

if (indoorSensor) {
  readSensor();
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

/**
 * Event listener for HTTP server 'error' event.
 */
function onError(error: any) {
  if (error.syscall !== 'listen') {
    throw error;
  }

  const bind = typeof httpPort === 'string'
    ? 'Pipe ' + httpPort
    : 'Port ' + httpPort;

  // handle specific listen errors with friendly messages
  switch (error.code) {
    case 'EACCES':
      console.error(bind + ' requires elevated privileges');
      process.exit(1);
      break;
    case 'EADDRINUSE':
      console.error(bind + ' is already in use');
      process.exit(1);
      break;
    default:
      throw error;
  }
}

/**
 * Event listener for HTTP server 'listening' event.
 */
function onListening() {
  const addr = httpServer.address();
  const bind = typeof addr === 'string'
    ? 'pipe ' + addr
    : 'port ' + addr.port;
  debug('Listening on ' + bind);
}

function getApp() {
  const theApp = express();

  theApp.use(logger(':remote-addr - :remote-user [:date[iso]] ":method :url HTTP/:http-version" :status :res[content-length] :response-time'));
  theApp.use(express.json());
  theApp.use(express.urlencoded({ extended: false }));
  theApp.use(cookieParser());
  theApp.use(express.static(path.join(__dirname, 'public')));
  theApp.get('/', (req, res) => {
    res.send('Static home file not found');
  });

  if (allowCors) {
    // see: http://stackoverflow.com/questions/7067966/how-to-allow-cors-in-express-nodejs
    theApp.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      // intercept OPTIONS method
      if (req.method === 'OPTIONS') {
        res.send(200);
      }
      else {
        next();
      }
    });
  }

  theApp.use('/darksky', (req, res) => {
    let url = `https://api.darksky.net/forecast/${process.env.AWC_DARK_SKY_API_KEY}${req.url}`;
    let frequent = false;
    const match = /(.*)(&id=)([^&]*)$/.exec(url);

    if (match) {
      url = match[1];

      if (process.env.AWC_FREQUENT_ID && match[3] === process.env.AWC_FREQUENT_ID)
        frequent = true;
    }

    req.pipe(request({
      url: url,
      qs: req.query,
      method: req.method
    }))
      .on('response', remoteRes => {
        remoteRes.headers['cache-control'] = 'max-age=' + (frequent ? '240' : '840');
      })
      .on('error', err => {
        res.status(500).send('Error connecting to Dark Sky: ' + err);
      })
      .pipe(res);
  });

  let warnIndoorNA = true;

  theApp.use('/indoor', (req, res) => {
    res.setHeader('cache-control', 'no-cache, no-store');

    let result: any;

    if (indoorSensor) {
      if (consecutiveSensorErrors >= MAX_ERRORS || lastTemp === undefined || lastHumidity === undefined) {
        console.error('Failed to read indoor temp/humidity sensor.');
        result = { temperature: 0, humidity: -1, error: 'Sensor error' };
      }
      else
        result = { temperature: lastTemp, humidity: lastHumidity };
    }
    else {
      if (warnIndoorNA) {
        console.warn('Indoor temp/humidity sensor not available.');
        warnIndoorNA = false;
      }

      result = { temperature: 0, humidity: -1, error: 'n/a' };
    }

    if (req.query.callback)
      res.jsonp(result);
    else
      res.json(result);
  });

  theApp.use('/ntp', (req, res) => {
    res.setHeader('cache-control', 'no-cache, no-store');

    const result = ntpPoller.getTimeInfo();

    if (req.query.callback)
      res.jsonp(result);
    else
      res.json(result);
  });

  theApp.use('/daytime', async (req, res) => {
    res.setHeader('cache-control', 'no-cache, no-store');

    let time: DaytimeData;

    try {
      time = await daytime.getDaytime();
    }
    catch (err) {
      res.status(500).send(err.toString());

      return;
    }

    if (req.query.callback)
      res.jsonp(time);
    else if (req.query.json != null)
      res.json(time);
    else
      res.send(time.text);
  });

  theApp.use('/tai-utc', async (req, res) => {
    res.setHeader('cache-control', 'no-cache, no-store');

    const currentDelta = await taiUtc.getCurrentDelta();

    if (req.query.callback)
      res.jsonp(currentDelta);
    else
      res.json(currentDelta);
  });

  theApp.use('/ls-history', async (req, res) => {
    res.setHeader('cache-control', 'no-cache, no-store');

    const history = await taiUtc.getLeapSecondHistory();

    if (req.query.callback)
      res.jsonp(history);
    else
      res.json(history);
  });

  return theApp;
}
