## Astronomy/Weather Clock

To test and build the web client project, you can use the following commands:
   - "`npm run lint`" to inspect the code with TSLint.
   - "`npm run build`" to build _without_ support for temperature/humidity sensor.
   - "`npm run build-for-dht`" to build _with_ support for temperature/humidity sensor.
   - "`npm test`" to run unit tests.
   - "`npm start`" to serve the app using webpack-dev-server.
   - "`npm run e2e`" to run Protractor for end-to-end tests.

> Note: As of the time of this writing, the build will not work with Node 11 or later on Linux (including Raspbian)
because of a dependency on `node-sass`. Even when using Node 10.x or earlier you might get some errors with `npm install`
due to `node-sass`. I found that using `LIBSASS_EXT="no" npm install` helped. If you have a problem, and this doesn't
fix it, search for solutions based on `node-sass` and any specific error messages you recieve.


To run the weather server, use "`npm start`" from within the server directory.

The server requires a Dark Sky API key to function. Use the environment variable `DARK_SKY_API_KEY`
to set the key. (See https://darksky.net/ for further details.)

By default, the server uses `pool.ntp.org` as an NTP time server. Use the environment variable `AWC_NTP_SERVER`
to changes the time server. Do not use a Google time server, or any other NTP server that implements "leap second
smearing" if you want the Astronomy/Weather Clock to be able to display leap seconds.

To deploy the server along with the web client, use `npm run build` (or `npm run build-for-dht`) as described above. The
contents of the `dist` directory will be copied into the server's `public` directory.

If you are running the server on a Raspberry Pi, you have the option to provide indoor temperature and
humidity data using a DHT22/AM2302 sensor, as seen here: https://www.amazon.com/HiLetgo-Temperature-Humidity-Electronic-Practice/dp/B01N9BA0O4/.
The wiring I will describe is specifically for the AM2302 version of the DHT22, with the built-in pull-up
resistor.

First, you must install the BCM 2835 library as described here: http://www.airspayce.com/mikem/bcm2835/

Then, with your Raspberry Pi shut down and disconnected from power, connect the DHT22/AM2302 sensor.
The code defaults to assuming the signal lead ("out") of the sensor is connected to GPIO 4 (pin 7 on the GPIO
header). You can use the environment variable `SENSOR_GPIO` to set a different GPIO number.
The `+` lead from the sensor needs to be connect to 5V (I chose pin 2 on the GPIO header) and
the `-` lead needs to be connected to ground (I chose pin 6).

![Picture of wiring](https://shetline.com/misc/rpi-dht22-wiring.jpg)

The web client only displays the indoor temperature and humidity values when connected to the
web server on `localhost:8080`.

I can't guarantee that I'm recalling every important step I took to create my own set-up, but
hopefully the following is a more-or-less complete guide to setting up a Raspberry Pi to
automatically boot up as a full-screen astronomy/weather clock:

1. Install the Chromium browser if it's not already installed:
`sudo apt-get install chromium-browser`
1. Install `unclutter` (this will hide your mouse cursor after 30 seconds of inactivity so it doesn't
obscure the display): `sudo apt-get install unclutter`
1. Install `xscreensaver` if it's not already installed (`sudo apt-get install xscreensaver`). This is needed not because you want a
screen saver for this application &mdash; in fact, you want the screen to stay on all of the time without interruption. Installing
`xscreensaver` gives you the option of going to your Raspberry Pi's Preferences and *turning off* the default screen blanking that will
otherwise occur.
1. Install an up-to-date node.js. (You can find instructions for this step here: https://www.w3schools.com/nodejs/nodejs_raspberrypi.asp.)
1. Build the client project as described above (`npm run build-for-dht`, or `npm run build` if you aren't installing the DHT22/AM2302 sensor).
1. Copy the contents of this project's `server/dist` folder to `/home/pi/weather`.
1. If you wish to use an indoor temperature/humidity sensor, follow the previously mentioned
steps to install the BCM 2835 library and connect the sensor.
1. `cd /home/pi/weather`
1. `npm install`
1. Copy the included file `weatherService` (located in the `raspberry_pi_setup` folder) to `/etc/init.d/`. Make sure the file is owned by
`root` is set to be executable. Follow the instructions listed inside that file to set up the necessary environment variables, which will
be saved in `/etc/defaults/weatherService`. This is where you add your API key, and set `HAS_INDOOR_SENSOR` to `true` if you're
connecting an indoor temperature/humidity sensor.
1. Use the command `sudo update-rc.d weatherService defaults` to establish the service that
starts up the weather server.
1. `sudo npm install -g forever`
1. Copy the included files `autostart` and `autostart_extra.sh` to
`/home/pi/.config/lxsession/LXDE-pi/` and make sure they're executable. This launches the
 astronomy/weather clock client in Chromium, in kiosk mode (full screen, no toolbars). It also
 makes sure Chromium doesn't launch complaining that it was shut down improperly.
1. I'm not sure about the current copyright disposition of these fonts, but for improved
appearance I'd recommend finding and installing the fonts "Arial Unicode MS" and "Verdana".
These appear to be freely available for download without licensing restrictions.
1. Reboot, and if all has gone well, the astronomy/weather clock be up and running. Click on the gear icon in the lower right corner of
the app to set your preferences, such as the location to use for weather forecasts and astronomical observations.
