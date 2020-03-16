import * as Chalk from 'chalk';
import { ChildProcess, spawn as nodeSpawn } from 'child_process';
import * as copyfiles from 'copyfiles';
import * as fs from 'fs';
import { processMillis } from 'ks-util';
import * as path from 'path';
import { promisify } from 'util';

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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let doWwvb = false;
let isRaspberryPi = process.argv.includes('--frpi');

const chalk = new Chalk.Instance();
let canSpin = true;
let backspace = '\x08';
let trailingSpace = '  '; // Two spaces
let totalSteps = 9;
let currentStep = 0;

if (!isRaspberryPi && process.platform === 'linux') {
  try {
    if (fs.existsSync('/proc/cpuinfo')) {
      const lines = fs.readFileSync('/proc/cpuinfo').toString().split('\n');

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
  else if (arg === '--wwvb') {
    totalSteps += (doWwvb ? 0 : 1) + (doI2c ? 0 : 1);
    doWwvb = doI2c = true;
  }
  else {
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

function write(s: string): void {
  process.stdout.write(s);
}

function spawn(command: string, args: string[] = [], options?: any): ChildProcess {
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

function monitorProcess(proc: ChildProcess, doSpin = true, anyError = false): Promise<string> {
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
      reject(err);
    });
    proc.on('close', () => {
      clearInterval(slowSpin);

      if (errors && (
        anyError ||
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
async function install(cmdPkg: string): Promise<boolean> {
  showStep();

  const installed = !!(await monitorProcess(spawn('which', [cmdPkg]), false, true)).trim();

  if (installed) {
    console.log(`${cmdPkg} already installed` + trailingSpace + backspace + chalk.green(CHECK_MARK));
    return false;
  }
  else {
    write(`Installing ${cmdPkg}` + trailingSpace);
    await monitorProcess(spawn('apt-get', ['install', '-y', cmdPkg]), true, true);
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
    await install('chromium');
    await install('unclutter');

    const screenSaverJustInstalled = await install('xscreensaver');
    const settingsFile = `/home/${user}/.xscreensaver`;

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
      { uid, shell: true }), true, true);
    stepDone();

    process.exit(0);

    console.log(chalk.cyan('Starting build...'));
    showStep();
    write('Updating client' + trailingSpace);
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

      if (!fs.existsSync(process.env.HOME + '/weather'))
        fs.mkdirSync(process.env.HOME + '/weather');
      else
        await monitorProcess(spawn('rm', ['-Rf', '~/weather/*'], { shell: true }));

      await monitorProcess(spawn('mv', ['dist/*', '~/weather'], { shell: true }));
      stepDone();
    }
  }
  catch (err) {
    console.log(backspace + chalk.red(FAIL_MARK));
    console.error(err);
  }
})();
