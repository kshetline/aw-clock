## 3.10.0



## 3.9.2

* Fixed timezone-related bug in new repeating alarms feature.

## 3.9.1

* I let compatibility with the Raspberry Pi 3B+ lapse. Installation on a Raspberry Pi 3B+ should now work once again.
* Firefox fix for format of 24-hour UTC time mode.

## 3.9.0

* Alarms can now be created that repeat biweekly, monthly, or yearly.

## 3.8.0

* Major new feature: Air quality current conditions and forecast.
* Update button in Settings dialog (if admin features are enabled) is now functional even when an updated software version is not pending, as a convenient way to reinstall the software and/or change installation options.
* Better handling of an unresponsive FTP connection used (as one option) for retrieving leap second info.

## 3.7.3

* Fixed auto-update process to work properly with Wayland.

> Note: You may need to manually update to this version by pulling the latest updates into your aw-clock repo and then running `sudo ./build.sh -i` or `sudo ./build.sh --ddev --reboot`.

## 3.7.2

* Added autostart support for Wayland with Labwc.
* Fixed problems starting service under any admin user other than `pi`.

## 3.7.1-do

* Better documentation on installation of the Adafruit GPS HAT.

## 3.7.0

* Now (at last!) works with Raspberry Pi 5.
* Option to launch clock in Firefox instead of Chrome.
* Option to launch clock (in Chromium) browser in a full-screen mode which is less restrictive than kiosk mode.

> Note: The work-around for a Chromium CSS text-indent bug, introduced in v3.6.0, doesn't always do the job. The Firefox launch mode can help get around that if your weather alerts are not scrolling properly. My Chromium bug report has, thankfully, been acknowledged, confirmed, set to P1 priority, and assigned to a developer. Perhaps a real fix for this bug will be available soon.

## 3.6.0

* Now works with Bookworm/Wayland autostart.
* Work-around for a Chromium browser bug that broke scrolling of the weather alert marquee.

## 3.5.4

* Fix Bookworm installation issues.
* Document Bookworm/Raspberry Pi 5 issues.

## 3.5.3

* Allow up to three outdoor remote temperature/humidity sensors.
* Improve polling for software updates.

## 3.5.2

* Fixed problem acknowledging alerts when alerts had non-unique ID codes.

## 3.5.1-do

* Documentation-only update: no code changes or bug fixes, just more clarity on the installation process.

## 3.5.0

* Added ability to acknowledge and hide weather alerts after they have been seen.
* Filtered alerts are collapsed by default in the alerts display.
* Fixed bug caused by selecting a previous location after deleting another previous location.

## 3.4.2

* That bug fix in 3.4.1? Turns out an alarm going off on the _same day_ clocks are changed could go off at the wrong time, not merely be displayed incorrectly. That's fixed now too.
* Fix initial AM/PM state of edited alarm.

## 3.4.1

* Fix a Daylight Saving Time bug that caused the displayed time for an upcoming alarm the day after a clock change to be off by an hour. (This self-corrected after midnight, and did not affect when the alarm actually went off.)

## 3.4.0

* Use local storage instead of cookies to save user settings.
* Remove debugging alert accidentally left in code.
* Smarter default settings for remote temperature/humidity sensors.

## 3.3.2

* Improve GPS signal fix detection.
* Select Location tab after clicking "Get GPS Location" to make acquisition of GPS coordinates more obvious.
* Fix installation `--launch` option.

## 3.3.1-wo.1

* Web-only update to emphasize that real indoor/outdoor temperature and humidity sensor data is available only via the Raspberry Pi project, and not available on the demo website.

## 3.3.1

* Slightly improved rendering of moon in sky map, with lunar eclipse darkening.
* New backup data source for IERS Bulletin A.

## 3.3.0

* Added weather alert filters.

## 3.2.4

* Fixed iOS Safari layout bug. This bug might have affected the layout of the planet symbols on other displays.
* HTTPS access to IERS Bulletin A is now tried first, before trying to access currently-offline FTP server. (If FTP access is permanently gone, an alternate backup access method will be added in the future).

## 3.2.3

* Position planets back over the top of clock hands.
* Improvements in handling of temporarily disabled alarms.

## 3.2.2

* Fix availability of Update button.

## 3.2.1

* Fix Firefox forecast clicking issues.

## 3.2.0

