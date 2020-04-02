import * as Chalk from 'chalk';
import { ChildProcess, exec, spawn as nodeSpawn } from 'child_process';
import * as copyfiles from 'copyfiles';
import * as fs from 'fs';
import { processMillis, toBoolean } from 'ks-util';
import * as path from 'path';
import * as readline from 'readline';
import { promisify } from 'util';

enum ErrorMode { DEFAULT, ANY_ERROR, NO_ERRORS }

const CHECK_MARK = '\u2714';
const FAIL_MARK = '\u2718';
const SPIN_CHARS = '|/-\\';
const SPIN_DELAY = 100;
const MAX_SPIN_DELAY = 100;
const NO_OP = () => {};

const isWindows = (process.platform === 'win32');

let spinStep = 0;
let lastSpin = 0;
let doUpdateUpgrade = true;
let npmInitDone = false;
let doAcu = false;
let clearAcu = false;
let doDht = false;
let clearDht = false;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let doGps = false;
let doI2c = false;
let doStdDeploy = false;
let doDedicated = false;
let doLaunch = false;
let doReboot = false;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let doWwvb = false;
let viaBash = false;
let interactive = false;
let treatAsRaspberryPi = process.argv.includes('--tarp');
let isRaspberryPi = false;

interface ExtendedChalk extends Chalk.Chalk {
  mediumGray: (s: string) => string;
  paleBlue: (s: string) => string;
  paleYellow: (s: string) => string;
}

const chalk = new Chalk.Instance() as ExtendedChalk;

chalk.mediumGray = chalk.hex('#808080');
chalk.paleBlue = chalk.hex('#66CCFF');
chalk.paleYellow = chalk.hex('#FFFFAA');

let canSpin = true;
let backspace = '\x08';
let trailingSpace = '  '; // Two spaces
let totalSteps = 5;
let currentStep = 0;
const settings: Record<string, string> = {
  AWC_ALLOW_CORS: 'true',
  AWC_NTP_SERVER: 'pool.ntp.org',
  AWC_PORT: '8080',
  AWC_PREFERRED_WS: 'wunderground',
  AWC_WIRED_TH_GPIO: '17',
  AWC_WIRELESS_TH_GPIO: '27'
};

let spawnUid = -1;
let userHome = '/home/pi';
let sudoUser = 'pi';
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
      const lines = fs.readFileSync(cpuPath).toString().split('\n');

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

const launchChromium = chromium + ' --kiosk http://localhost:8080';

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

