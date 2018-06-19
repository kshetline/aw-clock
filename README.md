##Astronomy/Weather Clock

To test and build the web client project, you can use the following commands:
   - "`npm run build`" to build.
   - "`npm test`" to run unit tests.
   - "`npm start`" to serve the app using webpack-dev-server.
   - "`npm run e2e`" to run Protractor.

To run the weather server, use "`npm start`" from within the server directory.

The server requires a Dark Sky API key to function. Use the environment variable `DARK_SKY_API_KEY`
to set the key. (See https://darksky.net/ for further details.)

To deploy the server along with the web client, use `npm run build` as described above, then copy the
contents of the `dist` directory into the server's `public` directory.

If you are running the server on a Raspberry Pi, you have the option to provide indoor temperature and
humidity data using a DHT22/AM2302 sensor, as seen here: https://www.amazon.com/HiLetgo-Temperature-Humidity-Electronic-Practice/dp/B01N9BA0O4/.
The wiring I will describe is specifically for the AM2302 version of the DHT22, with the built-in pull-up
resistor.

First, you must install the BCM 2835 library as described here: http://www.airspayce.com/mikem/bcm2835/

Then delete the file in the server directory named `package.json`, followed by renaming the file `package.json.for-dht-sensor.json`
to `package.json`. Next run `npm install` from within the server directory.

With your Raspberry Pi shut down, and disconnected from power, connect the DHT22/AM2302 sensor.
The code defaults to assuming the signal lead ("out") of the sensor is connected to GPIO 4 (pin 7 on the GPIO
header). You can use the environment variable `SENSOR_GPIO` to set a different GPIO number.
The + lead from the sensor needs to be connect to 5V (I chose pin 2 on the GPIO header) and
the - lead needs to be connected to ground (I chose pin 6).

![Picture of wiring](http://shetline.com/misc/rpi-dht22-wiring.jpg)

The web client only displays the indoor temperature and humidity values when connected to the
web server on `localhost:8080`.
