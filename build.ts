import * as Chalk from 'chalk';
import { ChildProcess, spawn as nodeSpawn } from 'child_process';
import * as copyfiles from 'copyfiles';
import * as fs from 'fs';
import { processMillis } from 'ks-util';
import * as path from 'path';
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
let doTools = false;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let doWwvb = false;
let isRaspberryPi = process.argv.includes('--frpi');

const chalk = new Chalk.Instance();
let canSpin = true;
let backspace = '\x08';
let trailingSpace = '  '; // Two spaces
let totalSteps = 5;
let currentStep = 0;
const settings: any = {
  AWC_ALLOW_CORS: true
};

let spawnUid = -1;
let userHome = '/home/pi';
let sudoUser = 'pi';
const cpuPath = '/proc/cpuinfo';
const settingsPath = '/etc/default/weatherService';
const serviceSrc = path.join(__dirname, 'raspberry_pi_setup/weatherService');
const serviceDst = '/etc/init.d/.';

if (!isRaspberryPi && process.platform === 'linux') {
  try {
    if (fs.existsSync(cpuPath)) {
      const lines = fs.readFileSync(cpuPath).toString().split('\n');

      for (const line of lines) {
        if (/\bModel\s*:\s*Raspberry Pi\b/i.test(line)) {
          isRaspberryPi = true;
          break;
        }
      }
    }
  }
  catch (err) {
    console.error(chalk.red('Raspberry Pi check failed'));
  }
}

// Remove extraneous command line args, if present.
if (/\b(ts-)?node\b/.test(process.argv[0] ?? ''))
  process.argv.splice(0, 1);

if (/\bbuild(\.[jt]s)?\b/.test(process.argv[0] ?? ''))
  process.argv.splice(0, 1);

if (process.argv.length === 0 && isRaspberryPi) {
  console.warn(chalk.yellow('Warning: no build options specified.'));
  console.warn(chalk.yellow('This could be OK, or this could mean you forgot the leading ') +
               chalk.white('--') + chalk.yellow(' before your options.'));
}

process.argv.forEach(arg => {
  if (arg === '--acu') {
    totalSteps += doAcu ? 0 : 1;
    doAcu = true;
  }
  else if (arg === '--dht') {
    totalSteps += doDht ? 0 : 1;
    doDht = true;
  }
  else if (arg === '--gps') {
    totalSteps += (doGps ? 0 : 1) + (doI2c ? 0 : 1);
    doGps = doI2c = true;
  }
  else if (arg === '--pt') {
    canSpin = false;
    chalk.level = 0;
    backspace = '';
    trailingSpace = ' ';
  }
  else if (arg === '--sd') {
    totalSteps += doStdDeploy ? 0 : 1;
    doStdDeploy = true;
  }
  else if (arg === '--tools') {
    totalSteps += (doTools ? 0 : 7) + (doStdDeploy ? 0 : 1);
    doStdDeploy = true;
    doTools = true;
  }
  else if (arg === '--wwvb') {
    totalSteps += (doWwvb ? 0 : 1) + (doI2c ? 0 : 1);
    doWwvb = doI2c = true;
  }
  else if (arg !== '--frpi') {
    if (arg !== '--help')
      console.error('Unrecognized option "' + chalk.red(arg) + '"');

    console.log('Usage: npm run build [-- [--acu] [--dht] [--help] [--pt] [--sd]]');
    process.exit(0);
  }
});

if (doStdDeploy && !isRaspberryPi) {
  console.error(chalk.red('--sd option is only valid on Raspberry Pi'));
  process.exit(0);
}

if (doTools && !isRaspberryPi) {
  console.error(chalk.red('--tools option is only valid on Raspberry Pi'));
  process.exit(0);
}

