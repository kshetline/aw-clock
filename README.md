## Astronomy/Weather Clock

To test and build this project you can use the following commands:
   - "`npm run lint`" to inspect the code with ESLint.
   - "`npm run build` &#x5B;-- &#x5B;`--dht`&#x5D; &#x5B;`--acu`&#x5D;&#x5D;" to build (with optional support for wired and/or wireless temperature/humidity sensors).
   - "`npm test`" to run unit tests.
   - "`npm run start-server`" to start the data server for this project.
   - "`npm start`" to serve the web client using webpack-dev-server.
   - "`npm run e2e`" to run Protractor for end-to-end tests.

> Note: As of the time of this writing, the build will not work with Node 11 or later on Linux (including Raspbian) because of a dependency on `node-sass`. Even when using Node 10.x or earlier you might get some errors with `npm install` due to `node-sass`. I found that using `LIBSASS_EXT="no" npm install` helped. (If you have a problem, and this doesn't fix it, search for solutions based on `node-sass` and any specific error messages you receive.) This project currently does not support development on Windows.

The server requires a Dark Sky API key for weather data. Use the environment variable `AWC_DARK_SKY_API_KEY` to set the key. (See https://darksky.net/ for further details.)

By default the server uses `pool.ntp.org` as an NTP time server. Use the environment variable `AWC_NTP_SERVER` to change the time server. Do not use a Google time server, or any other NTP server that implements "leap second smearing" if you want the Astronomy/Weather Clock to be able to display leap seconds.

![Hypothetical leap second](https://shetline.com/misc/moment_of_leap_second.jpg)

_This image is hypothetical — the pictured moment in time is not guaranteed to be an actual leap second. Video here: https://shetline.com/video/leap_second_display.mp4_

To deploy the server along with the web client, use `npm run build` (possibly followed by `--`, then the `--dht` and/or `--acu` options as described above), executed in the project's root directory. The contents of the root-level `dist` directory will then contain the Node.js server code, and the client code in the `dist/public` directory. For example:

| &nbsp; | &nbsp; |
| ------------------------------ | -------------------------------------------------------------- |
| `npm run build` | &nbsp;&nbsp;&nbsp;&nbsp;Simple server/client with no indoor or outdoor sensors. |
| `npm run build -- --dht` | &nbsp;&nbsp;&nbsp;&nbsp;Server/client with wired indoor sensor support. |
| `npm run build -- --dht --acu` | &nbsp;&nbsp;&nbsp;&nbsp;Server/client with both wired and wireless sensor support. |

If you are running the server on a Raspberry Pi, you have the option to provide wired indoor temperature and humidity data using a DHT22/AM2302 sensor, as seen here: https://www.amazon.com/HiLetgo-Temperature-Humidity-Electronic-Practice/dp/B01N9BA0O4/. The wiring I will describe is specifically for the AM2302 version of the DHT22, with the built-in pull-up
resistor.

First, you must install the BCM 2835 library as described here: http://www.airspayce.com/mikem/bcm2835/

Then, with your Raspberry Pi shut down and disconnected from power, connect the DHT22/AM2302 sensor. The code defaults to assuming the signal lead ("out") of the sensor is connected to GPIO 4 (physical pin 7 on the 40-pin GPIO header). You can use the environment variable `AWC_TH_SENSOR_GPIO` to set a different GPIO number. The `+` lead from the sensor needs to be connected to 5V (I chose pin 2 on the 40-pin GPIO header) and the `-` lead needs to be connected to ground (I chose pin 6).

![Picture of wiring](https://shetline.com/misc/rpi-dht22-wiring.jpg)

The web client only displays the indoor temperature and humidity values when connected to the web server on `localhost:8080`.

Also for the Raspberry Pi you have the option to provide wireless indoor and outdoor weather data using [433 MHz Acu Rite 06002M wireless temperature and humidity sensors](https://www.amazon.com/gp/product/B00T0K8NXC/) paired with a [433 MHz receiver module](https://www.amazon.com/gp/product/B00HEDRHG6/).

You can use one wireless sensor in lieu of a wired DHT22/AM2302 for indoor temperature and humidity, and you can use one or two wireless sensors for outdoor temperature and humidity. (When using multiple sensors, each must be set to a different channel — A, B, or C.)

A two-sensor set-up is useful when it's difficult to find a single location for a sensor that isn't overly warmed by the sun for at least part of the day. When you have two sensors, and signal is available from both, values from the cooler of the two sensors will be displayed.

With either one or two outdoor sensors the displayed temperature will be pinned to be with ±2°C (±4°F) of the temperature supplied by the online weather service. The "Feels like" temperature always comes from the weather service, not from your wireless sensors.

When connecting the 433 Mhz receiver module, follow the same precautions as given for connecting the DHT22/AM2302. For my own set-up, I've connected the receiver's +5V lead to physical pin 4 of the 40-pin connector, ground to pin 14, and data to pin 13 (GPIO 27).

I can't guarantee that I'm recalling every important step I took to create my own set-up, but hopefully the following is a more-or-less complete guide to setting up a Raspberry Pi to automatically boot up as a full-screen astronomy/weather clock:

1. Install Node.js version 10.x. (You can find instructions for this step here: https://www.w3schools.com/nodejs/nodejs_raspberrypi.asp.) Later versions of Node may work if and when node-sass is updated to be compatible.
1. Clone this project and, from the root directory of the project, do `npm install`.
1. Install the Chromium browser if it's not already installed:
`sudo apt-get install chromium-browser`
1. Install `unclutter` (this will hide your mouse cursor after 30 seconds of inactivity so it doesn't obscure the display): `sudo apt-get install unclutter`
1. Install `xscreensaver` if it's not already installed (`sudo apt-get install xscreensaver`). This is needed not because you want a screen saver for this application &mdash; in fact, you want the screen to stay on all of the time without interruption. Installing `xscreensaver` gives you the option of going to your Raspberry Pi's Preferences and _turning off_ the default screen blanking that will otherwise occur.
1. Build the client project as described above (`npm run build`, with or without `--dht` or `--acu` options as described above).
1. Copy the contents of this project's `dist` folder to `/home/pi/weather`.
1. If you wish to use an indoor wired temperature/humidity sensor, follow the previously mentioned steps to install the BCM 2835 library and connect the sensor.
1. If you wish to use wireless temperature/humidity sensors, follow those previous instructions.
1. Copy the included file `weatherService` (located in the `raspberry_pi_setup` folder) to `/etc/init.d/`. Make sure the file is owned by
`root` is set to be executable. Follow the instructions listed inside that file to set up the necessary environment variables, which will
be saved in `/etc/defaults/weatherService`. This is where you add your API key, and set `AWC_HAS_INDOOR_SENSOR` to `true` if you're
connecting an indoor temperature/humidity sensor.
    * _Don't forget that if you update this project, you may need to manually update `/etc/init.d/weatherService` too._
1. Use the command `sudo update-rc.d weatherService defaults` to establish the service that starts up the weather server.
1. Use the command `sudo systemctl enable weatherService` to enable the service.
1. `sudo npm install -g forever` — this installs a utility to monitor and automatically restart the server if necessary.
1. Copy the included files `autostart` and `autostart_extra.sh` to `/home/pi/.config/lxsession/LXDE-pi/` and make sure they're executable. This launches the astronomy/weather clock client in Chromium, using kiosk mode (full screen, no toolbars). It also makes sure Chromium doesn't launch complaining that it was shut down improperly.
1. I'm not sure about the current copyright disposition of these fonts, but for improved appearance I'd recommend finding and installing the fonts "Arial Unicode MS" and "Verdana". These appear to be freely available for download without licensing restrictions.
1. Reboot, and if all has gone well, the astronomy/weather clock be up and running. Click on the gear icon in the lower right corner of the app to set your preferences, such as the location to use for weather forecasts and astronomical observations.