* Added the ability to temporarily disable upcoming alarms at a touch so, if you wake up before your alarm, you can prevent it from going off without worrying about forgetting to turn the alarm back on for the next day.
* Added HTTPS backup source for IERS Bulletin A, previously retrieved from only one FTP source, for obtaining ΔUT1 value.
* New option for solid clock hands over sky map, in addition to translucent clock hands or no clock hands at all.

## 3.1.2

* Fix forecast day click action for iOS. (This fix might also help with other touchscreens.)

## 3.1.1

* Improved touch/swipe interface for daily forecast.

## 3.1.0

* Allow users to add their own alarm tones.
* More built-in alarm tones.

## 3.0.0

* Added optional sky maps, allowing the clock face to be replaced with a map of the planets, stars, and constellations as they appear in your local sky.
* Added alarm clock feature, with daily and one-time alarms.
* Fixed bug in recognizing GPS clock sync when using updated `ntpq`.
* Improved software update notifications.
* Improved weather alert formatting.
* Improved installation reliability.
* Improved user settings dialog.
* Updated FTP leap second retrieval.

## 2.12.3

* Get default forecast if automatic location check fails.

## 2.12.2

* Fix for Visual Crossing and Weatherbit.io snowfall amounts.
* Time library updates.
* Improved weather alert formatting.

## 2.12.1

* Documentation corrections.
* Small update in how new automatic updates are detected.

## 2.12.0

* Added optional Visual Crossing weather service.
* Removed soon-to-be-discontinued Dark Sky weather service.
* Added ability to use a pool of multiple NTP servers.
* Added client option for choosing from among available weather services (if API keys have been provided to make more than one service available).

## 2.11.0

* Updated design of 3-D printed stand.

## 2.10.1

* Fixed a build error caused by an npm library update.
* Fixed missing Update button in Settings dialog when an update is available.
* Made GPS time-sync indicator less strict.
* Added NTP-sync indicator to show if your system clock is NTP-synced when GPS sync is gone.

## 2.10.0

* Added option to display wind speed in knots, in combination with either imperial or metric units.
* Fixed build error possibly triggered by some unknown security update.
* Fixed possible out-of-memory error during installation on Raspberry Pi with only 1 GB RAM.
* Fixed Settings dialog layout when indoor/outdoor temperature options are disabled.

## 2.9.3

* Moved settings button into lower right corner.
* Improved retrieval and display of ΔTAI/ΔUT1.
* Fixed browser Reload button.
* Provided option to disable kiosk mode for auto-start browser.
* Server stability improvements.
* Reduced calls to Google geocoding API.

## 2.9.2

* Better identifies Raspberry Pi hardware.

## 2.9.1

* Daylight Saving Time spring-forward/fall-back animation.
* Fixed some build issues caused by Node.js version 14 not being reliable on Raspberry Pi systems with less than 2 GB RAM — Node.js 12 used on these systems instead.
* Removed dependency on node-sass for basic installation, which was often the source of build problems. (If you are trying to modify the code as a developer, node-sass is still needed in the development process, but is now decoupled from deployment.)

## 2.8.5

* Minor dependency updates to fix Safari bug.
* Better detect node-sass build errors.

## 2.8.4

* Updated timezones to 2021a, with new ability to update timezones automatically, while running.
* New marquee weather summary.
* Yet another attempt to fix a pesky, hard-to-track-down, impossible-to-reproduce bug where weather forecasts mysteriously stop updating until you reboot.

## 2.8.2

* Updated timezones to 2020d.
* Fixed and improve ephemeris rise/set tracks.
* Fixed Raspbian detection.

## 2.8.0

* Added wind speed and barometric pressure.
* Added night sky indication to planet display.
* Improved forecast failover.

## 2.7.3

* Timezone database update (tz 2020b).

## 2.7.2

* Documentation update, outlining the physical construction of the clock using the included 3D stand design.
* Package updates.

## 2.7.1

* Fixed Safari transparent gradient problem.
* Fixed Firefox click detection problem.

## 2.7.0

* On a 16x9 or wider display, five days of forecast, instead of just four days, will be displayed without the need to scroll sideways.
* Fixed sometimes-off tap/click detection for forecast days and the sun/moon rise/set toggle.
* Fixed possible "snap-back" when scrolling forecast/alert dialog text.
* Added a 3D design file to project for printing a custom monitor stand, with mounting for Raspberry Pi and other project hardware.

## 2.6.1

* Fixed a user-settings bug for first-time users.

## 2.6.0

* Added option where digital time display shows UTC while analog clock shows local time.
* Improved forecast caching and forecast fallback to better handle failed forecast data.

## 2.5.1

