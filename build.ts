/// <reference path="./ambient.d.ts" />
import Chalk from 'chalk';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as readline from 'readline';
import { Key } from 'readline';
import { asLines, isFunction, isNumber, isObject, isString, processMillis, toBoolean, toInt, toNumber } from '@tubular/util';
import * as path from 'path';
import { convertPinToGpio } from './server/src/rpi-pin-conversions';
import { ErrorMode, getSudoUser, getUserHome, monitorProcess, monitorProcessLines, sleep, spawn } from './server/src/process-util';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { escapeForRegex } from './server/src/awcs-util';

const enoughRam = os.totalmem() / 0x40000000 > 1.5;

// Deal with weird issue where 'copyfiles' gets imported in an inconsistent manner.
let copyfiles: any = require('copyfiles');

if (copyfiles.default)
  copyfiles = copyfiles.default;

readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);

const CHECK_MARK = '\u2714';
const FAIL_MARK = '\u2718';
const SPIN_CHARS = '|/-\\';
const SPIN_DELAY = 100;

const isWindows = (process.platform === 'win32');

let spinStep = 0;
let lastSpin = 0;
let doUpdateUpgrade = true;
let doNpmI = true;
let npmInitDone = false;
let doAcu = false;
let clearAcu = false;
let clearFirefox = false;
let doAdmin: boolean;
let doDht = false;
let clearDht = false;
let doFirefox: boolean | null = null;
let doFullscreen: boolean | null = null;
let doKiosk: boolean | null = null;
let clearFullscreen = false;
let clearKiosk = false;
let doStdDeploy = false;
let doDedicated = false;
let doLaunch = false;
let doReboot = false;
let hasFirefox = false;
let noStop = false;
let prod = false;
let viaBash = false;
let interactive = false;
let treatAsRaspberryPi = process.argv.includes('--tarp');
let isRaspberryPi = false;
let isRaspberryPi5OrLater = false;

let spin = (): void => {
  const now = processMillis();

  if (lastSpin < now - SPIN_DELAY) {
    lastSpin = now;
    write(backspace + SPIN_CHARS.charAt(spinStep));
    spinStep = (spinStep + 1) % 4;
  }
};

interface ExtendedChalk extends Chalk.Chalk {
  mediumGray: (s: string) => string;
  paleBlue: (s: string) => string;
  paleYellow: (s: string) => string;
}

const chalk = new Chalk.Instance() as ExtendedChalk;

chalk.mediumGray = chalk.hex('#808080');
chalk.paleBlue = chalk.hex('#66CCFF');
chalk.paleYellow = chalk.hex('#FFFFAA');

let backspace = '\x08';
let sol = '\x1B[1G';
let trailingSpace = '  '; // Two spaces
let totalSteps = 2;
let currentStep = 0;
const settings: Record<string, string> = {
  AWC_ALLOW_ADMIN: 'false',
  AWC_ALLOW_CORS: 'true',
  AWC_KIOSK_MODE: 'kiosk',
  AWC_LOG_CACHE_ACTIVITY: 'false',
  AWC_NTP_SERVERS: '',
  AWC_PORT: '8080',
  AWC_PREFERRED_WS: 'wunderground',
  AWC_USE_FIREFOX: 'false',
  AWC_WIRED_TH_GPIO: '17',
  AWC_WIRELESS_TH_GPIO: '27'
};

const userHome = getUserHome();
const sudoUser = getSudoUser();
const user = process.env.SUDO_USER || process.env.USER || 'pi';
let uid: number;
const cpuPath = '/proc/cpuinfo';
const cpuPath2 = '/sys/firmware/devicetree/base/model';
const settingsPath = '/etc/default/weatherService';
const rpiSetupStuff = path.join(__dirname, 'raspberry_pi_setup');
const serviceSrc = rpiSetupStuff + '/weatherService';
const serviceDst = '/etc/init.d/weatherService';
const fontSrc = rpiSetupStuff + '/fonts/';
const fontDst = '/usr/local/share/fonts/';
let chromium = 'chromium';
let autostartDst = '.config/lxsession/LXDE';
const lxdePiCheck = '.config/lxpanel/LXDE-pi';
const wayfireIni = '.config/wayfire.ini';
let nodePath = process.env.PATH;

if (process.platform === 'linux') {
  try {
    if (fs.existsSync(cpuPath)) {
      const lines = asLines(fs.readFileSync(cpuPath).toString());

      if (fs.existsSync(cpuPath2))
        lines.push(...asLines(fs.readFileSync(cpuPath2).toString()));

      for (const line of lines) {
        if (!isRaspberryPi && /\b(Raspberry Pi|BCM\d+)\b/i.test(line)) {
          isRaspberryPi = treatAsRaspberryPi = true;
          autostartDst += '-pi';
          chromium += '-browser';

          if (isRaspberryPi5OrLater)
            break;
        }

        if (!isRaspberryPi5OrLater && toInt((/Model\s+:\s+Raspberry Pi (\d+)/.exec(line) || [])[1]) >= 5) {
          isRaspberryPi5OrLater = true;

          if (isRaspberryPi)
            break;
        }
      }
    }
  }
  catch (err) {
    console.error(chalk.redBright('Raspberry Pi check failed'));
  }
}

if ((isRaspberryPi || treatAsRaspberryPi) && !process.env.DISPLAY) {
  process.env.DISPLAY = ':0.0';
}

const autostartScriptFile = 'autostart_extra.sh';
const launchChromium = chromium + ' http://localhost:8080/';
const launchFirefox = 'firefox -new-window http://localhost:8080/';
const autostartEntryPattern = new RegExp('^\\/.*\\b' + escapeForRegex(autostartScriptFile) + '\\b');
const oldAutostartEntryPattern = new RegExp(`^@(${chromium}|firefox)\\b.*\\bhttp:\\/\\/localhost:\\d+\\/$`);

// Remove extraneous command line args, if present.
if (/\b(ts-)?node\b/.test(process.argv[0] ?? ''))
  process.argv.splice(0, 1);

if (/\bbuild(\.[jt]s)?\b/.test(process.argv[0] ?? ''))
  process.argv.splice(0, 1);

if (process.argv.length === 0 && treatAsRaspberryPi && !viaBash) {
  console.warn(chalk.yellow('Warning: no build options specified.'));
  console.warn(chalk.yellow('This could be OK, or this could mean you forgot the leading ') +
               chalk.white('--') + chalk.yellow(' before your options.'));
}

