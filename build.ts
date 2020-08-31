import * as Chalk from 'chalk';
import { exec } from 'child_process';
import * as copyfiles from 'copyfiles';
import * as fs from 'fs';
import { asLines, processMillis, toBoolean } from 'ks-util';
import * as path from 'path';
import { convertPinToGpio } from './server/src/rpi-pin-conversions';
import { ErrorMode, getSudoUser, getUserHome, monitorProcess, monitorProcessLines, sleep, spawn } from './server/src/process-util';
import { promisify } from 'util';

const CHECK_MARK = '\u2714';
const FAIL_MARK = '\u2718';
const SPIN_CHARS = '|/-\\';
const SPIN_DELAY = 100;

const isWindows = (process.platform === 'win32');

let spinStep = 0;
let lastSpin = 0;
let doUpdateUpgrade = true;
let npmInitDone = false;
let doAcu = false;
let clearAcu = false;
let doAdmin: boolean;
let doDht = false;
let clearDht = false;
let doStdDeploy = false;
let doDedicated = false;
let doLaunch = false;
let doReboot = false;
let viaBash = false;
let interactive = false;
let treatAsRaspberryPi = process.argv.includes('--tarp');
let isRaspberryPi = false;

let spin = () => {
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
let trailingSpace = '  '; // Two spaces
let totalSteps = 5;
let currentStep = 0;
const settings: Record<string, string> = {
  AWC_ALLOW_ADMIN: 'false',
  AWC_ALLOW_CORS: 'true',
  AWC_NTP_SERVER: 'pool.ntp.org',
  AWC_PORT: '8080',
  AWC_PREFERRED_WS: 'wunderground',
  AWC_WIRED_TH_GPIO: '17',
  AWC_WIRELESS_TH_GPIO: '27'
};

const userHome = getUserHome();
const sudoUser = getSudoUser();
const user = process.env.SUDO_USER || process.env.USER || 'pi';
let uid: number;
const cpuPath = '/proc/cpuinfo';
const settingsPath = '/etc/default/weatherService';
const rpiSetupStuff = path.join(__dirname, 'raspberry_pi_setup');
const serviceSrc = rpiSetupStuff + '/weatherService';
const serviceDst = '/etc/init.d/.';
const fontSrc = rpiSetupStuff + '/fonts/';
const fontDst = '/usr/local/share/fonts/';
let chromium = 'chromium';
let autostartDst = '.config/lxsession/LXDE';

if (process.platform === 'linux') {
  try {
    if (fs.existsSync(cpuPath)) {
      const lines = asLines(fs.readFileSync(cpuPath).toString());

      for (const line of lines) {
        if (/\bModel\s*:\s*Raspberry Pi\b/i.test(line)) {
          isRaspberryPi = treatAsRaspberryPi = true;
          autostartDst += '-pi';
          chromium += '-browser';
          break;
        }
      }
    }
  }
  catch (err) {
    console.error(chalk.redBright('Raspberry Pi check failed'));
  }
}

const launchChromium = chromium + ' --kiosk http://localhost:8080/';

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

process.argv.forEach(arg => {
  switch (arg) {
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
    case '-i':
      interactive = doStdDeploy = doDedicated = true;
      onlyOnRaspberryPi.push(arg);
      delete process.env.SHLVL;
      break;
    case '--launch':
      doLaunch = true;
      onlyOnRaspberryPi.push(arg);
      onlyDedicated.push(arg);
      break;
    case '--pt':
      spin = undefined;
      chalk.level = 0;
      backspace = '';
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
    case '--tarp':
      break; // ignore - already handled
    default:
      if (arg !== '--help' && arg !== '-h') {
        helpMsg =
          'Usage: sudo ./build.sh [--acu] [--admin] [--ddev] [--dht] [--gps] [--help] [-i]\n' +
          '                       [--launch] [--pt] [--reboot] [--sd] [--skip-upgrade]\n' +
          '                       [--tarp]\n\n' +
          'The options --acu, --admin, and --dht can be followed by an extra dash (e.g.\n' +
          '--acu-) to clear a previously enabled option.';

        if (!viaBash)
          helpMsg = helpMsg.replace('sudo ./build.sh', 'npm run build').replace(/\n {2}/g, '\n');

        console.error('Unrecognized option "' + chalk.redBright(arg) + '"');
        console.log(helpMsg);
        process.exit(0);
      }
  }
});

if (!treatAsRaspberryPi && onlyOnRaspberryPi.length > 0) {
  onlyOnRaspberryPi.forEach(opt =>
    console.error(chalk.redBright(opt) + ' option is only valid on Raspberry Pi'));
  process.exit(0);
}

if (!doDedicated && onlyDedicated.length > 0) {
  onlyDedicated.forEach(opt =>
    console.error(chalk.redBright(opt) + ' option is only valid when used with the --ddev or -i options'));
  process.exit(0);
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

      delete settings.AWC_HAS_INDOOR_SENSOR;
      delete settings.AWC_TH_SENSOR_GPIO;
      delete settings.AWC_WIRELESS_TEMP;
    }
  }
  catch (err) {
    console.warn(chalk.yellow('Existing settings check failed. Defaults will be used.'));
  }
}

