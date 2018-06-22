const { SpecReporter } = require('jasmine-spec-reporter');
const spawn = require('child_process').spawn;
let webpackServerProcess;
let stderrBuffer = '';

function sendToStderr(s) {
  // Undo console overstriking so that %-progress output appears on separate lines.
  s = s.replace(/ \x08\x08/g, '\x08');
  s = s.replace(/\x08+/g, '\n');
  stderrBuffer += s;

  let eol = stderrBuffer.lastIndexOf('\n');

  if (eol >= 0) {
    process.stderr.write(stderrBuffer.substring(0, eol + 1));
    stderrBuffer = stderrBuffer.substring(eol + 1);
  }
}

function flushStderr() {
  if (stderrBuffer) {
    process.stderr.write(stderrBuffer + '\n');
    stderrBuffer = '';
  }
}

exports.config = {
  allScriptsTimeout: 11000,
  specs: [
    './e2e/**/*.e2e-spec.ts'
  ],
  capabilities: {
    'browserName': 'chrome'
  },
  directConnect: true,
  baseUrl: 'http://localhost:4200/',
  framework: 'jasmine',
  jasmineNodeOpts: {
    showColors: true,
    defaultTimeoutInterval: 30000,
    print: function() {}
  },
  beforeLaunch() {
    return new Promise((resolve, reject) => {
      let resolved = false;
      let rejected = false;

      webpackServerProcess = spawn('webpack-dev-server', ['--port=4200']);
      webpackServerProcess.stdout.pipe(process.stdout);

      webpackServerProcess.stdout.addListener('data', chunk => {
        const msg = chunk.toString();

        if (msg.indexOf('webpack: Compiled successfully.') >= 0) {
          resolved = true;
          flushStderr();
          resolve();
        }
        else if (!resolved && msg.indexOf('webpack:') >= 0) {
          rejected = true;
          flushStderr();
          reject(msg);
        }
      });

      webpackServerProcess.stderr.addListener('data', chunk => {
        sendToStderr(chunk.toString());
      });

      // This config is meant for small projects. Assume that if a minute goes by with no errors, webpack has finished
      // building and webpack-dev-server is ready to go for e2e.
      setTimeout(() => {
        if (!resolved && !rejected) {
          resolved = true;
          resolve();
        }
      }, 60000);

      function done() {
        if (!resolved && !rejected) {
          flushStderr();
          reject('webpack-dev-server terminated unexpectedly');
        }
      }

      webpackServerProcess.addListener('close', done);
      webpackServerProcess.addListener('exit', done);
      webpackServerProcess.addListener('disconnect', done);
    });
  },
  onPrepare() {
    require('ts-node').register({
      project: 'e2e/tsconfig.e2e.json'
    });
    jasmine.getEnv().addReporter(new SpecReporter({ spec: { displayStacktrace: true } }));
  },
  onCleanUp() {
    flushStderr();

    if (webpackServerProcess && !webpackServerProcess.killed) {
      try {
        process.kill(webpackServerProcess.pid);
      }
      catch (error) {}
    }
  }
};