const onlyOnRaspberryPi: string[] = [];
const onlyDedicated: string[] = [];
let helpMsg: string;
let getPathArg = false;

process.argv.forEach(arg => {
  if (getPathArg) {
    process.env.NODE_PATH = arg.trim();
    process.env.PATH = nodePath = arg.trim() + (nodePath ? ':' + nodePath : nodePath);
    getPathArg = false;

    return;
  }

  switch (arg) {
    case '--':
      break;
    case '--acu':
      doAcu = true;
      break;
    case '--acu-':
      doAcu = false;
      clearAcu = true;
      break;
    case '--admin':
      doAdmin = true;
      break;
    case '--admin-':
      doAdmin = false;
      break;
    case '--bash':
      viaBash = true;
      delete process.env.SHLVL;
      break;
    case '--ddev':
      doDedicated = doStdDeploy = true;
      onlyOnRaspberryPi.push(arg);
      break;
    case '--dht':
      doDht = true;
      onlyOnRaspberryPi.push(arg);
      break;
    case '--dht-':
      doDht = false;
      clearDht = true;
      break;
    case '--firefox':
      doFirefox = true;
      clearFirefox = false;
      break;
    case '--firefox-':
      doFirefox = false;
      clearFirefox = true;
      break;
    case '--fullscreen':
      doFullscreen = true;
      doKiosk = false;
      clearFullscreen = false;
      break;
    case '--fullscreen-':
      doFullscreen = false;
      clearFullscreen = true;
      break;
    case '-i':
      interactive = doStdDeploy = doDedicated = true;
      onlyOnRaspberryPi.push(arg);
      delete process.env.SHLVL;
      break;
    case '--kiosk':
      doKiosk = true;
      doFullscreen = false;
      clearKiosk = false;
      break;
    case '--kiosk-':
      doKiosk = false;
      clearKiosk = true;
      break;
    case '--launch':
      doLaunch = true;
      onlyOnRaspberryPi.push(arg);
      onlyDedicated.push(arg);
      break;
    case '--nostop':
      noStop = true;
      break;
    case '-p':
      prod = true;
      break;
    case '--path':
      getPathArg = true;
      break;
    case '--pt':
      spin = undefined;
      chalk.level = 0;
      backspace = '';
      sol = '';
      trailingSpace = ' ';
      break;
    case '--reboot':
      doReboot = true;
      doLaunch = false;
      onlyOnRaspberryPi.push(arg);
      onlyDedicated.push(arg);
      break;
    case '--sd':
      doStdDeploy = true;
      onlyOnRaspberryPi.push(arg);
      break;
    case '--skip-upgrade':
      doUpdateUpgrade = false;
      onlyOnRaspberryPi.push(arg);
      break;
    case '--skip-npm-i':
      doNpmI = false;
      break;
    case '--tarp':
      break; // ignore - already handled
    default:
    { // ///////////////////////////////////////////////////////////////////////////////
      helpMsg =
        'Usage: sudo ./build.sh [--acu] [--admin] [--ddev] [--dht] [--firefox]\n' +
        '                       [--fullscreen] [--gps] [--help] [-i] [--launch]\n' +
        '                       [--kiosk] [-p] [--pt] [--reboot] [--sd]\n' +
        '                       [--skip-upgrade] [--tarp]\n\n' +
        'The options --acu, --admin, --dht, --firefox, --fullscreen, and --kiosk\n' +
        'can be followed by an extra dash (e.g. --acu-) to clear a previously\n' +
        'enabled option.';

      if (!viaBash)
        helpMsg = helpMsg.replace('sudo ./build.sh', 'npm run build').replace(/\n {2}/g, '\n');

      if (arg !== '--help' && arg !== '-h')
        console.error('Unrecognized option "' + chalk.redBright(arg) + '"');

      console.log(helpMsg);
      process.exit(1);
    }
  }
});

if (noStop)
  doReboot = doLaunch = false;

if (!treatAsRaspberryPi && onlyOnRaspberryPi.length > 0) {
  onlyOnRaspberryPi.forEach(opt =>
    console.error(chalk.redBright(opt) + ' option is only valid on Raspberry Pi'));
  process.exit(1);
}

if (!doDedicated && onlyDedicated.length > 0) {
  onlyDedicated.forEach(opt =>
    console.error(chalk.redBright(opt) + ' option is only valid when used with the --ddev or -i options'));
  process.exit(1);
}

if (treatAsRaspberryPi) {
  try {
    if (fs.existsSync(settingsPath)) {
      const lines = asLines(fs.readFileSync(settingsPath).toString());
      const oldSettings: Record<string, string> = {};

      lines.forEach(line => {
        const $ = /^\s*(\w+)\s*=\s*(\S+)/.exec(line);

        if ($)
          oldSettings[$[1]] = settings[$[1]] = $[2];
      });

      if (doAdmin === undefined)
        doAdmin = toBoolean(oldSettings.AWC_ALLOW_ADMIN);
      else
        settings.AWC_ALLOW_ADMIN = doAdmin?.toString();

      // Convert deprecated environment variables
      if (!oldSettings.AWC_WIRED_TH_GPIO && toBoolean(oldSettings.AWC_HAS_INDOOR_SENSOR))
        oldSettings.AWC_WIRED_TH_GPIO = settings.AWC_WIRED_TH_GPIO =
          settings.AWC_TH_SENSOR_GPIO || '4';

      if (!clearDht && oldSettings.AWC_WIRED_TH_GPIO)
        doDht = true;

      if (!settings.AWC_WIRELESS_TH_GPIO && oldSettings.AWC_WIRELESS_TEMP)
        oldSettings.AWC_WIRELESS_TH_GPIO = settings.AWC_WIRELESS_TH_GPIO = settings.AWC_WIRELESS_TEMP;

      if (!clearAcu && oldSettings.AWC_WIRELESS_TH_GPIO)
        doAcu = true;

      if (!settings.AWC_NTP_SERVERS) {
        if (oldSettings.AWC_NTP_SERVER === 'pool.ntp.org')
          settings.AWC_NTP_SERVERS = '';
        else if (oldSettings.AWC_NTP_SERVER)
          settings.AWC_NTP_SERVERS = oldSettings.AWC_NTP_SERVER;
      }

      delete settings.AWC_HAS_INDOOR_SENSOR;
      delete settings.AWC_TH_SENSOR_GPIO;
      delete settings.AWC_WIRELESS_TEMP;
      delete settings.AWC_NTP_SERVER;

      const oldKiosk = /^(fa|0)/i.test(oldSettings.AWC_KIOSK_MODE) ? 'n' : oldSettings.AWC_KIOSK_MODE?.toLowerCase().charAt(0);

      if (clearKiosk)
        doKiosk = false;
      else
        doKiosk = (doKiosk != null ? doKiosk : !oldKiosk || /[kt]/.test(oldKiosk));

      if (clearFullscreen)
        doFullscreen = false;
      else
        doFullscreen = (doFullscreen != null ? doFullscreen : (oldKiosk === 'f'));

      if (doKiosk)
        settings.AWC_KIOSK_MODE = 'kiosk';
      else if (doFullscreen)
        settings.AWC_KIOSK_MODE = 'full-screen';
      else
        settings.AWC_KIOSK_MODE = 'no';

      if (clearFirefox)
        doFirefox = false;
      else if (doFirefox == null)
        doFirefox = toBoolean(oldSettings.AWC_USE_FIREFOX);

      if (doFirefox && settings.AWC_KIOSK_MODE === 'full-screen') {
        settings.AWC_KIOSK_MODE = 'kiosk';
        doKiosk = true;
        doFullscreen = false;
      }

      settings.AWC_USE_FIREFOX = doFirefox.toString();
    }
  }
  catch (err) {
    console.warn(chalk.yellow('Existing settings check failed. Defaults will be used.'));
  }
}