if (!isRaspberryPi && doAcu)
  console.warn(chalk.yellow('Warning: this setup will only generate fake wireless sensor data'));

async function readLine(): Promise<string> {
  return new Promise<string>(resolve => {
    const callback = (data: any) => {
      process.stdin.off('data', callback);
      resolve(data.toString().trim());
    };

    process.stdin.on('data', callback);
  });
}

function write(s: string): void {
  process.stdout.write(s);
}

function stepDone(): void {
  console.log(backspace + chalk.green(CHECK_MARK));
}

async function isInstalled(command: string): Promise<boolean> {
  return !!(await monitorProcess(spawn('command', ['-v', command], { shell: true }), null, ErrorMode.ANY_ERROR))?.trim();
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function install(cmdPkg: string, viaNpm = false, realOnly = false): Promise<boolean> {
  let packageArgs = [cmdPkg];
  let name = cmdPkg;

  showStep();

  if (realOnly && !isRaspberryPi) {
    console.log(`${chalk.bold(cmdPkg)} won't be installed (not real Raspberry Pi)` +
      trailingSpace + backspace + chalk.green(CHECK_MARK));
    return false;
  }

  if (cmdPkg === 'pigpio') {
    packageArgs = ['pigpio', 'python-pigpio', 'python3-pigpio'];
    name = 'pigpiod';
  }

  if (await isInstalled(name)) {
    console.log(`${chalk.bold(cmdPkg)} already installed` + trailingSpace + backspace + chalk.green(CHECK_MARK));
    return false;
  }
  else {
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
  let summary = '';
  let count = 0;

  for (let i = 0; i < lines.length && count < 4; ++i) {
    const line = lines[i];

    if (line && !line.startsWith('>')) {
      summary += '    ' + line.trim() + (count < 3 ? '\n' : '');
      ++count;
    }
  }

  return summary || s.trim();
}

async function npmInit(): Promise<void> {
  if (!npmInitDone) {
    await monitorProcess(spawn('npm', ['init', '--yes'], { cwd: path.join(__dirname, 'server', 'dist') }), spin);
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

function chalkUp(s: string, currentStyle = (s: string) => s): string {
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
    const gpsInfo = await monitorProcessLines(spawn('gpspipe', ['-w', '-n', '12']), null, ErrorMode.NO_ERRORS);

    for (const line of gpsInfo) {
      try {
        const obj = JSON.parse(line);

        if (typeof obj === 'object' && typeof obj.lat === 'number' && typeof obj.lon === 'number') {
          gpsLocationIsWorking = true;
          break;
        }
      }
      catch {}
    }
  }

  if (hasNtpTools) {
    const ntpInfo = await monitorProcessLines(spawn('ntpq', ['-p']), null, ErrorMode.NO_ERRORS);

    for (const line of ntpInfo) {
      if (/^\*SHM\b.+\.PPS\.\s+0\s+l\s+.+?\s-?[.\d]+\s+[.\d]+\s*$/.test(line)) {
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

function ntpValidate(s: string): boolean {
  if (/^(((?!-))(xn--|_)?[-a-z0-9]{0,61}[a-z0-9]\.)*(xn--)?([a-z0-9][-a-z0-9]{0,60}|[-a-z0-9]{1,30}\.[a-z]{2,})(:\d{1,5})?$/i.test(s))
    return true;

  console.log(chalk.redBright('NTP server must be a valid domain name (with optional port number)'));
  return false;
}

const NO_MORE_DARK_SKY = (Date.now() > Date.parse('2021-11-30'));

if (NO_MORE_DARK_SKY && process.env.AWC_PREFERRED_WS === 'darksky')
  process.env.AWC_PREFERRED_WS = 'wunderground';

function wsValidate(s: string): boolean | string {
  if (/^w[-b]*$/i.test(s))
    return 'wunderground';
  else if (/b/i.test(s))
    return 'weatherbit';
  else if (!NO_MORE_DARK_SKY && /^d/i.test(s))
    return 'darksky';

  if (NO_MORE_DARK_SKY)
    console.log(chalk.redBright('Weather service must be either (w)underground, weather(b)it, or (d)arksky'));
  else
    console.log(chalk.redBright('Weather service must be either (w)underground, or weather(b)it'));

  return false;
}

function wsAfter(s: string): void {
  if (/^w[-b]*$/i.test(s)) {
    console.log(chalk.paleBlue(`    Weather Underground chosen, but Weatherbit.io${NO_MORE_DARK_SKY ? '' : 'or Dark Sky'} can be used`));
    console.log(chalk.paleBlue('    as fallback weather services.'));
  }
  else if (/b/i.test(s)) {
    console.log(chalk.paleBlue('    Weatherbit.io chosen, but Weather Underground will be used'));
    console.log(chalk.paleBlue('    as a fallback weather service.'));
  }
  else if (/^d/i.test(s)) {
    console.log(chalk.paleBlue('    Dark Sky chosen, but Weather Underground will be used'));
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

function acuValidate(s: string): boolean {
  return yesOrNo(s, isYes => doAcu = isYes);
}

function dhtValidate(s: string): boolean {
  return yesOrNo(s, isYes => doDht = isYes);
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

const finalAction = (doReboot ? 'R' : doLaunch ? 'L' : 'N');
const finalOptions = '(l/r/n/)'.replace(finalAction.toLowerCase(), finalAction);

const questions = [
  { prompt: 'Perform initial update/upgrade?', ask: true, yn: true, deflt: doUpdateUpgrade ? 'Y' : 'N', validate: upgradeValidate },
  { name: 'AWC_PORT', prompt: 'HTTP server port', ask: true, validate: portValidate },
  { prompt: 'Allow user to reboot, shutdown, update, etc.?', ask: true, yn: true, deflt: doAdmin ? 'Y' : 'N', validate: adminValidate },
  { name: 'AWC_NTP_SERVER', prompt: 'time server', ask: true, validate: ntpValidate },
  {
    name: 'AWC_GOOGLE_API_KEY',
    prompt: 'Optional Google geocoding API key (for city names from\n      GPS coordinates.)' +
      (settings.AWC_GOOGLE_API_KEY ? '\n    Enter - (dash) to remove old API key' : ''),
    ask: true
  },
  { // #5
    name: 'AWC_PREFERRED_WS',
    prompt: 'preferred weather service, (w)underground, weather(b)it,\n      or (d)arksky).',
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
    name: 'AWC_DARK_SKY_API_KEY',
    prompt: 'Optional Dark Sky weather API key.' +
      (settings.AWC_DARK_SKY_API_KEY ? '\n    Enter - (dash) to remove old API key' : ''),
    ask: true
  },
  { prompt: 'Use wired DHT temperature/humidity sensor?', ask: true, yn: true, deflt: doDht ? 'Y' : 'N', validate: dhtValidate },
  { name: 'AWC_WIRED_TH_GPIO', prompt: 'GPIO pin number for wired temp/humidity sensor', ask: () => doDht, validate: pinValidate },
  { prompt: 'Use wireless temperature/humidity sensors?', ask: true, yn: true, deflt: doAcu ? 'Y' : 'N', validate: acuValidate },
  { name: 'AWC_WIRELESS_TH_GPIO', prompt: 'GPIO pin number for wireless temp/humidity sensors', ask: () => doAcu, validate: pinValidate },
  { prompt: `When finished, (l)aunch A/W clock, (r)eboot, or (n)o action ${finalOptions}?`, ask: true, deflt: finalAction, validate: finalActionValidate }
];

if (NO_MORE_DARK_SKY) {
  questions[5].prompt = 'preferred weather service, (w)underground, or weather(b)it';
  questions.splice(7, 1);
}

async function promptForConfiguration(): Promise<void> {
  console.log(chalk.cyan('- Configuration -'));

  for (let i = 0; i < questions.length; ++i) {
    const q = questions[i];

    if (!(typeof q.ask === 'function' ? q.ask() : q.ask))
      continue;

    if (q.name) {
      write(chalk.bold(q.name) + ' - ' + q.prompt + '\n    ' +
        (settings[q.name] ? '(default: ' + chalk.paleYellow(settings[q.name]) + ')' : '') + ': ');
    }
    else {
      write(q.prompt);

      if (q.yn)
        write(q.deflt === 'Y' ? ' (Y/n)' : ' (y/N)');

      write(': ');
    }

    const response = await readLine();

    if (response) {
      const validation = q.validate ? q.validate(response) : true;

      if (typeof validation === 'string')
        settings[q.name] = validation;
      else if (!validation) {
        --i;
        continue;
      }
      else if (q.name) {
        if (response === '-')
          delete settings[q.name];
        else
          settings[q.name] = response;
      }
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
      spawn('xscreensaver', [], { uid, detached: true });
      await sleep(500);
    }

    const settingsProcess = spawn('xscreensaver-demo', [], { uid });

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
  showStep();
  write('Updating client' + trailingSpace);
  await monitorProcess(spawn('npm', uid, ['i', '--no-save']), spin);
  stepDone();

  showStep();
  write('Building client' + trailingSpace);

  if (fs.existsSync('dist'))
    await monitorProcess(spawn('rm', uid, ['-Rf', 'dist']), spin);

  const output = await monitorProcess(spawn('webpack', uid), spin);

  stepDone();
  console.log(chalk.mediumGray(getWebpackSummary(output)));
}

async function doServerBuild(): Promise<void> {
  showStep();
  write('Updating server' + trailingSpace);
  await monitorProcess(spawn('npm', uid, ['i', '--no-save'], { cwd: path.join(__dirname, 'server') }), spin);
  stepDone();

  showStep();
  write('Building server' + trailingSpace);

  if (fs.existsSync('server/dist'))
    await monitorProcess(spawn('rm', uid, ['-Rf', 'server/dist']), spin);

  const output = await monitorProcess(spawn('npm', uid, ['run', isWindows ? 'build-win' : 'build'], { cwd: path.join(__dirname, 'server') }), spin);

  stepDone();
  console.log(chalk.mediumGray(getWebpackSummary(output)));

  if (doAcu) {
    showStep();
    write('Adding Acu-Rite wireless temperature/humidity sensor support' + trailingSpace);
    await npmInit();
    await monitorProcess(spawn('npm', uid, ['i', 'rpi-acu-rite-temperature@2.x'], { cwd: path.join(__dirname, 'server', 'dist') }), spin);
    stepDone();
  }

  if (doDht) {
    showStep();
    write('Adding DHT wired temperature/humidity sensor support' + trailingSpace);
    await npmInit();
    await monitorProcess(spawn('npm', uid, ['i', 'node-dht-sensor@0.4.x'], { cwd: path.join(__dirname, 'server', 'dist') }), spin);
    stepDone();
  }
}

async function doServiceDeployment(): Promise<void> {
  const autostartDir = path.join(userHome, autostartDst);

  showStep();
  write('Create or redeploy weatherService' + trailingSpace);
  await monitorProcess(spawn('cp', [serviceSrc, serviceDst], { shell: true }), spin, ErrorMode.ANY_ERROR);
  await monitorProcess(spawn('chmod', ['+x', serviceDst], { shell: true }), spin, ErrorMode.ANY_ERROR);

  const settingsText =
    `# If you edit AWC_PORT below, be sure to update\n# ${userHome}/${autostartDst}/autostart accordingly.\n` +
    Object.keys(settings).sort().map(key => key + '=' + settings[key]).join('\n') + '\n';

  fs.writeFileSync(settingsPath, settingsText);
  await monitorProcess(spawn('update-rc.d', ['weatherService', 'defaults']), spin);
  await monitorProcess(spawn('systemctl', ['enable', 'weatherService']), spin);
  await monitorProcess(spawn('mkdir', uid, ['-p', autostartDir]), spin);
  await monitorProcess(spawn('cp', uid, [rpiSetupStuff + '/autostart_extra.sh', autostartDir]),
    spin, ErrorMode.ANY_ERROR);

  const autostartPath = autostartDir + '/autostart';
  const autostartLine1 = autostartDir + '/autostart_extra.sh';
  const autostartLine2 = '@' + launchChromium.replace(/:8080\b/, ':' + settings.AWC_PORT);
  const line2Matcher = new RegExp('^' + autostartLine2.replace(/:\d{1,5}\/?/, ':!!!')
    .replace(/[^- /:!@0-9a-z]/g, '.').replace(/\//g, '\\/').replace(':!!!', ':\\d+\\b') + '\\/?$');
  let lines: string[] = [];

  try {
    lines = asLines(fs.readFileSync(autostartPath).toString()).filter(line => !!line.trim());
  }
  catch (err) {
    if (isRaspberryPi) {
      lines = [
        '@lxpanel --profile LXDE-pi',
        '@pcmanfm --desktop --profile LXDE-pi',
        '@xscreensaver -no-splash'
      ];

      if (await isInstalled('point-rpi'))
        lines.push('@point-rpi');
    }
  }

  let update = false;

  if (!lines.includes(autostartLine1)) {
    lines.push(autostartLine1);
    update = true;
  }

  for (let i = 0; i <= lines.length; ++i) {
    if (i === lines.length) {
      lines.push(autostartLine2);
      update = true;
      break;
    }
    else if (lines[i] === autostartLine2)
      break;
    else if (line2Matcher.test(lines[i])) {
      lines[i] = autostartLine2;
      update = true;
      break;
    }
  }

  if (update)
    fs.writeFileSync(autostartPath, lines.join('\n') + '\n');

  await monitorProcess(spawn('chown', 0, [sudoUser, autostartDir + '/autostart*'],
    { shell: true }), spin, ErrorMode.ANY_ERROR);
  await monitorProcess(spawn('chmod', uid, ['+x', autostartDir + '/autostart*'],
    { shell: true }), spin, ErrorMode.ANY_ERROR);
  await monitorProcess(spawn('service', ['weatherService', 'start']), spin);
  stepDone();
}

(async () => {
  try {
    if (treatAsRaspberryPi && !isRaspberryPi) {
      const isDebian = /^Linux \w+ .*\bDebian\b/i.test(await monitorProcess(spawn('uname', ['-a']), spin));
      const isLxde = await isInstalled('lxpanel');

      if (!isDebian || !isLxde) {
        console.error(chalk.redBright('--tarp option (Treat As Raspberry Pi) only available for Linux Debian with LXDE'));
        process.exit(0);
      }
    }

    uid = Number((await monitorProcess(spawn('id', ['-u', user]))).trim() || '1000');

    if (isRaspberryPi)
      await checkForGps();

    if (interactive)
      await promptForConfiguration();

    totalSteps += doAcu ? 1 : 0;
    totalSteps += doDht ? 1 : 0;
    totalSteps += (doStdDeploy || doDedicated ? 1 : 0);
    totalSteps += (doLaunch || doReboot ? 1 : 0);

    if (!doDht)
      delete settings.AWC_WIRED_TH_GPIO;

    if (!doAcu)
      delete settings.AWC_WIRELESS_TH_GPIO;

    if (doDedicated) {
      totalSteps += 9 + (doUpdateUpgrade ? 1 : 0);
      console.log(chalk.cyan('- Dedicated device setup -'));
      showStep();
      write('Stopping weatherService if currently running' + trailingSpace);
      await monitorProcess(spawn('service', ['weatherService', 'stop']), spin, ErrorMode.NO_ERRORS);
      stepDone();

      if (doUpdateUpgrade) {
        showStep();
        write('Updating/upgrading packages' + trailingSpace);
        await monitorProcess(spawn('apt-get', ['update', '-y']), spin, ErrorMode.NO_ERRORS);
        await monitorProcess(spawn('apt-get', ['upgrade', '-y']), spin, ErrorMode.NO_ERRORS);
        stepDone();
      }

      await install('pigpio', false, true);
      await install(chromium);
      await install('unclutter');
      await install('forever', true);
      await installFonts();
      await disableScreenSaver(uid);
    }

    settings.AWC_GIT_REPO_PATH = (await monitorProcess(spawn('pwd'), spin, ErrorMode.NO_ERRORS)).trim() ||
      settings.AWC_GIT_REPO_PATH;

    if (!settings.AWC_GIT_REPO_PATH)
      delete settings.AWC_GIT_REPO_PATH;

    console.log(chalk.cyan('- Building application -'));
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
    await monitorProcess(spawn('chown', ['-R', sudoUser, 'dist'], { shell: true, uid: viaBash ? 0 : uid }), spin, ErrorMode.ANY_ERROR);
    stepDone();

    if (doStdDeploy) {
      showStep();
      write('Moving server to ~/weather directory' + trailingSpace);

      if (!fs.existsSync(userHome + '/weather'))
        await monitorProcess(spawn('mkdir', [userHome + '/weather']), spin);
      else
        await monitorProcess(spawn('rm', ['-Rf', userHome + '/weather/*'], { shell: true }), spin, ErrorMode.ANY_ERROR);

      await monitorProcess(spawn('mv', ['dist/*', userHome + '/weather'], { shell: true }), spin, ErrorMode.ANY_ERROR);
      stepDone();
    }

    if (doDedicated) {
      console.log(chalk.cyan('- Dedicated device service deployment -'));
      await doServiceDeployment();
    }

    if (doLaunch) {
      console.log(chalk.cyan('- Launching Astronomy/Weather Clock -'));
      showStep();
      write(' ');
      await sleep(3000, spin);
      stepDone();
      await monitorProcess(spawn('pkill', uid, ['-o', chromium]), spin, ErrorMode.NO_ERRORS);
      await monitorProcess(spawn('pkill', uid, ['-o', chromium.substr(0, 15)]), spin, ErrorMode.NO_ERRORS);
      await sleep(500, spin);
      const display = process.env.DISPLAY ?? ':0';
      exec(`DISPLAY=${display} ${launchChromium} --user-data-dir='${userHome}'`, { uid });
      await sleep(1000);
    }

    if (doReboot) {
      console.log(chalk.cyan('- Rebooting system in 5 seconds... -'));
      showStep();
      write('Press any key to stop reboot:' + trailingSpace);

      if (!(await sleep(3000, spin, true)))
        exec('reboot');
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
