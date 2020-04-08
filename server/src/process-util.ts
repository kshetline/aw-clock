import { ChildProcess, execSync, spawn as nodeSpawn } from 'child_process';

const isWindows = (process.platform === 'win32');
const sudoUser = process.env.SUDO_USER || process.env.USER || 'pi';
let userHome = '/home/pi';

userHome = (isWindows ? process.env.USERPROFILE : execSync(`grep ${sudoUser} /etc/passwd`).toString()
  .split(':')[5] || userHome);

export function getUserHome(): string {
  return userHome;
}

export function getSudoUser(): string {
  return sudoUser;
}

export enum ErrorMode { DEFAULT, ANY_ERROR, NO_ERRORS }

const MAX_MARK_TIME_DELAY = 100;
const NO_OP = () => {};

export function spawn(command: string, args: string[], options?: any): ChildProcess;
export function spawn(command: string, uid?: number, args?: string[], options?: any): ChildProcess;
export function spawn(command: string, uidOrArgs?: string[] | number, optionsOrArgs?: any, options?: any): ChildProcess {
  let uid: number;
  let args: string[];

  if (typeof uidOrArgs === 'number') {
    uid = uidOrArgs;
    args = optionsOrArgs || [];
  }
  else {
    args = uidOrArgs || [];
    options = optionsOrArgs;
    uid = options?.uid;
  }

  if (uid != null) {
    options = options ?? {};
    options.uid = uid;

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
    else if (command === 'which')
      command = 'where';

    const cmd = process.env.comspec || 'cmd';

    if (options?.uid != null) {
      options = Object.assign({}, options);
      delete options.uid;
    }

    return nodeSpawn(cmd, ['/c', command, ...args], options);
  }
  else
    return nodeSpawn(command, args, options);
}

export function monitorProcess(proc: ChildProcess, markTime: () => void = undefined, errorMode = ErrorMode.DEFAULT): Promise<string> {
  let errors = '';
  let output = '';

  return new Promise<string>((resolve, reject) => {
    const slowSpin = setInterval(markTime || NO_OP, MAX_MARK_TIME_DELAY);

    proc.stderr.on('data', data => {
      (markTime || NO_OP)();
      data = data.toString();
      // This gets confusing, because a lot of non-error progress messaging goes to stderr, and the
      //   webpack process doesn't exit with an error for compilation errors unless you make it do so.
      if (/(\[webpack.Progress])|Warning\b/.test(data))
        return;

      errors += data;
    });
    proc.stdout.on('data', data => {
      (markTime || NO_OP)();
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
