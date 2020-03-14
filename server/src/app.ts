// #!/usr/bin/env node
import { jsonOrJsonp } from './common';
import cookieParser from 'cookie-parser';
import { Daytime, DaytimeData, DEFAULT_DAYTIME_SERVER } from './daytime';
import express, { Router } from 'express';
import { router as forecastRouter } from './forecast-router';
import * as http from 'http';
import { toBoolean } from 'ks-util';
import logger from 'morgan';
import { DEFAULT_NTP_SERVER } from './ntp';
import { NtpPoller } from './ntp-poller';
import * as path from 'path';
import { DEFAULT_LEAP_SECOND_URLS, TaiUtc } from './tai-utc';
import { router as tempHumidityRouter, cleanUp } from './temp-humidity-router';
import { noCache, normalizePort } from './util';

const debug = require('debug')('express:server');

let indoorRouter: Router;

if (process.env.AWC_HAS_INDOOR_SENSOR || process.env.AWC_ALT_DEV_SERVER)
  indoorRouter = require('./indoor-router').router;

const allowCors = toBoolean(process.env.AWC_ALLOW_CORS);

// create http server
const httpPort = normalizePort(process.env.AWC_PORT || 8080);
const app = getApp();
const httpServer = http.createServer(app);

// listen on provided ports
httpServer.listen(httpPort);

function shutdown() {
  console.log('\n*** closing server ***');
  // Make sure that if the orderly clean-up gets stuck, shutdown still happens.
  setTimeout(() => process.exit(0), 5000);
  cleanUp();
  NtpPoller.closeAll();
  httpServer.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// add error handler
httpServer.on('error', onError);

// start listening on port
httpServer.on('listening', onListening);

// The DHT-22 temperature/humidity sensor appears to be prone to spurious bad readings, so we'll attempt to
// screen out the noise.

const ntpServer = process.env.AWC_NTP_SERVER || DEFAULT_NTP_SERVER;
const ntpPoller = new NtpPoller(ntpServer);
const daytimeServer = process.env.AWC_DAYTIME_SERVER || DEFAULT_DAYTIME_SERVER;
const daytime = new Daytime(daytimeServer);
const leapSecondsUrl = process.env.AWC_LEAP_SECONDS_URL || DEFAULT_LEAP_SECOND_URLS;
let taiUtc = new TaiUtc(leapSecondsUrl);

if (process.env.AWC_DEBUG_TIME) {
  const parts = process.env.AWC_DEBUG_TIME.split(';'); // UTC-time [;optional-leap-second]
  ntpPoller.setDebugTime(new Date(parts[0]), Number(parts[1] || 0));
  const debugDelta = Date.now() - new Date(parts[0]).getTime();
  taiUtc = new TaiUtc(leapSecondsUrl, () => Date.now() - debugDelta);
}

/**
 * Event listener for HTTP server 'error' event.
 */
function onError(error: any) {
  if (error.syscall !== 'listen')
    throw error;

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
      if (req.method === 'OPTIONS')
        res.send(200);
      else {
        next();
      }
    });
  }

  theApp.use('/forecast', forecastRouter);
  theApp.use('/wireless-th', tempHumidityRouter);

  if (indoorRouter)
    theApp.use('/indoor', indoorRouter);
  else {
    theApp.get('/indoor', (req, res) => {
      console.warn('Indoor temp/humidity sensor not available.');
      jsonOrJsonp(req, res, { temperature: 0, humidity: -1, error: 'n/a' });
    });
  }

  theApp.get('/ntp', (req, res) => {
    noCache(res);
    jsonOrJsonp(req, res, ntpPoller.getTimeInfo());
  });

  theApp.get('/daytime', async (req, res) => {
    noCache(res);

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

  theApp.get('/tai-utc', async (req, res) => {
    noCache(res);
    jsonOrJsonp(req, res, await taiUtc.getCurrentDelta());
  });

  theApp.get('/ls-history', async (req, res) => {
    noCache(res);
    jsonOrJsonp(req, res, await taiUtc.getLeapSecondHistory());
  });

  return theApp;
}