process.argv.forEach(arg => {
  switch (arg) {
    case '--acu':
      doAcu = true;
      break;
    case '--acu-':
      doAcu = false;
      clearAcu = true;
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
    case '--gps':
      doGps = doI2c = true;
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
      canSpin = false;
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
    case '--wwvb':
      doWwvb = doI2c = true;
      break;
    case '--tarp':
      break; // ignore - already handled
    default:
      if (arg !== '--help' && arg !== '-h')
        console.error('Unrecognized option "' + chalk.redBright(arg) + '"');

      if (viaBash)
        console.log(
          'Usage: sudo ./build.sh [--acu] [--ddev] [--dht] [--help] [-i] [--launch]\n' +
          '                       [--pt] [--reboot] [--sd] [--skip-upgrade] [--tarp]');
      else
        console.log(
          'Usage: npm run build [-- [--acu] [--ddev] [--dht] [--help] [-i] [--launch]\n' +
          '                         [--pt] [--reboot] [--sd] [--skip-upgrade] [--tarp]]');

      process.exit(0);
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
      const lines = fs.readFileSync(settingsPath).toString().split('\n');
      const oldSettings: Record<string, string> = {};

      lines.forEach(line => {
        const $ = /^\s*(\w+?)\s*=\s*(\S+)/.exec(line);

        if ($)
          oldSettings[$[1]] = settings[$[1]] = $[2];
      });

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

function spawn(command: string, args: string[] = [], options?: any): ChildProcess {
  if (spawnUid >= 0 && (!options || !('uid' in options))) {
    options = options ?? {};
    options.uid = spawnUid;

    if (!options.env) {
      options.env = {};
      Object.assign(options.env, process.env);
    }

    options.env.HOME = userHome;
    options.env.LOGNAME = sudoUser;
    options.env.npm_config_cache = userHome + '/.npm';
    options.env.USER = sudoUser;
  }

  if (isWindows) {
    console.log();
    console.log(command, args);
    if (/^(chmod|chown|id)$/.test(command)) {
      // Effectively a "noop"
      command = 'rundll32';
      args = [];
    }
    else if (command === 'rm') {
      // Ad hoc, not a general solution conversion of rm!
      command = 'rmdir';
      args = ['/S', '/Q', args[1].replace(/\//g, '\\')];
    }

    const cmd = process.env.comspec || 'cmd';

    if (options?.uid != null) {
      options = Object.assign({}, options);
      delete options.uid;
    }

    console.log(command, args);

    return nodeSpawn(cmd, ['/c', command, ...args], options);
  }
  else
    return nodeSpawn(command, args, options);
}

function spin(): void {
  const now = processMillis();

  if (lastSpin < now - SPIN_DELAY) {
    lastSpin = now;
    write(backspace + SPIN_CHARS.charAt(spinStep));
    spinStep = (spinStep + 1) % 4;
  }
}

function monitorProcess(proc: ChildProcess, doSpin = true, errorMode = ErrorMode.DEFAULT): Promise<string> {
  let errors = '';
  let output = '';

  doSpin = doSpin && canSpin;

  return new Promise<string>((resolve, reject) => {
    const slowSpin = setInterval(doSpin ? spin : NO_OP, MAX_SPIN_DELAY);

    proc.stderr.on('data', data => {
      (doSpin ? spin : NO_OP)();
      data = data.toString();
      // This gets confusing, because a lot of non-error progress messaging goes to stderr, and the
      //   webpack process doesn't exit with an error for compilation errors unless you make it do so.
      if (/\[webpack.Progress]/.test(data))
        return;

      errors += data;
    });
    proc.stdout.on('data', data => {
      (doSpin ? spin : NO_OP)();
      data = data.toString();
      output += data;
      errors = '';
    });
    proc.on('error', err => {
      clearInterval(slowSpin);

      if (errorMode !== ErrorMode.NO_ERRORS)
        resolve();
      else
        reject(err);
    });
    proc.on('close', () => {
      clearInterval(slowSpin);

      if (errorMode !== ErrorMode.NO_ERRORS && errors && (
        errorMode === ErrorMode.ANY_ERROR ||
        /\b(error|exception)\b/i.test(errors) ||
        /[_0-9a-z](Error|Exception)\b/.test(errors)
      ))
        reject(errors.replace(/\bE:\s+/g, ''));
      else
        resolve(output);
    });
  });
}

function sleep(delay: number, doSpin = true, stopOnKeypress = false): Promise<boolean> {
  doSpin = doSpin && canSpin;

  return new Promise<boolean>(resolve => {
    const slowSpin = setInterval(doSpin ? spin : NO_OP, MAX_SPIN_DELAY);
    const timeout = setTimeout(() => {
      clearInterval(slowSpin);
      resolve(false);
    }, delay);

    if (stopOnKeypress) {
      readline.emitKeypressEvents(process.stdin);
      process.stdin.setRawMode(true);

      process.stdin.on('keypress', () => {
        clearInterval(slowSpin);
        clearTimeout(timeout);
        resolve(true);
      });
    }
  });
}

function stepDone(): void {
  console.log(backspace + chalk.green(CHECK_MARK));
}

async function isInstalled(command: string): Promise<boolean> {
  return !!(await monitorProcess(spawn('which', [command]), false, ErrorMode.ANY_ERROR)).trim();
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
      await monitorProcess(spawn('npm', ['install', '-g', ...packageArgs]), true, ErrorMode.ANY_ERROR);
    else
      await monitorProcess(spawn('apt-get', ['install', '-y', ...packageArgs]), true, ErrorMode.ANY_ERROR);

    stepDone();
    return true;
  }
}

function getWebpackSummary(s: string): string {
  const lines = s.split(/\r\n|\r|\n/);
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
    await monitorProcess(spawn('npm', ['init', '--yes'], { cwd: path.join(__dirname, 'server', 'dist') }));
    npmInitDone = true;
  }
}

function showStep(): void {
  write(`Step ${++currentStep} of ${totalSteps}: `);
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

function wsValidate(s: string): boolean | string {
  if (/^w/i.test(s))
    return 'wunderground';
  else if (/^d/i.test(s))
    return 'darksky';

  console.log(chalk.redBright('Weather service must be either (w)underground or (d)arksky'));
  return false;
}

function wsAfter(s: string): void {
  if (/^w/i.test(s)) {
    console.log(chalk.paleBlue('    Weather Underground chosen, but Dark Sky can be used'));
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
  const pin = Number(s);

  if (isNaN(pin) || pin < 0 || pin > 32) {
    console.log(chalk.redBright('GPIO pin must be a number from 0 to 31'));
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
  { name: 'AWC_NTP_SERVER', prompt: 'time server', ask: true, validate: ntpValidate },
  { name: 'AWC_PREFERRED_WS', prompt: 'preferred weather service, (w)underground or (d)arksky)', ask: true, validate: wsValidate, after: wsAfter },
  {
    name: 'AWC_DARK_SKY_API_KEY',
    prompt: 'Dark Sky API key (uses "wunderground" if left blank)' +
      (settings.AWC_DARK_SKY_API_KEY ? '\n    Enter - (dash) to remove old API key' : ''),
    ask: true
  },
  { prompt: 'Use wired DHT temperature/humidity sensor?', ask: true, yn: true, deflt: doDht ? 'Y' : 'N', validate: dhtValidate },
  { name: 'AWC_WIRED_TH_GPIO', prompt: 'GPIO pin number for wired temp/humidity sensor', ask: () => doDht, validate: pinValidate },
  { prompt: 'Use wireless temperature/humidity sensors?', ask: true, yn: true, deflt: doAcu ? 'Y' : 'N', validate: acuValidate },
  { name: 'AWC_WIRELESS_TH_GPIO', prompt: 'GPIO pin number for wireless temp/humidity sensors', ask: () => doAcu, validate: pinValidate },
  { prompt: `When finished, (l)aunch A/W clock, (r)eboot, or (n)o action ${finalOptions}?`, ask: true, deflt: finalAction, validate: finalActionValidate }
];

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
      await monitorProcess(spawn('cp', [fontSrc + font, fontDst + font]), true, ErrorMode.ANY_ERROR);

    await monitorProcess(spawn('fc-cache', ['-f']), true, ErrorMode.ANY_ERROR);
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
    const procList = await monitorProcess(spawn('ps', ['-ax']));
    const saverRunning = /\d\s+xscreensaver\b/.test(procList);

    if (!saverRunning) {
      spawn('xscreensaver', [], { uid, detached: true });
      await sleep(500);
    }

    const settingsProcess = spawn('xscreensaver-demo', [], { uid });

    await sleep(3000);
    settingsProcess.kill('SIGTERM');
    await sleep(500);
  }

  await monitorProcess(spawn('sed',
    ['-i', '-r', "'s/^(mode:\\s+)\\w+$/\\1off/'", settingsFile],
    { uid, shell: true }), true, ErrorMode.ANY_ERROR);

  // Stop and restart screen saver to make sure modified settings are read
  const procList = await monitorProcess(spawn('ps', ['-ax']));
  const ssProcessNo = (/^(\d+)\s+.*\d\s+xscreensaver\b/.exec(procList) ?? [])[1];

  if (ssProcessNo)
    await monitorProcess(spawn('kill', [ssProcessNo]));

  spawn('xscreensaver', [], { uid, detached: true });
  stepDone();
}

async function doClientBuild(): Promise<void> {
  showStep();
  write('Updating client' + trailingSpace);
  await monitorProcess(spawn('npm', ['i', '--no-save']));
  stepDone();

  showStep();
  write('Building client' + trailingSpace);

  if (fs.existsSync('dist'))
    await monitorProcess(spawn('rm', ['-Rf', 'dist']));

  const output = await monitorProcess(spawn('webpack'));

  stepDone();
  console.log(chalk.mediumGray(getWebpackSummary(output)));
}

async function doServerBuild(): Promise<void> {
  showStep();
  write('Updating server' + trailingSpace);
  await monitorProcess(spawn('npm', ['i', '--no-save'], { cwd: path.join(__dirname, 'server') }));
  stepDone();

  showStep();
  write('Building server' + trailingSpace);

  if (fs.existsSync('server/dist'))
    await monitorProcess(spawn('rm', ['-Rf', 'server/dist']));

  const output = await monitorProcess(spawn('npm', ['run', isWindows ? 'build-win' : 'build'], { cwd: path.join(__dirname, 'server') }));

  stepDone();
  console.log(chalk.mediumGray(getWebpackSummary(output)));

  if (doAcu) {
    showStep();
    write('Adding Acu-Rite wireless temperature/humidity sensor support' + trailingSpace);
    await npmInit();
    await monitorProcess(spawn('npm', ['i', 'rpi-acu-rite-temperature@2.x'], { cwd: path.join(__dirname, 'server', 'dist') }));
    stepDone();
  }

  if (doDht) {
    showStep();
    write('Adding DHT wired temperature/humidity sensor support' + trailingSpace);
    await npmInit();
    await monitorProcess(spawn('npm', ['i', 'node-dht-sensor@0.4.x'], { cwd: path.join(__dirname, 'server', 'dist') }));
    stepDone();
  }

  if (doI2c) {
    showStep();
    write('Adding I²C serial bus support' + trailingSpace);
    await npmInit();
    await monitorProcess(spawn('npm', ['i', 'i2c-bus'], { cwd: path.join(__dirname, 'server', 'dist') }));
    stepDone();
  }
}

async function doServiceDeployment(uid: number): Promise<void> {
  const autostartDir = path.join(userHome, autostartDst);

  showStep();
  write('Create or redeploy weatherService' + trailingSpace);
  await monitorProcess(spawn('cp', [serviceSrc, serviceDst], { shell: true }), true, ErrorMode.ANY_ERROR);
  await monitorProcess(spawn('chmod', ['+x', serviceDst], { shell: true }), true, ErrorMode.ANY_ERROR);

  const settingsText =
    `# If you edit AWC_PORT below, be sure to update\n# ${userHome}/${autostartDst}/autostart accordingly.\n` +
    Object.keys(settings).sort().map(key => key + '=' + settings[key]).join('\n') + '\n';

  fs.writeFileSync(settingsPath, settingsText);
  await monitorProcess(spawn('update-rc.d', ['weatherService', 'defaults']));
  await monitorProcess(spawn('systemctl', ['enable', 'weatherService']));
  spawnUid = uid;
  await monitorProcess(spawn('mkdir', ['-p', autostartDir]));
  await monitorProcess(spawn('cp', [rpiSetupStuff + '/autostart_extra.sh', autostartDir]),
    true, ErrorMode.ANY_ERROR);

  const autostartPath = autostartDir + '/autostart';
  const autostartLine1 = autostartDir + '/autostart_extra.sh';
  const autostartLine2 = '@' + launchChromium.replace(/:8080\b/, ':' + settings.AWC_PORT);
  const line2Matcher = new RegExp('^' + autostartLine2.replace(/:\d{1,5}/, ':!!!')
    .replace(/[^- /:!@0-9a-z]/g, '.').replace(/\//g, '\\/').replace(':!!!', ':\\d+\\b') + '$');
  let lines: string[] = [];

  try {
    lines = fs.readFileSync(autostartPath).toString().split('\n').filter(line => !!line.trim());
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

  await monitorProcess(spawn('chown', [sudoUser, autostartDir + '/autostart*'],
    { shell: true, uid: 0 }), true, ErrorMode.ANY_ERROR);
  await monitorProcess(spawn('chmod', ['+x', autostartDir + '/autostart*'],
    { shell: true }), true, ErrorMode.ANY_ERROR);
  spawnUid = -1;
  await monitorProcess(spawn('service', ['weatherService', 'start']));
  stepDone();
}

(async () => {
  try {
    if (treatAsRaspberryPi && !isRaspberryPi) {
      const isDebian = /Linux Debian/i.test(await monitorProcess(spawn('uname', ['-a']), false));
      const isLxde = await isInstalled('lxpanel');

      if (!isDebian || !isLxde) {
        console.error(chalk.redBright('--tarp option (Treat As Raspberry Pi) only available for Linux Debian with LXDE'));
        process.exit(0);
      }
    }

    const user = process.env.SUDO_USER || process.env.USER || 'pi';
    const uid = Number((await monitorProcess(spawn('id', ['-u', user]), false)).trim() || '1000');

    userHome = (isWindows ? process.env.USERPROFILE : await monitorProcess(spawn('grep', [user, '/etc/passwd']), false))
      .split(':')[5] || userHome;
    sudoUser = user;

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
      await monitorProcess(spawn('service', ['weatherService', 'stop']), true, ErrorMode.NO_ERRORS);
      stepDone();

      if (doUpdateUpgrade) {
        showStep();
        write('Updating/upgrading packages' + trailingSpace);
        await monitorProcess(spawn('apt-get', ['update', '-y']), true, ErrorMode.NO_ERRORS);
        await monitorProcess(spawn('apt-get', ['upgrade', '-y']), true, ErrorMode.NO_ERRORS);
        stepDone();
      }

      await install('pigpio', false, true);
      await install(chromium);
      await install('unclutter');
      await install('forever', true);
      await installFonts();
      await disableScreenSaver(uid);
    }

    console.log(chalk.cyan('- Building application -'));
    spawnUid = uid;
    await doClientBuild();
    await doServerBuild();

    showStep();
    write('Copying server to top-level dist directory' + trailingSpace);
    await (promisify(copyfiles) as any)(['server/dist/**/*', 'dist/'], { up: 2 });
    await monitorProcess(spawn('chown', ['-R', sudoUser, 'dist'],
      { shell: true, uid: viaBash ? 0 : uid }), true, ErrorMode.ANY_ERROR);
    stepDone();

    if (doStdDeploy) {
      showStep();
      write('Moving server to ~/weather directory' + trailingSpace);

      if (!fs.existsSync(userHome + '/weather'))
        await monitorProcess(spawn('mkdir', [userHome + '/weather']));
      else
        await monitorProcess(spawn('rm', ['-Rf', userHome + '/weather/*'], { shell: true }), true, ErrorMode.ANY_ERROR);

      await monitorProcess(spawn('mv', ['dist/*', userHome + '/weather'], { shell: true }), true, ErrorMode.ANY_ERROR);
      stepDone();
    }

    if (doDedicated) {
      spawnUid = -1;
      console.log(chalk.cyan('- Dedicated device service deployment -'));
      await doServiceDeployment(uid);
    }

    if (doLaunch) {
      spawnUid = uid;
      console.log(chalk.cyan('- Launching Astronomy/Weather Clock -'));
      showStep();
      write(' ');
      await sleep(3000, true);
      stepDone();
      await monitorProcess(spawn('pkill', ['-o', chromium], { uid }), true, ErrorMode.NO_ERRORS);
      await monitorProcess(spawn('pkill', ['-o', chromium.substr(0, 15)], { uid }), true, ErrorMode.NO_ERRORS);
      await sleep(500);
      const display = process.env.DISPLAY ?? ':0.0';
      exec(`DISPLAY=${display} ${launchChromium} --user-data-dir='${userHome}'`, { uid });
      await sleep(1000, false);
    }

    if (doReboot) {
      spawnUid = -1;
      console.log(chalk.cyan('- Rebooting system in 5 seconds... -'));
      showStep();
      write('Press any key to stop reboot:' + trailingSpace);

      if (!(await sleep(3000, true, true)))
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