if (!isRaspberryPi && doAcu)
  console.warn(chalk.yellow('Warning: this setup will only generate fake wireless sensor data'));

async function readUserInput(): Promise<string> {
  return new Promise<string>(resolve => {
    let buffer = '';
    let length = 0;
    const clearLine = (): void => write('\x08 \x08'.repeat(length));

    const callback = (ch: string, key: Key): void => {
      if (ch === '\x03') { // ctrl-C
        write('^C\n');
        process.exit(130);
      }
      else if (ch === '\x15') { // ctrl-U
        clearLine();
        length = 0;
      }
      else if (key.name === 'enter' || key.name === 'return') {
        write('\n');
        process.stdin.off('keypress', callback);
        resolve(buffer.substr(0, length).trim());
      }
      else if (key.name === 'backspace' || key.name === 'left') {
        if (length > 0) {
          write('\x08 \x08');
          --length;
        }
      }
      else if (key.name === 'delete') {
        if (length > 0) {
          write('\x08 \x08');
          buffer = buffer.substr(0, --length) + buffer.substr(length + 1);
        }
      }
      else if (key.name === 'up') {
        clearLine();
        write('\n');
        process.stdin.off('keypress', callback);
        resolve('\x18');
      }
      else if (key.name === 'right') {
        if (length < buffer.length) {
          write(buffer.charAt(length++));
        }
      }
      else if (ch != null && ch >= ' ' && !key.ctrl && !key.meta) {
        write(ch);
        buffer = buffer.substr(0, length) + ch + buffer.substr(length++);
      }
    };

    process.stdin.on('keypress', callback);
  });
}

function write(s: string): void {
  process.stdout.write(s);
}

function stepDone(): void {
  console.log(backspace + chalk.green(CHECK_MARK));
}

