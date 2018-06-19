'use strict';

const debug = require('debug')('express:server');
const http = require('http');
const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const request = require('request');
let indoorSensor;

if (toBoolean(process.env.HAS_INDOOR_SENSOR)) {
  indoorSensor = require('node-dht-sensor');
}

const indexRouter = require('./routes/index');
const usersRouter = require('./routes/users');

//create http server
const httpPort = normalizePort(process.env.PORT || 8080);
const app = getApp();
app.set('port', httpPort);
const httpServer = http.createServer(app);

//listen on provided ports
httpServer.listen(httpPort);

//add error handler
httpServer.on('error', onError);

//start listening on port
httpServer.on('listening', onListening);


// The DHT-22 temperature/humidity sensor appears to be prone to spurious bad readings, so we'll attempt to
// screen out the noise.

let lastTemp;
let lastHumidity;
let temps = [];
let humidities = [];
let consecutiveSensorErrors = 0;
const MAX_ERRORS = 5;
const MAX_POINTS = 10;
const sensorGpio = parseInt(process.env.SENSOR_GPIO) || 4;

function readSensor() {
  indoorSensor.read(22, sensorGpio, (err, temperature, humidity) => {
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

      // Report the latest temperature and humidity values that are no more than two standard deviations from the average.
      // Use the average itself in case no point matches that criterion.
      const avgTemp = average(temps);
      const sdTemp2 = stdDev(temps) * 2;

      lastTemp = avgTemp;

      for (let i = temps.length - 1; i >= 0; --i) {
        const temp = temps[i];

        if (Math.abs(temp - avgTemp) < sdTemp2) {
          lastTemp = temp;
          break;
        }
      }

      const avgHumidity = average(humidities);
      const sdHumidity2 = stdDev(humidities) * 2;

      lastHumidity = avgHumidity;

      for (let i = humidities.length - 1; i >= 0; --i) {
        const humidity = humidities[i];

        if (Math.abs(humidity - avgHumidity) < sdHumidity2) {
          lastHumidity = humidity;
          break;
        }
      }
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

/**
 * Normalize a port into a number, string, or false.
 */
function normalizePort(val) {
  const port = parseInt(val, 10);

  if (isNaN(port)) {
    // named pipe
    return val;
  }

  if (port >= 0) {
    // port number
    return port;
  }

  return false;
}

/**
 * Event listener for HTTP server 'error' event.
 */
function onError(error) {
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
  const app = express();

  // view engine setup
  app.set('views', path.join(__dirname, 'views'));
  app.set('view engine', 'jade');

  app.use(logger(':remote-addr - :remote-user [:date[iso]] ":method :url HTTP/:http-version" :status :res[content-length] :response-time'));
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use(express.static(path.join(__dirname, 'public')));

  if (toBoolean(process.env.ALLOW_CORS)) {
    // see: http://stackoverflow.com/questions/7067966/how-to-allow-cors-in-express-nodejs
    app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      // intercept OPTIONS method
      if ('OPTIONS' === req.method) {
        res.send(200);
      }
      else {
        next();
      }
    });
  }

  app.use('/', indexRouter);
  app.use('/users', usersRouter);

  app.use('/darksky', function(req, res) {
    let url = `https://api.darksky.net/forecast/${process.env.DARK_SKY_API_KEY}${req.url}`;
    let frequent = false;
    const match = /(.*)(&id=)([^&]*)$/.exec(url);

    if (match) {
      url = match[1];

      if (process.env.FREQUENT_ID && match[3] === process.env.FREQUENT_ID)
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

  let waitingForIndoorSensor = [];

  app.use('/indoor', function(req, res) {
    res.setHeader('cache-control', 'no-cache, no-store');

    if (indoorSensor) {
      if (consecutiveSensorErrors >= MAX_ERRORS || lastTemp === undefined || lastHumidity === undefined) {
        console.error('Failed to read indoor temp/humidity sensor.');
        res.json({temperature: 0, humidity: -1, error: 'Sensor error'});
      }
      else
        res.json({temperature: lastTemp, humidity: lastHumidity});
    }
    else {
      console.error('Indoor temp/humidity sensor not available.');
      res.json({temperature: 0, humidity: -1, error: 'n/a'});
    }
  });

  // catch 404 and forward to error handler
  app.use((req, res, next) => {
    next(createError(404));
  });

  // error handler
  app.use((err, req, res) => {
    // set locals, only providing error in development
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};

    // render the error page
    res.status(err.status || 500);
    res.render('error');
  });

  return app;
}

function average(values) {
  return values.reduce((sum, value) => sum + value) / values.length;
}

function stdDev(values) {
  const avg = average(values);
  const squaredDiffs = values.map(value => {
    const diff = avg - value;
    return diff * diff;
  });

  return Math.sqrt(average(squaredDiffs));
}

function toBoolean(str) {
  if (/^(true|t|yes|y)$/i.test(str))
    return true;
  else if (/^(false|f|no|n)$/i.test(str))
    return false;

  const n = Number(str);

  if (!isNaN(n))
    return n !== 0;

  return undefined;
}

module.exports = app;
