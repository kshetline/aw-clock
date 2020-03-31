## Astronomy/Weather Clock

![raspberry pi logo](https://shetline.com/misc/rpi_logo.svg)

This project is designed to create a desktop clock which provides weather and astronomical information. While primarily designed to run on a Raspberry Pi, the code will create a Node.js server and client web app that can be run on other computers and operating systems, albeit without the Raspberry Pi’s hardware-level support for wired and wireless temperature/humidity sensors.

The clock displays the time and date in both analog and digital form, in 12- or 24-hour format (with a special display mode for the occasional leap second). The clock also displays current weather conditions, hourly conditions for 24 hours, a four-day forecast, sunrise and sunset times, moon phases, equinoxes, solstices, and the positions of the Sun, Moon, and major planets along the ecliptic.

![app screenshot](https://shetline.com/misc/awc_2_3_0_screenshot.jpg)
<br/><br/>
### Getting started

To clone the repository and perform initial set-up for turning your Raspberry Pi into a _dedicated_ Astronomy/Weather Clock:

```shell script
$ git clone https://github.com/kshetline/aw-clock.git
$ cd aw-clock
$ sudo ./build.sh -i
```

There will possibly be a long delay the first time you run this script while Node.js (if necessary) and various npm packages are installed as a prerequisite to running the rest of the installation procedure.

You’ll then be prompted in the console for the initial configuration you desire. If you leave the `-i` off the end of the command above, an all-defaults installation will be performed automatically, with support for wired and wireless temperature/humidity sensors initially disabled.

As of v2.1.0 of this software no API key is required to get weather data. The default weather data, however, is now being acquired by “page scraping” [Weather Underground](https://www.wunderground.com/), not via a guaranteed stable API.

Obtaining a Dark Sky API key for back-up weather data is still, therefore, a good idea. (See https://darksky.net/ for further details.) You can also select Dark Sky as your primary weather source, using Weather Underground as a backup.

By default this application uses `pool.ntp.org` as an NTP time server (keeping its own time, rather than using the system clock), but you can use a different time server. Do not use a Google or Facebook time server, however, or any other NTP server that implements “leap second smearing”, if you want the Astronomy/Weather Clock to be able to display leap seconds as shown below:

![Hypothetical leap second](https://shetline.com/misc/moment_of_leap_second.jpg)

_This image is hypothetical — the pictured moment in time is not guaranteed to be an actual leap second. Video here: https://shetline.com/video/leap_second_display.mp4_

### Web browser client options

As soon as you’ve got the Astronomy/Weather Clock up and running the first time, you might want to click on the gear icon in the lower right corner of the web browser display to adjust the various user options which aren’t queried as part of the initial set-up.

Your city might be filled in automatically by using your IP address &mdash; but then again, it might not. If you're using this clock in a bedroom you might find the **Dimming** options very useful, as they establish a schedule during which the display will be reduced in brightness.

![app screenshot](https://shetline.com/misc/awc_2_3_0_dlog.jpg)

To close the web browser while it’s running in full-screen kiosk mode, press `Alt-F4`. To get out of full screen mode, but leave the browser running, press `Alt-F11`.

### Hardware set-up for temperature/humidity sensors

If you are running the server on a Raspberry Pi you have the option to display indoor temperature and humidity using a direct-wired DHT22/AM2302 sensor, as seen here: https://www.amazon.com/HiLetgo-Temperature-Humidity-Electronic-Practice/dp/B01N9BA0O4/. The wiring I describe below is specifically for the AM2302 version of the DHT22, with a built-in pull-up
resistor.

With your Raspberry Pi shut down and disconnected from power, connect the DHT22/AM2302 sensor. The code defaults to assuming the signal lead (“out”) of the sensor is connected to GPIO 4 (physical pin 7 on the 40-pin GPIO header). The `+` lead from the sensor needs to be connected to 5V (I chose pin 2 on the 40-pin GPIO header) and the `-` lead needs to be connected to ground (I chose pin 6).

![Picture of DHT wiring](https://shetline.com/misc/rpi-dht22-wiring.jpg)

Also for the Raspberry Pi you have the option to provide wireless indoor conditions and outdoor weather data using [433 MHz Acu Rite 06002M wireless temperature and humidity sensors](https://www.amazon.com/gp/product/B00T0K8NXC/) paired with a [433 MHz receiver module](https://www.amazon.com/gp/product/B00HEDRHG6/).

You can use one wireless sensor in lieu of a wired DHT22/AM2302 for indoor temperature and humidity, and you can use one or two wireless sensors for outdoor temperature and humidity. (When using multiple sensors, each must be set to a different channel — A, B, or C.)

An outdoor two-sensor set-up is useful when it’s difficult to find a single location for a sensor that isn’t overly warmed by the sun for at least part of the day. When you have two sensors, and signal is available from both, values from the cooler of the two sensors will be displayed.

With either one or two outdoor sensors the temperature displayed (in the largest text) will be pinned to be within ±2°C (±4°F) of the temperature supplied by the online weather service (a yellow tint of the temperature value indicates pinning is in effect). The “Feels like” temperature always comes from the weather service, not from your wireless sensors.

In small, gray print you can see the individual temperature values for each wireless sensor and from the forecast, regardless of what is displayed in large format. If any of your wireless sensors are running low on battery power, a red indicator will appear in the upper right corner of the display.

When connecting the 433 MHz receiver module follow the same precautions as specified for connecting the DHT22/AM2302. For my own set-up, I’ve connected the receiver’s +5V lead to physical pin 4 of the 40-pin connector, ground to pin 14, and data to pin 13 (GPIO 27, the set-up default value).

![Picture of 433MHz wiring](https://shetline.com/misc/rpi-433MHz-wiring.jpg)
<br/><br/>
### Info for code development, testing, and non-Raspberry Pi use

To build and run this project you can use the following commands:
   - “`sudo ./build.sh` &#x5B; _various-options_ &#x5D;” to run the installer.
   - “`npm run first-install`” to install all npm packages needed for both the client and the server (a separate, inner project) with one command.
   - “`npm run build` &#x5B;‑‑ _various-options_ &#x5D;” to build. (Please note the `‑‑` (double-dash) all by itself, which must come before all other options.)
   - “`npm run start-server`” to start the data server for this project (except on Windows) on `localhost:4201`. (You may need to make this precede this command with `sudo`.) The server will be automatically restarted whenever you edit the code.
   - “`npm run start-server-win`” to start the data server for this project (on Windows) on `localhost:4201`.
   - “`npm start`” to serve the web client using webpack-dev-server on `localhost:4200`. The client will be automatically restarted whenever you edit the code.. _(Note that for development and testing, two different ports are used, but that when the server is deployed, all content and data is served on one port, by default 8080.)_

> Note: A dependency on `node-sass` sometimes causes build problems. It often helps to delete the top level `node_modules` directory, and then do `npm install` over again. I’ve also found that using `LIBSASS_EXT=”no” npm install` helps.

To build the server along with the web client, use `npm run build`, possibly followed by `‑‑` and other options listed below:

| &nbsp; | &nbsp; |
| ------------------------------ | -------------------------------------------------------------- |
| `‑‑acu` |     Install support for wireless temperature/humidity sensors using a 433 MHz receiver module. |
| `‑‑acu‑` |     Clears saved `‑‑acu` setting when not using interactive mode. |
| `‑‑ddev` |     This stands for “dedicated device”. This is for setting up a Raspberry Pi to primarily serve as an Astronomy/Weather Clock, automatically booting as a clock in full-screen mode. This implies the `‑‑sd` option. |
| `‑‑dht` |     Install support for a wired DHT22/AM2302 temperature/humidity sensor. |
| `‑‑dht‑` |     Clears saved `‑‑dht` setting when not using interactive mode. |
| `‑‑help` |     Display brief help message. |
| `‑i` |     Interactive mode. This prompts you to enter various configuration options, and implies the `‑‑ddev` option.
| `‑‑launch` |     When installation is finished, launch the software. |
| `‑‑pt` |     This stands for “plain text”. It defeats console colors and animation. |
| `‑‑reboot` |     When installation is finished, reboot your system. |
| `‑‑sd` |     This stands for “standard deployment”. It causes the generated code to be moved to the `~/weather` directory, first deleting whatever might have already been there first. |
| `‑‑skip‑upgrade` |     This disables the `apt-get` update and upgrade normally performed as a standard part of the dedicated device set-up |
| `‑‑tarp` |     This stands for “treat as Raspberry Pi”. This option can be used on a Linux Debian system, using the LXDE desktop, to simulate most Raspberry Pi functionality. |

### Server configuration

The following environment variables affect how the server part of this software runs. They are defined in the file `etc/defaults/weatherService` for the purposes of the dedicated device set-up.

* `AWC_ALLOW_CORS`: CORS stands for “Cross-Origin Resource Sharing”, and is an HTTP security feature. Most HTTP servers disable CORS by default. This software, however, turns CORS on by default (by setting this environment variable to `true`) to allow data sharing when the server is running on port 4201 and the client on port 4200 during development testing. When running the clock as a deployed service, however, you can disable CORS by deleting `AWC_ALLOW_CORS` from the `etc/defaults/weatherService` file, or by setting it to `false`.
* `AWC_DARK_SKY_API_KEY`: If you want to use Dark Sky either as a primary or back-up weather data service, this must be set to a valid Dark Sky API key. (See https://darksky.net/ for further details.)
* `AWC_NTP_SERVER`: NTP server used by this software. (See previous comments about selecting alternate servers.)
* `AWC_PORT`: By default the deployed server runs on localhost port 8080, but you can use a different port if you prefer.
* `AWC_PREFERRED_WS`: Either `wunderground` or `darksky`.
* `AWC_WIRED_TH_GPIO`: The GPIO number for a wired indoor temperature/humidity sensor, if any. Delete (or do not define) this entry if you don’t have the wired sensor hardware connected.
* `AWC_WIRELESS_TH_GPIO`:  The GPIO number for the 433 MHz RF module that receives wireless temperature/humidity data, if any. Delete (or do not define) this entry if you don’t have the RF module connected, or the necessary wireless sensors.

Don't forget to run `sudo update-rc.d weatherService defaults` after editing the `weatherService` file.

### Installation details

For reference, here’s a break down of the steps performed by a full installation:

1. Node.js is installed if not present, or updated if earlier than version 12.
1. An `npm install` is performed to bootstrap the rest of the installation process, which is written in TypeScript and requires Node.js and serveral npm packages to function. This can be very slow the first time because of one npm package in particular &mdash; node-sass &mdash; which can take ten minutes or more to install and build.
1. If running in interactive mode (`‑i`), the user is queried about various configuration and installation options.
1. If the `weatherService` service is running, it’s stopped.
1. `apt-get update` and `apt-get upgrade` are executed, unless defeated with the `‑‑skip‑upgrade` option.
1. The following packages are installed, if not already present: `pigpio`, `chromium-browser` (just plain `chromium` on Debian), `unclutter`, `forever` (a global npm package, not via apt-get), and a few fonts as well.
1. `xscreensaver` is then disabled. Why install a screen saver just to turn around and disable it? To make sure no other screen saver blanks the screen - the display of the clock is intended to stay on 24/7.
1. The application client is built.
1. The application server is built.
1. If specified, server options for wired and/or wireless sensors are installed.
1. A combined client/server distribution directory is created.
1. If any of the options `‑‑ddev`, `‑i`, or `‑‑sd` are used, the distribution is copied to the `~/weather` directory (typically `/home/pi/weather`), deleting anything which might have previously been present in that directory.

    _No further steps listed below are performed except as part of dedicated device set-up (options `‑‑ddev` or `‑i`)_.
1. The file `weatherService` (located in the `raspberry_pi_setup` folder) is copied to `/etc/init.d/`, and changed to root ownership.
1. Server set-up options are saved to `/etc/defaults/weatherService`, which is also owned by root. Rather than re-running the installer to change the server set-up, you can edit this file directly, update the service with `sudo update-rc.d weatherService defaults`, then restart the server either by rebooting your system, or using the command `sudo service weatherService restart`.
1. The commands `sudo update-rc.d weatherService defaults` and `sudo systemctl enable weatherService` are performed to establish and enable the service.
1. An `autostart` file is created in `~/.config/lxsession/LXDE-pi/` (no `-pi` on the end for Debian), or the existing `autostart` file is modified, to launch the Chromium web browser in kiosk mode, displaying the Astronomy/Weather Clock.
1. The included file `autostart_extra.sh` is also copied to the above directory. This adds code to make sure Chromium doesn’t launch complaining that it was shut down improperly, which could interfere with an otherwise smooth automatic start-up.
1. The options `‑‑launch` or `‑‑reboot` are performed if specified.
