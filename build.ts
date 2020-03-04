import * as Chalk from 'chalk';
import { ChildProcess, spawn as nodeSpawn } from 'child_process';
import * as copyfiles from 'copyfiles';
import * as fs from 'fs';
import { processMillis } from './server/src/util';
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
let doGps = false;
let doI2c = false;
let doStdDeploy = false;
let doWwvb = false;
let isRaspberryPi = false;

let chalk = new Chalk.Instance();
let canSpin = true;
let backspace = '\x08';
let trailingSpace = '  '; // Two spaces

// Remove extraneous command line args, if present.
if (/\bts-node\b/.test(process.argv[0] ?? ''))
  process.argv.splice(0, 1);

if (/\bbuild\.ts\b/.test(process.argv[0] ?? ''))
  process.argv.splice(0, 1);

if (process.argv.length === 0) {
  console.warn(chalk.yellow('Warning: no build options specified.'));
  console.warn(chalk.yellow('This could be OK, or this could mean you forgot the leading ') +
               chalk.white('--') + chalk.yellow(' before your options.'));
}

process.argv.forEach(arg => {
  if (arg === '--acu')
    doAcu = true;
  else if (arg === '--dht')
    doDht = true;
  else if (arg === '--gps')
    doGps = doI2c = true;
  else if (arg === '--pt') {
    canSpin = false;
    chalk.level = 0;
    backspace = '';
    trailingSpace = ' ';
  }
  else if (arg === '--sd')
    doStdDeploy = true;
  else if (arg === '--wwvb')
    doWwvb = doI2c = true;
  else {
    if (arg !== '--help')
      console.error('Unrecognized option "' + chalk.red(arg) + '"');

    console.log('Usage: npm run build [-- [--acu] [--dht] [--gps] [--help] [--pt] [--sd] [--wwvb]]');
    process.exit(0);
  }
});

if (process.platform === 'linux') {
  try {
    if (fs.existsSync('/proc/cpuinfo')) {
      const lines = fs.readFileSync('/proc/cpuinfo').toString().split('\n');

      for (let line of lines) {
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

if (doStdDeploy && !isRaspberryPi) {
  console.error(chalk.red('--sd option is only valid on Raspberry Pi'));
  process.exit(0);
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
    process.stdout.write(backspace + SPIN_CHARS.charAt(spinStep));
    spinStep = (spinStep + 1) % 4;
  }
}

function monitorProcess(proc: ChildProcess, doSpin = true): Promise<string> {
  let output = '';

  doSpin = doSpin && canSpin;

  return new Promise<string>((resolve, reject) => {
    const slowSpin = setInterval(doSpin ? spin : NO_OP, MAX_SPIN_DELAY);

    proc.stderr.on('data', doSpin ? spin : NO_OP);
    proc.stdout.on('data', data => {
      output += data.toString();
      (doSpin ? spin : NO_OP)();
    });
    proc.on('error', err => {
      clearInterval(slowSpin);
      reject(err);
    });
    proc.on('close', () => {
      clearInterval(slowSpin);
      resolve(output);
    });
  });
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

(async () => {
  try {
    console.log(chalk.cyan('Starting build...'));
    process.stdout.write('Updating client' + trailingSpace);
    await monitorProcess(spawn('npm', ['--dev', 'update']));
    console.log(backspace + chalk.green(CHECK_MARK));

    process.stdout.write('Building client' + trailingSpace);
    if (fs.existsSync('dist'))
      await monitorProcess(spawn('rm', ['-Rf', 'dist']));
    let output = await monitorProcess(spawn('webpack'));
    console.log(backspace + chalk.green(CHECK_MARK));
    console.log(chalk.hex('#808080')(getWebpackSummary(output)));

    process.stdout.write('Updating server' + trailingSpace);
    await monitorProcess(spawn('npm', ['--dev', 'update'], { cwd: path.join(__dirname, 'server') }));
    console.log(backspace + chalk.green(CHECK_MARK));

    process.stdout.write('Building server' + trailingSpace);
    if (fs.existsSync('server/dist'))
      await monitorProcess(spawn('rm', ['-Rf', 'server/dist']));
    output = await monitorProcess(spawn('npm', ['run', isWindows ? 'build-win' : 'build'], { cwd: path.join(__dirname, 'server') }));
    console.log(backspace + chalk.green(CHECK_MARK));
    console.log(chalk.hex('#808080')(getWebpackSummary(output)));

    if (doAcu) {
      process.stdout.write('Adding Acu-Rite wireless temperature/humidity sensor support' + trailingSpace);
      await npmInit();
      await monitorProcess(spawn('npm', ['i', 'rpi-acu-rite-temperature'], { cwd: path.join(__dirname, 'server', 'dist') }));
      console.log(backspace + chalk.green(CHECK_MARK));
    }

    if (doDht) {
      process.stdout.write('Adding DHT wired temperature/humidity sensor support' + trailingSpace);
      await npmInit();
      await monitorProcess(spawn('npm', ['i', 'node-dht-sensor'], { cwd: path.join(__dirname, 'server', 'dist') }));
      console.log(backspace + chalk.green(CHECK_MARK));
    }

    if (doI2c) {
      process.stdout.write('Adding I²C serial bus support' + trailingSpace);
      await npmInit();
      await monitorProcess(spawn('npm', ['i', 'i2c-bus'], { cwd: path.join(__dirname, 'server', 'dist') }));
      console.log(backspace + chalk.green(CHECK_MARK));
    }

    process.stdout.write('Copying server to top-level dist directory' + trailingSpace);
    await (promisify(copyfiles) as any)(['server/dist/**/*', 'dist/'], { up: 2 });
    console.log(backspace + chalk.green(CHECK_MARK));

    if (doStdDeploy) {
      process.stdout.write('Moving server to ~/weather directory' + trailingSpace);

      if (!fs.existsSync(process.env.HOME + '/weather'))
        fs.mkdirSync(process.env.HOME + '/weather');
      else
        await monitorProcess(spawn('rm', ['-Rf', '~/weather/*'], { shell: true }));

      await monitorProcess(spawn('mv', ['dist/*', '~/weather'], { shell: true }));
      console.log(backspace + chalk.green(CHECK_MARK));
   }
  }
  catch (err) {
    console.log(backspace + chalk.red(FAIL_MARK));
    console.error(err);
  }
})();