if (isRaspberryPi) {
  try {
    if (fs.existsSync(settingsPath)) {
      const lines = fs.readFileSync(settingsPath).toString().split('\n');

      lines.forEach(line => {
        const $ = /(\w+)\s*=\s*(\S+)/.exec(line);

        if ($)
          settings[$[1]] = $[2];
      });
    }
  }
  catch (err) {
    console.error(chalk.red('Existing settings check failed'));
  }
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

function sleep(delay: number, doSpin = true): Promise<void> {
  doSpin = doSpin && canSpin;

  return new Promise<void>(resolve => {
    const slowSpin = setInterval(doSpin ? spin : NO_OP, MAX_SPIN_DELAY);

    setTimeout(() => {
      clearInterval(slowSpin);
      resolve();
    }, delay);
  });
}

function stepDone(): void {
  console.log(backspace + chalk.green(CHECK_MARK));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function install(cmdPkg: string, viaNpm = false): Promise<boolean> {
  showStep();

  const installed = !!(await monitorProcess(spawn('which', [cmdPkg]), false, ErrorMode.ANY_ERROR)).trim();

  if (installed) {
    console.log(`${cmdPkg} already installed` + trailingSpace + backspace + chalk.green(CHECK_MARK));
    return false;
  }
  else {
    write(`Installing ${cmdPkg}` + trailingSpace);

    if (viaNpm)
      await monitorProcess(spawn('npm', ['install', '-g', cmdPkg]), true, ErrorMode.ANY_ERROR);
    else
      await monitorProcess(spawn('apt-get', ['install', '-y', cmdPkg]), true, ErrorMode.ANY_ERROR);

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
      summary += line + '\n';
      ++count;
    }
  }

  return (summary || s).trim();
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

(async () => {
  try {
    const user = process.env.SUDO_USER || process.env.USER || 'pi';
    const uid = Number((await monitorProcess(spawn('id', ['-u', user]), false)).trim() || '1000');

    userHome = (await monitorProcess(spawn('grep', [user, '/etc/passwd'])))
      .split(':')[5] || userHome;
    sudoUser = user;

    if (doTools) {
      console.log(chalk.cyan('- Tools installation -'));
      showStep();
      write('Shutdown weatherService if running' + trailingSpace);
      await monitorProcess(spawn('service', ['weatherService', 'stop']), true, ErrorMode.NO_ERRORS);
      stepDone();

      await install('chromium');
      await install('unclutter');
      await install('forever', true);

      const screenSaverJustInstalled = await install('xscreensaver');
      const settingsFile = `${userHome}/.xscreensaver`;

      showStep();
      write('Disabling screen saver' + trailingSpace);

      if (screenSaverJustInstalled || !fs.existsSync(settingsFile)) {
        const procList = await monitorProcess(spawn('ps', ['-ax']));
        const saverRunning = /\d\s+xscreensaver\b/.test(procList);

        if (!saverRunning) {
          spawn('xscreensaver', [], { uid, detached: true });
          sleep(500);
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

    console.log(chalk.cyan('- Building application -'));
    showStep();
    write('Updating client' + trailingSpace);
    spawnUid = uid;
    await monitorProcess(spawn('npm', ['--dev', 'update']));
    stepDone();

    showStep();
    write('Building client' + trailingSpace);
    if (fs.existsSync('dist'))
      await monitorProcess(spawn('rm', ['-Rf', 'dist']));
    let output = await monitorProcess(spawn('webpack'));
    stepDone();
    console.log(chalk.hex('#808080')(getWebpackSummary(output)));

    showStep();
    write('Updating server' + trailingSpace);
    await monitorProcess(spawn('npm', ['--dev', 'update'], { cwd: path.join(__dirname, 'server') }));
    stepDone();

    showStep();
    write('Building server' + trailingSpace);
    if (fs.existsSync('server/dist'))
      await monitorProcess(spawn('rm', ['-Rf', 'server/dist']));
    output = await monitorProcess(spawn('npm', ['run', isWindows ? 'build-win' : 'build'], { cwd: path.join(__dirname, 'server') }));
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

    if (doTools) {
      spawnUid = -1;
      console.log(chalk.cyan('- Service deployment -'));

      showStep();
      write('Create or redeploy weatherService' + trailingSpace);
      await monitorProcess(spawn('cp', [serviceSrc, serviceDst], { shell: true }), true, ErrorMode.ANY_ERROR);
      await monitorProcess(spawn('chmod', ['+x', serviceDst], { shell: true }), true, ErrorMode.ANY_ERROR);

      const settingsText = Object.keys(settings).map(key =>
        key + '=' + settings[key]).join('\n') + '\n';

      fs.writeFileSync(settingsPath, settingsText);
      await monitorProcess(spawn('update-rc.d', ['weatherService', 'defaults']));
      await monitorProcess(spawn('systemctl', ['enable', 'weatherService']));
      stepDone();
    }
  }
  catch (err) {
    console.log(backspace + chalk.red(FAIL_MARK));
    console.error(err);
    process.exit(1);
  }
})();