* Improved wording of the README section about the planetary display.

## 2.5.0

* Added support for Weatherbit.io forecasts.
* Added hourly probability of precipitation, triggered by tap/click on hourly icons or temperatures.
* Weatherbit.io can now be used in place of, or in addition to, the Google geocoding API to translate GPS latitude/longitude into place names.
* Fixed bug with pop-up weather details for Weather Underground forecast.
* Prevented onscreen keyboard from covering alert dialogs.
* Made sure when running in kiosk mode that clicking on a weather service logo doesn't lead to the main display being blocked.
* Added automatic phase-out of Dark Sky API in December 2021.

## 2.4.0

* Added touchscreen support. This includes:
  * 7-day forecast, with four days shown at one time, using left/right swipe or tapping arrow icons to shift to the end or the beginning of the forecast week.
  * Tap on scrolling alert "ticker" at bottom of screen to see full text of current alerts.
  * Tap on forecast day to see textual summary for that day.
  * Tap on sunrise/sunset times to shift to display of moonrise/moonset times.
  * Tap on gear icon to bring up Settings dialog, with optional onscreen keyboard.
* Added GPS time support.
* Added GPS location support.
* Added notifications for software updates.
* Added optional onscreen administrative functions, provided through the Settings dialog. These include:
  * Reboot
  * Shutdown
  * Quit browser
  * Initiate software update.
* Added user customizable background and clock face colors.  
* Assorted minor bug fixes and performance improvements.

## 2.3.3

* Added hourly forecast feature.
* Can use darksky weather summary for wunderground forecast if available.
* Eliminated forecast refreshes for preference changes that don't require it.
* Fixed leap second display bug for timezones with positive UTC offset.

## 2.2.2

* Greatly simplified, optionally interactive, installation process.
* Service displays correct status for sudo service --status-all.
* Development data server now defaults to port 4201 without having to set the AWC_PORT environment variable.
* More consistent environment variable naming.
* Extra assistance in setting up default client settings, including IP-based guess at location, 24hr vs. AM/PM, Celsius vs. Fahrenheit.
* Improved recovery from TAI-UTC data errors.
* Improved formatting for AM/PM-style time.
* Special provisions for developing on Debian Linux with LXDE desktop as a close-to-Raspberry Pi substitute.
* Fixed for Weather Underground snow forecasts.

## 2.1.2

* Added a new weather data service, Weather Underground, so that a Dark Sky API key is not needed. Dark Sky is still an option as well, as either a backup (by default) or as a primary weather service.
* Equinox/solstice times are now displayed.
* A small change in rain/snow probability graphics, dependent on test of available emoji.
* Fixed display of indoor signal meter.
* Update of rpi-acu-rite-temperature library helps fix possible caching of corrupted data after a wireless sensor has stopped providing data.
* Fixed incorrect Weather Underground timestamp.
* Fixed Safari-only bug where signal meter graphic became clipped when tinted blue.

## 2.0.4

* Facilitated project development on Windows and non-Raspbian Linux (already worked on macOS).
* Display equinoxes and solstices.

## 2.0.2

* Support for remote temperature sensors.
* Updated buggy version of rpi-acu-rite-temperature package to fixed version.

## 1.2.7

* Added support for displaying ΔUT1 and ΔTAI.

## 1.2.6

* Reduced NTP polling rate.
* Updated linting and unit tests.

## 1.2.5

* Major updates of supporting npm packages.
* Applied webpack to deployment of server code.
* Improved build process for using of temperature/humidity sensor.
* Made use of AWC_ prefix for set-up environment variables consistent.

## 1.2.2

* Added NTP client, leap second handling, use of cached weather conditions/forecast for up to two hours when weather server access fails. Simplified build process for using DHT22 temperature/humidity sensor.

## 1.0.10

* Improved marquee. Added built-in font for astronomical symbols.

## 1.0.9

* Improved settings dialog appearance in Firefox and Safari.

## 1.0.8

* Made dialog grid layout work for IE 11.

## 1.0.7

* Improved logic of risen tracks.

## 1.0.6

* Added rise/set time indicator arcs for planets.
* Added option to debug time at accelerated rate.

## 1.0.5

* Added version number to settings dialog.

## 1.0.4

* More assorted code clean-up.

## 1.0.3

* Updated lint and e2e.

## 1.0.2

* Updated README.md.

## 1.0.1

* Fixed gear.svg image, so it's compatible with IE. Added MIT license to individual files.

## 1.0.0

* Initial release.
