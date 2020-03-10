## Astronomy/Weather Clock

This project is designed to create a desktop clock which provides weather and astronomical information. While primarily designed to run on a Raspberry Pi, the code will create a Node.js server and client web app that can be run on other computers and operating systems, albeit without the Raspberry Pi’s hardware-level support for wired and wireless temperature/humidity sensors.

The clock displays the time and date in both analog and digital form, in 12- or 24-hour format (with a special display mode for the occasional leap second). The clock also displays current weather conditions, a four-day forecast, sunrise and sunset times, moon phases, equinoxes, solstices, and the positions of the Sun, Moon, and major planets along the ecliptic.

### Getting started

Cloning the repository and initial set-up:

```shell script
$ git clone https://github.com/kshetline/aw-clock.git
$ cd aw-clock
$ npm run first-install
```
While it’s typical to do `npm install` upon first cloning a project, this project is two projects in one &mdash; client and server &mdash; so `npm run first-install` gets both initial installations done at the same time.

To build and run this project you can use the following commands:
   - “`npm run build` &#x5B;-- &#x5B;`--acu`&#x5D; &#x5B;`--dht`&#x5D; &#x5B; `--pt`&#x5D; &#x5B;`--sd`&#x5D;&#x5D;” to build (with optional support for wired and/or wireless temperature/humidity sensors).
   - “`npm run start-server`” to start the data server for this project (not for Windows) on `localhost:4201`.
   - “`npm run start-server-win`” to start the data server for this project (for Windows) on `localhost:4201`.
   - “`npm start`” to serve the web client using webpack-dev-server on `localhost:4200`. _(Note that for development and testing, two different ports are used, but that when the server is deployed, all content and data is served on one port, by default 8080.)_

> Note: A dependency on `node-sass` sometimes causes build problems. It often helps to delete the top level `node_modules` directory, and then do `npm install` over again. I’ve also found that using `LIBSASS_EXT=”no” npm install` helps.

