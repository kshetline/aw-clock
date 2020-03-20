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
let npmInitDone = false;
let doAcu = false;
let doDht = false;
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

const chalk = new Chalk.Instance();
let canSpin = true;
let backspace = '\x08';
let trailingSpace = '  '; // Two spaces
let totalSteps = 5;
let currentStep = 0;
const settings: any = {
  AWC_ALLOW_CORS: true,
  AWC_NTP_SERVER: 'pool.ntp.org',
  AWC_PORT: '8080',
  AWC_PREFERRED_WS: 'wunderground',
  AWC_WIRED_TH_GPIO: '4',
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
    console.error(chalk.red('Raspberry Pi check failed'));
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

const onlyOnRasperryPi: string[] = [];
const onlyDedicated: string[] = [];

process.argv.forEach(arg => {
  switch (arg) {
    case '--acu':
      totalSteps += doAcu ? 0 : 1;
      doAcu = true;
      break;
    case '--bash':
      viaBash = true;
      break;
    case '--ddev':
      totalSteps += (doDedicated ? 0 : 9) + (doStdDeploy ? 0 : 1);
      doStdDeploy = true;
      doDedicated = true;
      onlyOnRasperryPi.push(arg);
      break;
    case '--dht':
      totalSteps += doDht ? 0 : 1;
      doDht = true;
      onlyOnRasperryPi.push(arg);
      break;
    case '--gps':
      totalSteps += (doGps ? 0 : 1) + (doI2c ? 0 : 1);
      doGps = doI2c = true;
      break;
    case '-i':
      interactive = true;
      delete process.env.SHLVL;
      onlyDedicated.push(arg);
      break;
    case '--launch':
      totalSteps += (doLaunch || doReboot ? 0 : 1);
      doLaunch = true;
      onlyOnRasperryPi.push(arg);
      onlyDedicated.push(arg);
      break;
    case '--pt':
      canSpin = false;
      chalk.level = 0;
      backspace = '';
      trailingSpace = ' ';
      break;
    case '--reboot':
      totalSteps += (doLaunch || doReboot ? 0 : 1);
      doReboot = true;
      doLaunch = false;
      onlyOnRasperryPi.push(arg);
      onlyDedicated.push(arg);
      break;
    case '--sd':
      totalSteps += doStdDeploy ? 0 : 1;
      doStdDeploy = true;
      onlyOnRasperryPi.push(arg);
      break;
    case '--wwvb':
      totalSteps += (doWwvb ? 0 : 1) + (doI2c ? 0 : 1);
      doWwvb = doI2c = true;
      break;
    case '--tarp':
      break; // ignore - already handled
    default:
      if (arg !== '--help')
        console.error('Unrecognized option "' + chalk.red(arg) + '"');

      if (viaBash)
        console.log(
          'Usage: sudo ./build.sh [--acu] [--ddev] [--dht] [--help] [-i]\n' +
          '                       [--launch] [--pt] [--reboot] [--sd] [--tarp]');
      else
        console.log(
          'Usage: npm run build [-- [--acu] [--ddev] [--dht] [--help] [-i]\n' +
          '                         [--launch] [--pt] [--reboot] [--sd] [--tarp]]');

      process.exit(0);
  }
});

if (!treatAsRaspberryPi && onlyOnRasperryPi.length > 0) {
  onlyOnRasperryPi.forEach(opt =>
    console.error(chalk.red(opt) + ' option is only valid on Raspberry Pi'));
  process.exit(0);
}

if (!doDedicated && onlyDedicated.length > 0) {
  onlyDedicated.forEach(opt =>
    console.error(chalk.red(opt) + ' option is only valid when used with the --ddev option'));
  process.exit(0);
}

if (treatAsRaspberryPi) {
  try {
    if (fs.existsSync(settingsPath)) {
      const lines = fs.readFileSync(settingsPath).toString().split('\n');

      lines.forEach(line => {
        const $ = /^\s*(\w+)\s*=\s*(\S+)/.exec(line);

        if ($)
          settings[$[1]] = $[2];
      });

      // Convert deprecated environment variables
      if (!settings.AWC_WIRED_TH_GPIO &&
          toBoolean(settings.AWC_HAS_INDOOR_SENSOR) && settings.AWC_TH_SENSOR_GPIO)
        settings.AWC_WIRED_TH_GPIO = settings.AWC_TH_SENSOR_GPIO;

      if (!settings.AWC_WIRELESS_TH_GPIO && settings.AWC_WIRELESS_TEMP)
        settings.AWC_WIRELESS_TH_GPIO = settings.AWC_WIRELESS_TEMP;

      delete settings.AWC_HAS_INDOOR_SENSOR;
      delete settings.AWC_TH_SENSOR_GPIO;
      delete settings.AWC_WIRELESS_TEMP;

      if (!doDht)
        delete settings.AWC_WIRED_TH_GPIO;

      if (!doAcu)
        delete settings.AWC_WIRELESS_TH_GPIO;
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
    const cmd = process.env.comspec || 'cmd';

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function install(cmdPkg: string, viaNpm = false, realOnly = false): Promise<boolean> {
  let packageArgs = [cmdPkg];

  showStep();

  if (realOnly && !isRaspberryPi) {
    console.log(`${chalk.bold(cmdPkg)} won't be installed (not real Raspberry Pi)` +
      trailingSpace + backspace + chalk.green(CHECK_MARK));
    return false;
  }

  if (cmdPkg === 'pigpio')
    packageArgs = ['pigpiop', 'python-pigpio', 'python3-pigpio'];

  const installed = !!(await monitorProcess(spawn('which', [packageArgs[0]]), false, ErrorMode.ANY_ERROR)).trim();

  if (installed) {
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
    console.log(chalk.red('Port must be a number from 1 to 65535'));
    return false;
  }

  return true;
}

function ntpValidate(s: string): boolean {
  if (/^(((?!-))(xn--|_{1,1})?[-a-z0-9]{0,61}[a-z0-9]{1,1}\.)*(xn--)?([a-z0-9][-a-z0-9]{0,60}|[-a-z0-9]{1,30}\.[a-z]{2,})(:\d{1,5})?$/i.test(s))
    return true;

  console.log(chalk.red('NTP server must be a valid domain name (with optional port number)'));
  return false;
}

function wsValidate(s: string): boolean | string {
  if (/^w/i.test(s))
    return 'wunderground';
  else if (/^d/i.test(s))
    return 'darksky';

  console.log(chalk.red('Weather service must be either "wunderground" or "darksky"'));
  return false;
}

function pinValidate(s: string): boolean {
  const pin = Number(s);

  if (isNaN(pin) || pin < 0 || pin > 32) {
    console.log(chalk.red('GPIO pin must be a number from 0 to 31'));
    return false;
  }

  return true;
}

const questions = [
  { name: 'AWC_PORT', descr: 'HTTP server port', ask: true, validate: portValidate },
  { name: 'AWC_NTP_SERVER', descr: 'time server', ask: true, validate: ntpValidate },
  { name: 'AWC_PREFERRED_WS', descr: 'preferred weather service ("wunderground" or "darksky")', ask: true, validate: wsValidate },
  { name: 'AWC_DARK_SKY_API_KEY', descr: 'Dark Sky API key (uses "wunderground" if left blank)', ask: true },
  { name: 'AWC_WIRED_TH_GPIO', descr: 'GPIO pin number for wired temp/humidity sensor', ask: doDht, validate: pinValidate },
  { name: 'AWC_WIRELESS_TH_GPIO', descr: 'GPIO pin number for wireless temp/humidity sensors', ask: doAcu, validate: pinValidate }
];

async function promptForConfiguration(): Promise<void> {
  console.log(chalk.cyan('- Configuration -'));

  for (let i = 0; i < questions.length; ++i) {
    const q = questions[i];

    if (!q.ask)
      continue;

    write(chalk.bold(q.name) + ' - ' + q.descr + '\n    ' +
      (settings[q.name] ? '(default: ' + chalk.hex('#FFFFAA')(settings[q.name]) + ')' : '') + ': ');

    const response = await readLine();

    if (response) {
      const validation = q.validate ? q.validate(response) : true;

      if (typeof validation === 'string')
        settings[q.name] = validation;
      else if (!validation) {
        --i;
        continue;
      }
      else
        settings[q.name] = response;
    }
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
  console.log(chalk.hex('#808080')(getWebpackSummary(output)));
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
  console.log(chalk.hex('#808080')(getWebpackSummary(output)));

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
  const lines = fs.readFileSync(autostartPath).toString().split('\n');
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
      const isLxde = !!(await monitorProcess(spawn('which', ['lxpanel'], { shell: true }), false)).trim();

      if (!isDebian || !isLxde) {
        console.error(chalk.red('--tarp option (Treat As Raspberry Pi) only available for Linux Debian with LXDE'));
        process.exit(0);
      }
    }

    const user = process.env.SUDO_USER || process.env.USER || 'pi';
    const uid = Number((await monitorProcess(spawn('id', ['-u', user]), false)).trim() || '1000');

    userHome = (await monitorProcess(spawn('grep', [user, '/etc/passwd']), false))
      .split(':')[5] || userHome;
    sudoUser = user;

    if (doDedicated) {
      if (interactive)
        await promptForConfiguration();

      console.log(chalk.cyan('- Dedicated device setup -'));
      showStep();
      write('Shutdown weatherService if running' + trailingSpace);
      await monitorProcess(spawn('service', ['weatherService', 'stop']), true, ErrorMode.NO_ERRORS);
      stepDone();

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
      exec(launchChromium + ' --user-data-dir=' + userHome, { uid });
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
