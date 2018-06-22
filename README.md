## Astronomy/Weather Clock

To test and build the web client project, you can use the following commands:
   - "`npm run lint`" to inspect the code with TSLint.
   - "`npm run build`" to build.
   - "`npm test`" to run unit tests.
   - "`npm start`" to serve the app using webpack-dev-server.
   - "`npm run e2e`" to run Protractor for end-to-end tests.

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

I can't guarantee that I'm recalling every important step I took to create my own set-up, but
hopefully the following is a more-or-less complete guide to setting up a Raspberry Pi to
automatically boot up as a full-screen astronomy/weather clock:

1) Install the Chromium browser if it's not already installed:
`sudo apt-get install chromium-browser`
2) Install unclutter (this will hide your mouse cursor after 30 seconds of inactivity so it doesn't
obscure the display): `sudo apt-get install unclutter`
3) Install an up-to-date node.js. (You can find instructions for this step here: https://www.w3schools.com/nodejs/nodejs_raspberrypi.asp.)
4) Copy the contents of this project's `server` folder to `/home/pi/weather`.
5) If you wish to use an indoor temperature/humidity sensor, follow the previously mentioned
steps to install the BCM 2835 library and connect the sensor.
6) `cd /home/pi/weather`
7) `npm install`
8) Build the client project as described above, and copy the contents of the `dist` directory to
`/home/pi/weather/public`.
9) Copy the included file `weatherService` to `/etc/init.d/`. Make sure the file is owned by
`root` is set to be executable. Follow the instructions listed inside that file to set up
the necessary environment variables, including setting `HAS_INDOOR_SENSOR` to `true` if you're
connecting an indoor temperature/humidity sensor.
10) Use the command `sudo update-rc.d weatherService defaults` to establish the service that
starts up the weather server.
11) `npm install -g forever`
12) Copy the included files `autostart` and `autostart_extra.sh` to
`/home/pi/.config/lxsession/LXDE-pi/` and make sure they're executable. This launches the
 astronomy/weather clock client in Chromium, in kiosk mode (full screen, no toolbars). It also
 makes sure Chromium doesn't launch complaining that it was shut down improperly.
13) I'm not sure about the current copyright disposition of these fonts, but for improved
appearance I'd recommend finding and installing the fonts "Arial Unicode MS" and "Verdana".
These appear to be freely available for download without licensing restrictions.