As of v2.1.0 of this software no API key is required to get weather data. The default weather data, however, is now being acquired by “page scraping” [Weather Underground](https://www.wunderground.com/), not via a guaranteed stable API.

Obtaining a Dark Sky API key for back-up weather data is still, therefore, a good idea. Use the environment variable `AWC_DARK_SKY_API_KEY` to set the key. (See https://darksky.net/ for further details.) You can also set the environment variable `AWS_PREFERRED_WS` to `darksky` to make Dark Sky your primary weather source, with Weather Underground as a backup.

By default the server uses `pool.ntp.org` as an NTP time server. Use the environment variable `AWC_NTP_SERVER` to change the time server. Do not use a Google time server, or any other NTP server that implements “leap second smearing”, if you want the Astronomy/Weather Clock to be able to display leap seconds.

![Hypothetical leap second](https://shetline.com/misc/moment_of_leap_second.jpg)

_This image is hypothetical — the pictured moment in time is not guaranteed to be an actual leap second. Video here: https://shetline.com/video/leap_second_display.mp4_

To build the server along with the web client, use `npm run build` (possibly followed by `--`, then the `--acu`, `--dht`, and/or other options), executed in the project’s root directory. The contents of the root-level `dist` directory will then contain the Node.js server code, with the client code in the `dist/public` directory. For example:

| &nbsp; | &nbsp; |
| ------------------------------ | -------------------------------------------------------------- |
| `npm run build` | &nbsp;&nbsp;&nbsp;&nbsp;Simple server/client with no indoor or outdoor sensors. |
| `npm run build -- --dht` | &nbsp;&nbsp;&nbsp;&nbsp;Server/client with wired indoor sensor support. |
| `npm run build -- --dht --acu` | &nbsp;&nbsp;&nbsp;&nbsp;Server/client with both wired and wireless sensor support. |

This `--pt` option is for “plain text”, meaning that console colors and progress animation are disabled.

The Raspberry Pi-only option `--sd` deploys the app to the default `~/weather` directory (typically `/home/pi/weather`).

_(Note: Don’t forget the extra double dashes by themselves that must be present before the other options!)_

If you are running the server on a Raspberry Pi you have the option to display indoor temperature and humidity data using a direct-wired DHT22/AM2302 sensor, as seen here: https://www.amazon.com/HiLetgo-Temperature-Humidity-Electronic-Practice/dp/B01N9BA0O4/. The wiring I will describe is specifically for the AM2302 version of the DHT22, with the built-in pull-up
resistor.

First, you must install the BCM 2835 library as described here: http://www.airspayce.com/mikem/bcm2835/

Then, with your Raspberry Pi shut down and disconnected from power, connect the DHT22/AM2302 sensor. The code defaults to assuming the signal lead (“out”) of the sensor is connected to GPIO 4 (physical pin 7 on the 40-pin GPIO header). You can use the environment variable `AWC_TH_SENSOR_GPIO` to set a different GPIO number. The `+` lead from the sensor needs to be connected to 5V (I chose pin 2 on the 40-pin GPIO header) and the `-` lead needs to be connected to ground (I chose pin 6).

![Picture of wiring](https://shetline.com/misc/rpi-dht22-wiring.jpg)

The web client only displays the indoor temperature and humidity values when connected to the web server on `localhost:8080`.

Also for the Raspberry Pi you have the option to provide wireless indoor conditions and outdoor weather data using [433 MHz Acu Rite 06002M wireless temperature and humidity sensors](https://www.amazon.com/gp/product/B00T0K8NXC/) paired with a [433 MHz receiver module](https://www.amazon.com/gp/product/B00HEDRHG6/).

You can use one wireless sensor in lieu of a wired DHT22/AM2302 for indoor temperature and humidity, and you can use one or two wireless sensors for outdoor temperature and humidity. (When using multiple sensors, each must be set to a different channel — A, B, or C.)

An outdoor two-sensor set-up is useful when it’s difficult to find a single location for a sensor that isn’t overly warmed by the sun for at least part of the day. When you have two sensors, and signal is available from both, values from the cooler of the two sensors will be displayed.

With either one or two outdoor sensors the displayed temperature will be pinned to be within ±2°C (±4°F) of the temperature supplied by the online weather service. The “Feels like” temperature always comes from the weather service, not from your wireless sensors.

When connecting the 433 Mhz receiver module, follow the same precautions as given for connecting the DHT22/AM2302. For my own set-up, I’ve connected the receiver’s +5V lead to physical pin 4 of the 40-pin connector, ground to pin 14, and data to pin 13 (GPIO 27).

I can’t guarantee that I’m recalling every important step I took to create my own set-up, but hopefully the following is a more-or-less complete guide to setting up a Raspberry Pi to automatically boot up as a full-screen astronomy/weather clock:

1. Install Node.js, preferably the latest LTS version. (You can find instructions for this step here: https://www.w3schools.com/nodejs/nodejs_raspberrypi.asp.)
1. Install the BCM 2835 library, as described here: http://www.airspayce.com/mikem/bcm2835/
1. `pigpio` is probably already installed on your Raspberry Pi, but it may need to be updated, particularly if you’re using a Raspberry Pi 4. That’s described here: http://abyz.me.uk/rpi/pigpio/download.html. As I write this the `pigpio` website says, “At the moment pigpio on the Pi4B is experimental.” This project’s software was a bit flaky until I upgraded `pigpio` from the pre-installed version 71 to version 74.
1. Install the Chromium browser if it’s not already installed:
`sudo apt-get install chromium-browser`
1. Install `unclutter` (this will hide your mouse cursor after 30 seconds of inactivity so it doesn’t obscure the display): `sudo apt-get install unclutter`
1. Install `xscreensaver` if it’s not already installed (`sudo apt-get install xscreensaver`). This is needed not because you want a screen saver for this application &mdash; in fact, you want the screen to stay on all of the time without interruption. Installing `xscreensaver` gives you the option of going to your Raspberry Pi’s Preferences and _turning off_ the default screen blanking that will otherwise occur.
1. Clone this project and, from the root directory of the project, do `npm run first-install`.
1. Build the client project as described above (`npm run build -- --sd`, with or without the `--dht`, `--acu`, or other options described above).
1. If you wish to use an indoor wired temperature/humidity sensor, follow the previously mentioned steps to install the BCM 2835 library and connect the sensor.
1. If you wish to use wireless temperature/humidity sensors, follow those previous instructions.
1. Copy the included file `weatherService` (located in the `raspberry_pi_setup` folder) to `/etc/init.d/`. Make sure the file is owned by `root` and is set to be executable with `chmod +x`. Follow the instructions listed inside that file to set up the necessary environment variables, which will
be saved in `/etc/defaults/weatherService`. This is where you add your Dark Sky API key if you're using one, set `AWC_HAS_INDOOR_SENSOR` to `true` if you’re
connecting an indoor temperature/humidity sensor. and set other environment variable options.
    * _Don’t forget that if you update this project, you may need to manually update `/etc/init.d/weatherService` too._
1. Use the command `sudo update-rc.d weatherService defaults` to establish the service that starts up the weather server.
1. Use the command `sudo systemctl enable weatherService` to enable the service.
1. `sudo npm install -g forever` — this installs a utility to monitor and automatically restart the server if necessary.
1. Copy the included files `autostart` and `autostart_extra.sh` to `/home/pi/.config/lxsession/LXDE-pi/` and make sure they’re executable using `chmod +x`. This launches the astronomy/weather clock client in Chromium, using kiosk mode (full screen, no toolbars). It also makes sure Chromium doesn’t launch complaining that it was shut down improperly.
1. I’m not sure about the current copyright disposition of these fonts, but for improved appearance I’d recommend finding and installing the fonts “Arial Unicode MS” and “Verdana”. These appear to be freely available for download without licensing restrictions.
1. Adding color emoji fonts isn't necessary, but this improves the display of rain/snow probability. Instructions here: https://raspberrypi.stackexchange.com/questions/104181/colored-emojis-in-chromium
1. Reboot, and if all has gone well, the astronomy/weather clock will be up and running. Click on the gear icon in the lower right corner of the app to set your preferences, such as the location to use for weather forecasts and astronomical observations.