async function isInstalled(command: string): Promise<boolean> {
  if (command === 'libgpiod-dev')
    return existsSync('/usr/include/gpiod.h');
  else
    return !!(await monitorProcess(spawn('command', ['-v', command], { shell: true }), null, ErrorMode.ANY_ERROR))?.trim();
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function install(cmdPkg: string, viaNpm = false, realOnly = false, quiet = false): Promise<boolean> {
  const packageArgs = [cmdPkg];
  let name = cmdPkg;

  if (!quiet)
    showStep();

  if (realOnly && !isRaspberryPi) {
    console.log(`${chalk.bold(cmdPkg)} won't be installed (not real Raspberry Pi)` +
      trailingSpace + backspace + chalk.green(CHECK_MARK));
    return false;
  }

  if (cmdPkg === 'gpiod')
    name = 'gpioinfo';

  if (await isInstalled(name)) {
    if (quiet)
      stepDone();
    else
      console.log(`${chalk.bold(cmdPkg)} already installed` + trailingSpace + backspace + chalk.green(CHECK_MARK));

    return false;
  }
  else {
    if (!quiet)
      write(`Installing ${chalk.bold(cmdPkg)}` + trailingSpace);

    if (viaNpm)
      await monitorProcess(spawn('npm', ['install', '-g', ...packageArgs]), spin, ErrorMode.ANY_ERROR);
    else
      await monitorProcess(spawn('apt-get', ['install', '-y', ...packageArgs]), spin, ErrorMode.ANY_ERROR);

    stepDone();
    return true;
  }
}

function getWebpackSummary(s: string): string {
  const lines = asLines(s);
  const summary: string[] = [];

  for (let line of lines) {
    if (/(^(hash|version|time|built at):)|by path assets\/ |runtime modules|javascript modules|compiled successfully in/i.test(line)) {
      line = line.trim();
      summary.push(line.substr(0, 72) + (line.length > 72 ? '...' : ''));
    }
  }

  return '    ' + summary.join('\n    ');
}

async function npmInit(): Promise<void> {
  if (!npmInitDone) {
    const file = path.join(__dirname, 'server', 'dist', 'package.json');
    const packageJson = {
      name: 'aw-clock-server',
      version: '0.0.0',
      description: 'AW-Clock Server',
      main: 'app.js',
      license: 'MIT',
      dependencies: {}
    };

    fs.writeFileSync(file, JSON.stringify(packageJson, null, 2));
    await monitorProcess(spawn('chown', [user, file]), spin, ErrorMode.ANY_ERROR);
    npmInitDone = true;
  }
}

enum RepoStatus { CLEAN, PACKAGE_LOCK_CHANGES_ONLY, DIRTY }

async function getRepoStatus(): Promise<RepoStatus> {
  const lines = asLines((await monitorProcess(spawn('git', ['status', '--porcelain', '-b']))).trim());
  let status = RepoStatus.CLEAN;

  if (lines.length > 0)
    lines.splice(0, 1);

  for (const line of lines) {
    if (/\bpackage-lock.json$/.test(line))
      status = RepoStatus.PACKAGE_LOCK_CHANGES_ONLY;
    else {
      status = RepoStatus.DIRTY;
      break;
    }
  }

  return status;
}

function showStep(): void {
  write(`Step ${++currentStep} of ${totalSteps}: `);
}

function chalkUp(s: string, currentStyle = (s: string): string => s): string {
  const closed = /(.*?)(\[([a-z]+)])(.*?)(\[\/\3])(.*)/.exec(s);
  const open = /(.*?)(\[([a-z]+)])(.*)/.exec(s);

  if (!closed && !open)
    return s;

  let $: RegExpMatchArray;

  if (closed && open)
    $ = open[1].length < closed[1].length ? open : closed;
  else
    $ = closed ?? open;

  let chalked = $[4];
  let end = $[6] ?? '';

  if (!$[5]) {
    chalked += end;
    end = '';
  }

  let style: (s: string) => string;

  switch ($[3]) {
    case 'pb': style = chalk.paleBlue; break;
    case 'w': style = chalk.whiteBright; break;
  }

  return $[1] + chalkUp(style(chalked), style) + currentStyle(chalkUp(end));
}

async function checkForGps(): Promise<void> {
  console.log(chalk.cyan('- GPS test -'));
  const hasGpsTools = (await isInstalled('gpsd')) && (await isInstalled('gpspipe'));
  const hasNtpTools = (await isInstalled('ntpd')) && (await isInstalled('ntpq'));
  const hasPpsTools = await isInstalled('ppstest');
  let gpsLocationIsWorking = false;
  let gpsTimeIsWorking = false;

  if (hasGpsTools) {
    const gpsInfo = await new Promise<string[]>((resolve, reject) => {
      const proc = spawn('gpspipe', ['-w', '-n', '12']);
      let finished = false;

      monitorProcessLines(proc, null, ErrorMode.NO_ERRORS)
        .then(lines => { finished = true; resolve(lines); })
        .catch(err => { finished = true; reject(err); });
      setTimeout(() => {
        if (!finished) {
          proc.kill();
          console.warn(chalk.yellow('Warning: gpspipe timed out.'));
          resolve([]);
        }
      }, 10000);
    });

    for (const line of gpsInfo) {
      try {
        const obj = JSON.parse(line) as { lat: number, lon: number };

        if (isObject(obj) && isNumber(obj.lat) && isNumber(obj.lon)) {
          gpsLocationIsWorking = true;
          break;
        }
      }
      catch {}
    }
  }

  if (hasNtpTools) {
    const ntpInfo = await new Promise<string[]>((resolve, reject) => {
      const proc = spawn('ntpq', ['-p']);
      let finished = false;

      monitorProcessLines(proc, null, ErrorMode.NO_ERRORS)
        .then(lines => { finished = true; resolve(lines); })
        .catch(err => { finished = true; reject(err); });
      setTimeout(() => {
        if (!finished) {
          proc.kill();
          console.warn(chalk.yellow('Warning: ntpq timed out.'));
          resolve([]);
        }
      }, 10000);
    });

    for (const line of ntpInfo) {
      if (/^\*SHM\b.+\.PPS\.\s+0\s+l\s+.+?\s[-+]?[.\d]+\s+[.\d]+\s*$/.test(line)) {
        gpsTimeIsWorking = true;
        break;
      }
    }
  }

  if (!gpsLocationIsWorking || !gpsTimeIsWorking) {
    const hasChrony = await isInstalled('chrony');

    console.log(chalk.yellow('GPS time and/or location services not found'));
    console.log(chalk.yellow('The following updates/changes are suggested if GPS support is desired:'));

    if (hasChrony)
      console.log(chalkUp('  [pb]• Remove [w]chrony[/w] package to avoid conflict with ntpd.'));

    if (hasGpsTools)
      console.log(chalkUp('  [pb]• Check [w]gpsd[/w] configuration'));
    else
      console.log(chalkUp('  [pb]• Install [w]gpsd[/w] and [w]gpspipe[/w]'));

    if (hasNtpTools)
      console.log(chalkUp('  [pb]• Check [w]ntpd[/w] configuration'));
    else
      console.log(chalkUp('  [pb]• Install [w]ntpd[/w] and [w]ntpq[/w]'));

    if (!hasPpsTools)
      console.log(chalkUp('  [pb]• Install [w]ppstest[/w]'));
  }
  else
    console.log('GPS time and location services found ' + chalk.green(CHECK_MARK));
}

function portValidate(s: string): boolean {
  const port = Number(s);

  if (isNaN(port) || port < 1 || port > 65535) {
    console.log(chalk.redBright('Port must be a number from 1 to 65535'));
    return false;
  }

  return true;
}

const DOMAIN_PATTERN =
  /^(((?!-))(xn--|_)?[-a-z\d]{0,61}[a-z\d]\.)*(xn--)?([a-z\d][-a-z\d]{0,60}|[-a-z\d]{1,30}\.[a-z]{2,})(:\d{1,5})?$/i;

function ntpValidate(s: string): boolean {
  const domains = s.split(',').map(d => d.trim());

  if (s.trim() === '' || (domains.length > 0 && domains.findIndex(d => !DOMAIN_PATTERN.test(d)) < 0))
    return true;

  console.log(chalk.redBright('NTP servers must be a valid domain names (with optional port numbers)'));
  return false;
}

// Change out-of-date preference to default.
if (process.env.AWC_PREFERRED_WS === 'darksky')
  process.env.AWC_PREFERRED_WS = 'wunderground';

function wsValidate(s: string): boolean | string {
  if (/^w[-b]*$/i.test(s))
    return 'wunderground';
  else if (/b/i.test(s))
    return 'weatherbit';
  else if (/^v/i.test(s))
    return 'visual_x';

  console.log(chalk.redBright('Weather service must be either (w)underground, weather(b)it, or (v)isual crossing'));

  return false;
}

function wsAfter(s: string): void {
  if (/^w[-b]*$/i.test(s)) {
    console.log(chalk.paleBlue('    Weather Underground chosen, but Weatherbit.io or Visual Crossing can be used'));
    console.log(chalk.paleBlue('    as fallback weather services.'));
  }
  else if (/b/i.test(s)) {
    console.log(chalk.paleBlue('    Weatherbit.io chosen, but Weather Underground will be used'));
    console.log(chalk.paleBlue('    as a fallback weather service.'));
  }
  else if (/^v/i.test(s)) {
    console.log(chalk.paleBlue('    Visual Crossing chosen, but Weather Underground will be used'));
    console.log(chalk.paleBlue('    as a fallback weather service.'));
  }
}

function yesOrNo(s: string, assign: (isYes: boolean) => void): boolean {
  if (/^[yn]/i.test(s)) {
    assign(/^y/i.test(s));
    return true;
  }

  console.log(chalk.redBright('Response must be (y)es or (n)o'));
  return false;
}

function adminValidate(s: string): boolean {
  return yesOrNo(s, isYes => settings.AWC_ALLOW_ADMIN = isYes ? 'true' : 'false');
}

function upgradeValidate(s: string): boolean {
  return yesOrNo(s, isYes => doUpdateUpgrade = isYes);
}

function npmIValidate(s: string): boolean {
  return yesOrNo(s, isYes => doNpmI = isYes);
}

function acuValidate(s: string): boolean {
  return yesOrNo(s, isYes => doAcu = isYes);
}

function dhtValidate(s: string): boolean {
  return yesOrNo(s, isYes => doDht = isYes);
}

function firefoxValidate(s: string): boolean | string {
  if (/^[cf]/i.test(s)) {
    doFirefox = /^f/i.test(s);
    return doFirefox.toString();
  }

  console.log(chalk.redBright('Response must be (C)hrome or (F)irefox'));
  return false;
}

function kioskValidate(s: string): boolean | string {
  if (/^[kfn]/i.test(s)) {
    if (/^k/i.test(s)) {
      doKiosk = true;
      doFullscreen = false;
      return 'kiosk';
    }
    else if (/^f/i.test(s)) {
      doKiosk = false;
      doFullscreen = true;
      return 'full-screen';
    }
    else {
      doKiosk = false;
      doFullscreen = false;
      return 'no';
    }
  }

  console.log(chalk.redBright('Response must be (k)iosk, (f)ullscreen, or (n)either'));
  return false;
}

function pinValidate(s: string): boolean {
  if (convertPinToGpio(s) < 0) {
    console.log(chalk.redBright(s + ' is not a valid pin number'));
    return false;
  }

  return true;
}

function finalActionValidate(s: string): boolean {
  let $: string[];

  if (($ = /^([lrn])/i.exec(s.toLowerCase()))) {
    if ($[1] === 'l') {
      doLaunch = true;
      doReboot = false;
    }
    else if ($[1] === 'r') {
      doLaunch = false;
      doReboot = true;
    }
    else
      doLaunch = doReboot = false;

    return true;
  }

  console.log(chalk.redBright('Response must be (l)aunch, (r)eboot, or (n)o action'));
  return false;
}

const finalAction = (doReboot ? 'R' : doLaunch ? 'L' : '#');
const finalOptions = '(l/r/n)'.replace(finalAction.toLowerCase(), finalAction);

interface Question {
  after?: (s: string) => void;
  ask?: boolean | (() => boolean);
  deflt?: string | (() => string);
  name?: string;
  opts?: string;
  prompt: string;
  validate?: (s: string) => boolean | string;
  yn?: boolean;
}

let questions: Question[] = [
  { prompt: 'Perform initial update/upgrade?', ask: true, yn: true, deflt: doUpdateUpgrade ? 'Y' : 'N', validate: upgradeValidate },
  { prompt: 'Perform npm install? (N option for debug only)', ask: true, yn: true, deflt: doNpmI ? 'Y' : 'N', validate: npmIValidate },
  { name: 'AWC_PORT', prompt: 'HTTP server port.', ask: true, validate: portValidate },
  { prompt: 'Allow user to reboot, shutdown, update, etc.?', ask: true, yn: true, deflt: doAdmin ? 'Y' : 'N', validate: adminValidate },
  { name: 'AWC_NTP_SERVERS', prompt: 'time servers (comma-separated domains, blank for defaults)', ask: true, validate: ntpValidate },
  {
    name: 'AWC_GOOGLE_API_KEY',
    prompt: 'Optional Google geocoding API key (for city names from\n      GPS coordinates).' +
      (settings.AWC_GOOGLE_API_KEY ? '\n    Enter - (dash) to remove old API key' : ''),
    ask: true
  },
  { // #5
    name: 'AWC_PREFERRED_WS',
    prompt: 'preferred weather service, (w)underground, weather(b)it,\n      or (v)isual crossing).',
    ask: true,
    validate: wsValidate,
    after: wsAfter
  },
  {
    name: 'AWC_WEATHERBIT_API_KEY',
    prompt: 'Optional Weatherbit.io (via RapidAPI) key, for\n      weather and geocoding.' +
      (settings.AWC_WEATHERBIT_API_KEY ? '\n    Enter - (dash) to remove old API key' : ''),
    ask: true
  },
  { // #7
    name: 'AWC_VISUAL_CROSSING_API_KEY',
    prompt: 'Optional Visual Crossing weather API key.' +
      (settings.AWC_VISUAL_CROSSING_API_KEY ? '\n    Enter - (dash) to remove old API key' : ''),
    ask: true
  },
  { prompt: 'Use wired DHT temperature/humidity sensor?', ask: true, yn: true, deflt: doDht ? 'Y' : 'N', validate: dhtValidate },
  { name: 'AWC_WIRED_TH_GPIO', prompt: 'GPIO pin number for wired temp/humidity sensor', ask: (): boolean => doDht, validate: pinValidate },
  { prompt: 'Use wireless temperature/humidity sensors?', ask: true, yn: true, deflt: doAcu ? 'Y' : 'N', validate: acuValidate },
  { name: 'AWC_WIRELESS_TH_GPIO', prompt: 'GPIO pin number for wireless temp/humidity sensors', ask: (): boolean => doAcu, validate: pinValidate },
  {
    prompt: `When finished, (l)aunch A/W clock, (r)eboot, or (n)o action ${finalOptions}?`,
    ask: true,
    deflt: finalAction,
    validate: finalActionValidate
  }
];

async function promptForConfiguration(): Promise<void> {
  let altKioskQuestion: Question;

  if (doDedicated) {
    if (hasFirefox)
      questions.splice(questions.length - 1, 0,
        { prompt: 'Launch browser with (C)hrome or (F)irefox?', ask: true, opts: 'cf',
          deflt: () => doFirefox ? 'F' : 'C', validate: firefoxValidate, name: 'AWC_USE_FIREFOX' }
      );

    questions.splice(questions.length - 1, 0,
      { prompt: 'Launch browser in (k)iosk mode, (f)ull-screen, or (n)either?', ask: true, opts: 'kfn',
        deflt: () => doKiosk ? 'K' : (doFullscreen ? 'F' : 'N'), validate: kioskValidate, name: 'AWC_KIOSK_MODE' }
    );

    altKioskQuestion =
      { prompt: 'Launch browser in kiosk mode?', ask: true, yn: true,
        deflt: () => doKiosk || doFullscreen ? 'Y' : 'N', name: 'AWC_KIOSK_MODE' };
  }

  if (noStop)
    questions = questions.slice(0, -1);

  console.log(chalk.cyan(sol + '- Configuration -'));

  for (let i = 0; i < questions.length; ++i) {
    let q = questions[i];

    if (q.name === 'AWC_KIOSK_MODE' && doFirefox)
      q = altKioskQuestion;

    const deflt = isFunction(q.deflt) ? q.deflt() : q.deflt;

    if (!(isFunction(q.ask) ? q.ask() : q.ask))
      continue;

    if (q.name && !q.opts && !q.yn) {
      write(chalk.bold(q.name) + ' - ' + q.prompt + '\n    ' +
        (settings[q.name] ? '(default: ' + chalk.paleYellow(settings[q.name]) + ')' : '') + ': ');
    }
    else {
      write(q.prompt);

      if (q.yn)
        write(deflt === 'Y' ? ' (Y/n)' : ' (y/N)');
      else if (q.opts && deflt)
        write(' (' + q.opts.split('')
          .map(c => c === deflt.toLowerCase() ? c.toUpperCase() : c).join('/') + ')');

      write(': ');
    }

    let response = await readUserInput();

    if (!response && q.yn)
      response = deflt;

    if (response === '\x18') {
      i = Math.max(i - 2, -1);
      continue;
    }
    else if (response) {
      const validation = q.validate ? q.validate(response) : true;

      if (isString(validation))
        settings[q.name] = validation;
      else if (!validation) {
        --i;
        continue;
      }
      else if (q.name) {
        if (response === '-')
          delete settings[q.name];
        else if (q.yn)
          settings[q.name] = toBoolean(response).toString();
        else
          settings[q.name] = response;
      }
    }
    else if (!response && q.deflt === '#') {
      --i;
      console.log(chalk.redBright('Response required'));
    }

    if (q.after)
      q.after(settings[q.name]);
  }
}

async function installFonts(): Promise<void> {
  showStep();

  const fonts = fs.readdirSync(fontSrc).filter(name => /.\.ttf/i.test(name));
  const fontsToAdd = fonts.filter(font => !fs.existsSync(fontDst + font));

  if (fontsToAdd.length > 0) {
    write('Installing fonts' + trailingSpace);

    for (const font of fontsToAdd)
      await monitorProcess(spawn('cp', [fontSrc + font, fontDst + font]), spin, ErrorMode.ANY_ERROR);

    await monitorProcess(spawn('fc-cache', ['-f']), spin, ErrorMode.ANY_ERROR);
  }
  else
    write('Fonts already installed' + trailingSpace);

  stepDone();
}

async function disableScreenSaver(uid: number): Promise<void> {
  const screenSaverJustInstalled = await install('xscreensaver');
  const settingsFile = `${userHome}/.xscreensaver`;

  showStep();
  write('Disabling screen saver' + trailingSpace);

  if (screenSaverJustInstalled || !fs.existsSync(settingsFile)) {
    const procList = await monitorProcess(spawn('ps', ['-ax']), spin);
    const saverRunning = /\d\s+xscreensaver\b/.test(procList);

    if (!saverRunning) {
      spawn('xscreensaver', [], { uid, detached: true, env: process.env });
      await sleep(500);
    }

    const settingsProcess = spawn('xscreensaver-demo', [], { uid, env: process.env });

    await sleep(3000, spin);
    settingsProcess.kill('SIGTERM');
    await sleep(500, spin);
  }

  await monitorProcess(spawn('sed',
    ['-i', '-r', "'s/^(mode:\\s+)\\w+$/\\1off/'", settingsFile],
    { uid, shell: true }), spin, ErrorMode.ANY_ERROR);

  // Stop and restart screen saver to make sure modified settings are read
  const procList = await monitorProcess(spawn('ps', ['-ax']), spin);
  const ssProcessNo = (/^(\d+)\s+.*\d\s+xscreensaver\b/.exec(procList) ?? [])[1];

  if (ssProcessNo)
    await monitorProcess(spawn('kill', [ssProcessNo]), spin);

  spawn('xscreensaver', [], { uid, detached: true });
  stepDone();
}

async function doClientBuild(): Promise<void> {
  if (doNpmI || !fs.existsSync('node_modules') || !fs.existsSync('package-lock.json')) {
    showStep();
    write('Updating client' + trailingSpace);
    await monitorProcess(spawn('npm', uid, ['i', '--no-save']), spin);
    stepDone();
  }

  showStep();
  write('Building client' + trailingSpace);

  if (fs.existsSync('dist'))
    await monitorProcess(spawn('rm', uid, ['-Rf', 'dist']), spin);

  const opts = { shell: true, env: process.env };
  const args = ['run', 'build:client' + (enoughRam ? '' : ':tiny')];

  if (prod)
    args.push('--', '--env', 'mode=prod');

  const output = getWebpackSummary(await monitorProcess(spawn('npm', uid, args, opts), spin));

  stepDone();

  if (output?.trim())
    console.log(chalk.mediumGray(output));
}

async function doServerBuild(): Promise<void> {
  if (doNpmI || !fs.existsSync('server/node_modules') || !fs.existsSync('server/package-lock.json')) {
    showStep();
    write('Updating server' + trailingSpace);
    await monitorProcess(spawn('npm', uid, ['i', '--no-save'], { cwd: path.join(__dirname, 'server') }), spin);
    stepDone();
  }

  showStep();
  write('Building server' + trailingSpace);

  if (fs.existsSync('server/dist'))
    await monitorProcess(spawn('rm', uid, ['-Rf', 'server/dist']), spin);

  const opts = { shell: true, cwd: path.join(__dirname, 'server'), env: process.env };
  const output = getWebpackSummary(await monitorProcess(spawn('npm', uid,
    ['run', isWindows ? 'build-win' : 'build' + (enoughRam ? '' : ':tiny')], opts), spin));

  stepDone();

  if (output?.trim())
    console.log(chalk.mediumGray(output));

  if (doAcu || doDht) {
    showStep();

    const args = ['i', '-P', 'rpi-acu-rite-temperature@3', 'node-dht-sensor'];

    if (isRaspberryPi5OrLater)
      args.push('--use_libgpiod=true');

    if (doAcu && doDht)
      write('Adding wireless and wired temp/humidity sensor support' + trailingSpace);
    else if (doAcu) {
      args.splice(3, 1);
      write('Adding Acu-Rite wireless temperature/humidity sensor support' + trailingSpace);
    }
    else {
      args.splice(2, 1);
      write('Adding DHT wired temperature/humidity sensor support' + trailingSpace);
    }

    await npmInit();
    await monitorProcess(spawn('npm', uid, args, { cwd: path.join(__dirname, 'server', 'dist') }), spin);
    stepDone();
  }
}

async function doServiceDeployment(): Promise<void> {
  let autostartDir = path.join(userHome, autostartDst);
  const wayfireIniPath = path.join(userHome, wayfireIni);
  let morePi_ish = false;

  if (!autostartDir.endsWith('-pi')) {
    const lxdePiCheckDir = path.join(userHome, lxdePiCheck);

    if (fs.existsSync(lxdePiCheckDir)) {
      morePi_ish = true;
      autostartDir += '-pi';
    }
  }

  showStep();
  write('Create or redeploy weatherService' + trailingSpace);

  const serviceScript = fs.readFileSync(serviceSrc).toString().replace(/\/pi\//g, `/${user}/`);

  fs.writeFileSync(serviceDst, serviceScript);
  await monitorProcess(spawn('chmod', ['+x', serviceDst], { shell: true }), spin, ErrorMode.ANY_ERROR);

  const settingsText =
    `# If you edit AWC_PORT below, be sure to update\n#   ${userHome}/${autostartDst}/autostart` +
    (existsSync(wayfireIniPath) ? ` and\n#   ${wayfireIniPath}` : '') + ' accordingly.\n' +
    Object.keys(settings).sort().map(key => key + '=' + settings[key]).join('\n') + '\n';

  fs.writeFileSync(settingsPath, settingsText);
  await monitorProcess(spawn('update-rc.d', ['weatherService', 'defaults']), spin);
  await monitorProcess(spawn('systemctl', ['enable', 'weatherService']), spin);
  await monitorProcess(spawn('mkdir', uid, ['-p', autostartDir]), spin);

  let autoScript = fs.readFileSync(path.join(rpiSetupStuff, autostartScriptFile)).toString();
  let launchCmd = doFirefox ? launchFirefox : launchChromium;

  if (doFullscreen && !doFirefox)
    // eslint-disable-next-line no-template-curly-in-string
    launchCmd = launchCmd.replace(/\s+/, ' --new-window --start-fullscreen "${maxarg}" --autoplay-policy=no-user-gesture-required ');
  else if (doKiosk && !doFirefox)
    // eslint-disable-next-line no-template-curly-in-string
    launchCmd = launchCmd.replace(/\s+/, ' --kiosk "${maxarg}" --autoplay-policy=no-user-gesture-required ');
  else if ((doKiosk || doFullscreen) && doFirefox)
    launchCmd = launchCmd.replace('-new-window', '--kiosk');

  autoScript = autoScript.replace('echo #launch-here', launchCmd)
    .replace(/:8080\b/, ':' + settings.AWC_PORT)
    .replace('the-browser', doFirefox ? 'firefox' : chromium)
    .replace(/\/pi\//g, `/${user}/`);

  fs.writeFileSync(path.join(autostartDir, autostartScriptFile), autoScript);

  const autostartPath = autostartDir + '/autostart';
  const autostartEntry = autostartDir + '/autostart_extra.sh' + (doFirefox ? ' -f' : '');
  let lines: string[] = [];
  let update = false;
  let found = false;

  try {
    lines = asLines(fs.readFileSync(autostartPath).toString()).filter(line => !!line.trim());
  }
  catch (err) {
    if (isRaspberryPi || morePi_ish) {
      update = true;
      lines = [
        '@lxpanel --profile LXDE-pi',
        '@pcmanfm --desktop --profile LXDE-pi',
        '@xscreensaver -no-splash'
      ];

      if (await isInstalled('point-rpi'))
        lines.push('@point-rpi');
    }
  }

  for (let i = 0; i <= lines.length; ++i) {
    if (i === lines.length && !found) {
      lines.push(autostartEntry);
      update = true;
      break;
    }
    else if (autostartEntryPattern.test(lines[i]))
      found = true;
    else if (oldAutostartEntryPattern.test(lines[i])) {
      lines.splice(i--, 1);
      update = true;
    }
  }

  if (update)
    fs.writeFileSync(autostartPath, lines.join('\n') + '\n');

  // Extra autostart setup for Wayfire
  if (existsSync(wayfireIniPath)) {
    try {
      lines = asLines(fs.readFileSync(wayfireIniPath).toString()).filter(line => !!line.trimEnd());

      let autoIndex = lines.findIndex(l => l.startsWith('[autostart]'));

      if (autoIndex < 0) {
        lines.push('');
        lines.push('[autostart]');
        autoIndex = lines.length;
      }
      else
        while (lines[++autoIndex] && !/^(\[|(clock[12] = ))/.test(lines[autoIndex])) {}

      // Prevent duplicate entries, remove old entries
      lines = lines.filter((l, i) => i < autoIndex || !/^clock[12] = /.test(l));
      lines.splice(autoIndex, 0, 'clock1 = ' + autostartEntry);
      fs.writeFileSync(wayfireIniPath, lines.join('\n') + '\n');
    }
    catch (e) {
      console.error(chalk.redBright('Error: failed to update .config/wayfire.ini to autostart AW-Clock'));
      console.error(chalk.redBright('   ' + e.message));
    }
  }

  await monitorProcess(spawn('chown', 0, [sudoUser, autostartDir + '/autostart*'],
    { shell: true }), spin, ErrorMode.ANY_ERROR);
  await monitorProcess(spawn('chmod', uid, ['+x', autostartDir + '/autostart*'],
    { shell: true }), spin, ErrorMode.ANY_ERROR);

  if (noStop)
    console.log(backspace + trailingSpace + '\n\nReboot to complete set-up.');
  else
    await monitorProcess(spawn('service', ['weatherService', 'start']), spin);

  stepDone();
}

(async (): Promise<void> => {
  try {
    hasFirefox = await isInstalled('firefox');

    uid = Number((await monitorProcess(spawn('id', ['-u', user]))).trim() || '1000');

    const nodeVersionStr = (await monitorProcess(spawn('node', uid, ['--version']))).trim();
    const nodeVersion = toNumber((/v(\d+)/.exec(nodeVersionStr) ?? [])[1]);

    if (isRaspberryPi && (nodeVersion < 10)) {
      console.error(chalk.redBright(`Node.js version 10 or later required. Version ${nodeVersionStr} found.`));
      process.exit(1);
    }

    if (treatAsRaspberryPi && !isRaspberryPi) {
      const isDebian = /^Linux\b.+\bDebian\b/i.test(await monitorProcess(spawn('uname', ['-a'])));
      const isLxde = await isInstalled('lxpanel');

      if (!isDebian || !isLxde) {
        console.error(chalk.redBright('--tarp option (Treat As Raspberry Pi) only available for Linux Debian with LXDE'));
        process.exit(1);
      }
    }

    if (isRaspberryPi)
      await checkForGps();

    if (interactive)
      await promptForConfiguration();

    process.stdin.setRawMode(false);

    totalSteps += hasFirefox ? 1 : 0;
    totalSteps += noStop ? 0 : 1;
    totalSteps += (doNpmI || !fs.existsSync('node_modules') || !fs.existsSync('package-lock.json')) ? 1 : 0;
    totalSteps += (doNpmI || !fs.existsSync('server/node_modules') || !fs.existsSync('server/package-lock.json')) ? 1 : 0;
    totalSteps += doAcu || doDht ? 1 : 0;
    totalSteps += (doStdDeploy || doDedicated ? 1 : 0);
    totalSteps += (doLaunch || doReboot ? 1 : 0);

    if (!doDht)
      delete settings.AWC_WIRED_TH_GPIO;

    if (!doAcu)
      delete settings.AWC_WIRELESS_TH_GPIO;

    if (doDedicated) {
      totalSteps += 9 + (doUpdateUpgrade ? 1 : 0);
      console.log(chalk.cyan(sol + '- Dedicated device setup -'));

      if (doUpdateUpgrade) {
        showStep();
        write('Updating/upgrading packages (can take a long time!)' + trailingSpace);
        await monitorProcess(spawn('apt-get', ['update', '-y']), spin, ErrorMode.NO_ERRORS);
        await monitorProcess(spawn('apt-get', ['upgrade', '-y']), spin, ErrorMode.NO_ERRORS);
        stepDone();
      }

      if (!noStop) {
        showStep();
        write('Stopping weatherService if currently running' + trailingSpace);

        try {
          await monitorProcess(spawn('service', ['weatherService', 'stop']), spin, ErrorMode.ANY_ERROR);
        }
        catch (err) {
          const msg = err.message || err.toString();

          // Grief from polkit?
          if (/Interactive authentication required/i.test(msg)) {
            console.log(backspace + trailingSpace);
            console.error(err);
            console.log('\npolkit is requiring interactive authentication to stop weatherService.');
            console.log('Please enter "sudo service weatherService stop" at the prompt below.');
            console.log('\nWhen that is done, restart this installation with either: ');
            console.log('    sudo ./build.sh --nostop -i        (for interactive set-up)');
            console.log('    sudo ./build.sh --nostop -ddev     (for automated set-up)');
            process.exit(1);
          }
        }

        stepDone();
      }

      await install('gpiod', false, true);
      await install('libgpiod-dev', false, true);
      await install(chromium);
      await install('unclutter');

      for (let i = 0; i < 2; ++i) {
        try {
          await install('forever', true, false, i > 0);
          break;
        }
        catch {
          if (i > 0)
            console.log(backspace + chalk.paleYellow(FAIL_MARK));
        }
      }

      await installFonts();

      try {
        await disableScreenSaver(uid);
      }
      catch {
        console.log(backspace + chalk.paleYellow(FAIL_MARK));
      }
    }

    settings.AWC_GIT_REPO_PATH = (await monitorProcess(spawn('pwd'), spin, ErrorMode.NO_ERRORS)).trim() ||
      settings.AWC_GIT_REPO_PATH;

    if (!settings.AWC_GIT_REPO_PATH)
      delete settings.AWC_GIT_REPO_PATH;

    console.log(chalk.cyan(sol + '- Building application -'));
    const repoStatus1 = await getRepoStatus();
    await doClientBuild();
    await doServerBuild();
    const repoStatus2 = await getRepoStatus();

    // If the build process alone is responsible for dirtying the repo, clean it up again.
    if (viaBash && repoStatus1 === RepoStatus.CLEAN && repoStatus2 === RepoStatus.PACKAGE_LOCK_CHANGES_ONLY)
      await monitorProcess(spawn('git', ['reset', '--hard']));

    showStep();
    write('Copying server to top-level dist directory' + trailingSpace);
    await (promisify(copyfiles) as any)(['server/dist/**/*', 'dist/'], { up: 2 });
    await monitorProcess(spawn('chown', ['-R', sudoUser, 'dist'], { shell: true }), spin, ErrorMode.ANY_ERROR);
    stepDone();

    if (doStdDeploy) {
      showStep();
      write('Moving server to ~/weather directory' + trailingSpace);

      if (!fs.existsSync(userHome + '/awc-alarm-tones'))
        fs.mkdirSync(userHome + '/awc-alarm-tones');

      if (!fs.existsSync(userHome + '/weather'))
        await monitorProcess(spawn('mkdir', [userHome + '/weather']), spin);
      else
        await monitorProcess(spawn('rm', ['-Rf', userHome + '/weather/*'], { shell: true }), spin, ErrorMode.ANY_ERROR);

      await monitorProcess(spawn('mv', ['dist/*', userHome + '/weather'], { shell: true }), spin, ErrorMode.ANY_ERROR);
      stepDone();
    }

    if (doDedicated) {
      console.log(chalk.cyan(sol + '- Dedicated device service deployment -'));
      await doServiceDeployment();
    }

    if (doLaunch) {
      console.log(chalk.cyan(sol + '- Launching Astronomy/Weather Clock -'));
      showStep();
      write(' ');
      await sleep(3000, spin);
      stepDone();
      await monitorProcess(spawn('pkill', uid, ['-o', chromium]), spin, ErrorMode.NO_ERRORS);
      await monitorProcess(spawn('pkill', uid, ['-o', chromium.substr(0, 15)]), spin, ErrorMode.NO_ERRORS);
      await sleep(500, spin);
      const args = launchChromium.split(/\s/).slice(1);
      args.splice(args.length - 1, 0, `--user-data-dir='${userHome}'`);
      setTimeout(() => process.exit(0), 5000);
      await monitorProcess(spawn(chromium, uid, args, { detached: true }));
    }

    if (doReboot) {
      console.log(chalk.cyan(sol + '- Rebooting system in 5 seconds... -'));
      showStep();
      write('Press any key to stop reboot:' + trailingSpace);

      if (!(await sleep(5000, spin, true))) {
        console.log();
        exec('reboot');
      }
      else
        console.log();
    }

    process.exit(0);
  }
  catch (err) {
    console.log(backspace + chalk.red(FAIL_MARK));
    console.error(err);
    process.exit(1);
  }
})();
