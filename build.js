"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArrays = (this && this.__spreadArrays) || function () {
    for (var s = 0, i = 0, il = arguments.length; i < il; i++) s += arguments[i].length;
    for (var r = Array(s), k = 0, i = 0; i < il; i++)
        for (var a = arguments[i], j = 0, jl = a.length; j < jl; j++, k++)
            r[k] = a[j];
    return r;
};
var _a, _b;
exports.__esModule = true;
var Chalk = require("chalk");
var child_process_1 = require("child_process");
var copyfiles = require("copyfiles");
var fs = require("fs");
var ks_util_1 = require("ks-util");
var path = require("path");
var util_1 = require("util");
var CHECK_MARK = '\u2714';
var FAIL_MARK = '\u2718';
var SPIN_CHARS = '|/-\\';
var SPIN_DELAY = 100;
var MAX_SPIN_DELAY = 100;
var NO_OP = function () { };
var isWindows = (process.platform === 'win32');
var spinStep = 0;
var lastSpin = 0;
var npmInitDone = false;
var doAcu = false;
var doDht = false;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
var doGps = false;
var doI2c = false;
var doStdDeploy = false;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
var doWwvb = false;
var isRaspberryPi = process.argv.includes('--frpi');
var chalk = new Chalk.Instance();
var canSpin = true;
var backspace = '\x08';
var trailingSpace = '  '; // Two spaces
if (!isRaspberryPi && process.platform === 'linux') {
    try {
        if (fs.existsSync('/proc/cpuinfo')) {
            var lines = fs.readFileSync('/proc/cpuinfo').toString().split('\n');
            for (var _i = 0, lines_1 = lines; _i < lines_1.length; _i++) {
                var line = lines_1[_i];
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
if (/\b(ts-)?node\b/.test((_a = process.argv[0]) !== null && _a !== void 0 ? _a : ''))
    process.argv.splice(0, 1);
if (/\bbuild(\.[jt]s)?\b/.test((_b = process.argv[0]) !== null && _b !== void 0 ? _b : ''))
    process.argv.splice(0, 1);
if (process.argv.length === 0 && isRaspberryPi) {
    console.warn(chalk.yellow('Warning: no build options specified.'));
    console.warn(chalk.yellow('This could be OK, or this could mean you forgot the leading ') +
        chalk.white('--') + chalk.yellow(' before your options.'));
}
process.argv.forEach(function (arg) {
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
        console.log('Usage: npm run build [-- [--acu] [--dht] [--help] [--pt] [--sd]]');
        process.exit(0);
    }
});
if (doStdDeploy && !isRaspberryPi) {
    console.error(chalk.red('--sd option is only valid on Raspberry Pi'));
    process.exit(0);
}
function spawn(command, args, options) {
    if (args === void 0) { args = []; }
    if (isWindows) {
        var cmd = process.env.comspec || 'cmd';
        return child_process_1.spawn(cmd, __spreadArrays(['/c', command], args), options);
    }
    else
        return child_process_1.spawn(command, args, options);
}
function spin() {
    var now = ks_util_1.processMillis();
    if (lastSpin < now - SPIN_DELAY) {
        lastSpin = now;
        process.stdout.write(backspace + SPIN_CHARS.charAt(spinStep));
        spinStep = (spinStep + 1) % 4;
    }
}
function monitorProcess(proc, doSpin, anyError) {
    if (doSpin === void 0) { doSpin = true; }
    if (anyError === void 0) { anyError = false; }
    var errors = '';
    var output = '';
    doSpin = doSpin && canSpin;
    return new Promise(function (resolve, reject) {
        var slowSpin = setInterval(doSpin ? spin : NO_OP, MAX_SPIN_DELAY);
        proc.stderr.on('data', function (data) {
            (doSpin ? spin : NO_OP)();
            data = data.toString();
            // This gets confusing, because a lot of non-error progress messaging goes to stderr, and the
            //   webpack process doesn't exit with an error for compilation errors unless you make it do so.
            if (/\[webpack.Progress]/.test(data))
                return;
            errors += data;
        });
        proc.stdout.on('data', function (data) {
            (doSpin ? spin : NO_OP)();
            data = data.toString();
            output += data;
            errors = '';
        });
        proc.on('error', function (err) {
            clearInterval(slowSpin);
            reject(err);
        });
        proc.on('close', function () {
            clearInterval(slowSpin);
            if (errors && (anyError ||
                /\b(error|exception)\b/i.test(errors) ||
                /[_0-9a-z](Error|Exception)\b/.test(errors)))
                reject(errors.replace(/\bE:\s+/g, ''));
            else
                resolve(output);
        });
    });
}
function install(cmdPkg) {
    return __awaiter(this, void 0, void 0, function () {
        var installed;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, monitorProcess(spawn('which', [cmdPkg]), true, true)];
                case 1:
                    installed = !!(_a.sent()).trim();
                    if (!!installed) return [3 /*break*/, 3];
                    return [4 /*yield*/, monitorProcess(spawn('apt-get', ['install', '-y', cmdPkg]), true, true)];
                case 2:
                    _a.sent();
                    _a.label = 3;
                case 3: return [2 /*return*/];
            }
        });
    });
}
function getWebpackSummary(s) {
    var lines = s.split(/\r\n|\r|\n/);
    var summary = '';
    var count = 0;
    for (var i = 0; i < lines.length && count < 4; ++i) {
        var line = lines[i];
        if (line && !line.startsWith('>')) {
            summary += line + '\n';
            ++count;
        }
    }
    return (summary || s).trim();
}
function npmInit() {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!!npmInitDone) return [3 /*break*/, 2];
                    return [4 /*yield*/, monitorProcess(spawn('npm', ['init', '--yes'], { cwd: path.join(__dirname, 'server', 'dist') }))];
                case 1:
                    _a.sent();
                    npmInitDone = true;
                    _a.label = 2;
                case 2: return [2 /*return*/];
            }
        });
    });
}
(function () { return __awaiter(void 0, void 0, void 0, function () {
    var output, err_1;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 25, , 26]);
                // await install('unclutter');
                return [4 /*yield*/, install('foo-unknown-blargh')];
            case 1:
                // await install('unclutter');
                _a.sent();
                console.log('\ngot here');
                process.exit(0);
                console.log(chalk.cyan('Starting build...'));
                process.stdout.write('Updating client' + trailingSpace);
                return [4 /*yield*/, monitorProcess(spawn('npm', ['--dev', 'update']))];
            case 2:
                _a.sent();
                console.log(backspace + chalk.green(CHECK_MARK));
                process.stdout.write('Building client' + trailingSpace);
                if (!fs.existsSync('dist')) return [3 /*break*/, 4];
                return [4 /*yield*/, monitorProcess(spawn('rm', ['-Rf', 'dist']))];
            case 3:
                _a.sent();
                _a.label = 4;
            case 4: return [4 /*yield*/, monitorProcess(spawn('webpack'))];
            case 5:
                output = _a.sent();
                console.log(backspace + chalk.green(CHECK_MARK));
                console.log(chalk.hex('#808080')(getWebpackSummary(output)));
                process.stdout.write('Updating server' + trailingSpace);
                return [4 /*yield*/, monitorProcess(spawn('npm', ['--dev', 'update'], { cwd: path.join(__dirname, 'server') }))];
            case 6:
                _a.sent();
                console.log(backspace + chalk.green(CHECK_MARK));
                process.stdout.write('Building server' + trailingSpace);
                if (!fs.existsSync('server/dist')) return [3 /*break*/, 8];
                return [4 /*yield*/, monitorProcess(spawn('rm', ['-Rf', 'server/dist']))];
            case 7:
                _a.sent();
                _a.label = 8;
            case 8: return [4 /*yield*/, monitorProcess(spawn('npm', ['run', isWindows ? 'build-win' : 'build'], { cwd: path.join(__dirname, 'server') }))];
            case 9:
                output = _a.sent();
                console.log(backspace + chalk.green(CHECK_MARK));
                console.log(chalk.hex('#808080')(getWebpackSummary(output)));
                if (!doAcu) return [3 /*break*/, 12];
                process.stdout.write('Adding Acu-Rite wireless temperature/humidity sensor support' + trailingSpace);
                return [4 /*yield*/, npmInit()];
            case 10:
                _a.sent();
                return [4 /*yield*/, monitorProcess(spawn('npm', ['i', 'rpi-acu-rite-temperature@2.x'], { cwd: path.join(__dirname, 'server', 'dist') }))];
            case 11:
                _a.sent();
                console.log(backspace + chalk.green(CHECK_MARK));
                _a.label = 12;
            case 12:
                if (!doDht) return [3 /*break*/, 15];
                process.stdout.write('Adding DHT wired temperature/humidity sensor support' + trailingSpace);
                return [4 /*yield*/, npmInit()];
            case 13:
                _a.sent();
                return [4 /*yield*/, monitorProcess(spawn('npm', ['i', 'node-dht-sensor@0.4.x'], { cwd: path.join(__dirname, 'server', 'dist') }))];
            case 14:
                _a.sent();
                console.log(backspace + chalk.green(CHECK_MARK));
                _a.label = 15;
            case 15:
                if (!doI2c) return [3 /*break*/, 18];
                process.stdout.write('Adding I²C serial bus support' + trailingSpace);
                return [4 /*yield*/, npmInit()];
            case 16:
                _a.sent();
                return [4 /*yield*/, monitorProcess(spawn('npm', ['i', 'i2c-bus'], { cwd: path.join(__dirname, 'server', 'dist') }))];
            case 17:
                _a.sent();
                console.log(backspace + chalk.green(CHECK_MARK));
                _a.label = 18;
            case 18:
                process.stdout.write('Copying server to top-level dist directory' + trailingSpace);
                return [4 /*yield*/, util_1.promisify(copyfiles)(['server/dist/**/*', 'dist/'], { up: 2 })];
            case 19:
                _a.sent();
                console.log(backspace + chalk.green(CHECK_MARK));
                if (!doStdDeploy) return [3 /*break*/, 24];
                process.stdout.write('Moving server to ~/weather directory' + trailingSpace);
                if (!!fs.existsSync(process.env.HOME + '/weather')) return [3 /*break*/, 20];
                fs.mkdirSync(process.env.HOME + '/weather');
                return [3 /*break*/, 22];
            case 20: return [4 /*yield*/, monitorProcess(spawn('rm', ['-Rf', '~/weather/*'], { shell: true }))];
            case 21:
                _a.sent();
                _a.label = 22;
            case 22: return [4 /*yield*/, monitorProcess(spawn('mv', ['dist/*', '~/weather'], { shell: true }))];
            case 23:
                _a.sent();
                console.log(backspace + chalk.green(CHECK_MARK));
                _a.label = 24;
            case 24: return [3 /*break*/, 26];
            case 25:
                err_1 = _a.sent();
                console.log(backspace + chalk.red(FAIL_MARK));
                console.error(err_1);
                return [3 /*break*/, 26];
            case 26: return [2 /*return*/];
        }
    });
}); })();
