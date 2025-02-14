import { exec } from 'child_process';
import { Request, Response, Router } from 'express';
import fs from 'fs';
import { asLines, toNumber, toBoolean } from '@tubular/util';
import { noCache } from './awcs-util';
import { monitorProcess, spawn } from './process-util';

export const router = Router();

router.post('/*name', async (req: Request, res: Response) => {
  noCache(res);

  const command = req.url.replace(/^\//, '').replace(/\?.*$/, '');
  let cmd = command;
  let args: string[] = [];
  let options: any;

  switch (cmd) {
    case 'reboot':
      break;

    case 'shutdown':
      args = ['0'];
      break;

    case 'quit':
      cmd = 'pkill';
      args = ['-o', 'chromium'];
      break;

    case 'quit-firefox':
      cmd = 'pkill';
      args = ['-o', 'firefox'];
      break;

    case 'update':
      if (!fs.existsSync(process.env.AWC_GIT_REPO_PATH) && !fs.lstatSync(process.env.AWC_GIT_REPO_PATH).isDirectory()) {
        res.status(400).send("Can't find Git repository. Invalid AWC_GIT_REPO_PATH");
        return;
      }

      cmd = 'git';
      args = ['status', '--porcelain', '-b'];
      options = { cwd: process.env.AWC_GIT_REPO_PATH };
      break;

    default:
      res.status(400).send(`Unknown command: ${cmd}`);
      return;
  }

  let response: string;

  try {
    response = (await monitorProcess(spawn(cmd, args, options))).trim();
  }
  catch (e) {
    res.status(500).send(`Command "${cmd}" failed: ${e.message ?? e.toString()}`);
    return;
  }

  if (command === 'update') {
    await performUpdate(req, res, response);
    return;
  }

  res.send('OK');
});

async function performUpdate(req: Request, res: Response, gitStatus: string): Promise<void> {
  const test = toBoolean(req.query.ut, false, true);
  const interactive = toBoolean(req.query.ia, false, true);
  const args = interactive ? '-i --reboot' : '--ddev --reboot';
  const lines = asLines(gitStatus);
  const path = process.env.AWC_GIT_REPO_PATH;
  const branch = process.env.AWC_TEST_BRANCH || 'master';
  let packageLockChanges = false;

  // If changes are ONLY to package-lock.json files, they can be discarded.
  for (let i = lines.length - 1; i >= 0; --i) {
    const line = lines[i];

    if (/\bpackage-lock.json$/.test(line)) {
      packageLockChanges = true;
      lines.splice(i, 1);
    }
  }

  if (!test && (lines?.length !== 1 || lines[0] !== `## ${branch}...origin/${branch}`)) {
    res.status(400).send(
      `The automated update will only run if your Git repository is a clean checkout of the ${branch} branch.`);
    return;
  }

  let userId = -1;
  const env = Object.assign({}, process.env);

  env.DISPLAY = ':0';

  // Get the current display user. Probably "pi", but let's make sure.
  try {
    const users = (await monitorProcess(spawn('users'))).split(/\s+/);

    for (const user of users) {
      const id = toNumber((/uid=(\d+)/.exec(await monitorProcess(spawn('id', [user]))) ?? [])[1], -1);

      if (id >= 0) {
        try {
          const lines = asLines(await monitorProcess(spawn('xhost', [], { env, uid: id })));

          for (const line of lines) {
            if (new RegExp(`\\blocaluser:${user}\\b`).test(line)) {
              userId = id;
              break;
            }
          }
        }
        catch {}
      }
    }
  }
  catch {}

  if (userId < 0) {
    res.status(500).send('Unable to perform update: display user could not be determined');
    return;
  }

  if (packageLockChanges) {
    try {
      await monitorProcess(spawn('git', ['reset', '--hard']));
    }
    catch {
      res.status(500).send('Unable to perform update: could not clean up git repository');
      return;
    }
  }

  spawn('pkill', ['-o', 'chromium'], { uid: userId });
  exec(`lxterminal -e bash -c "cd ${path} && git pull && sudo ./build.sh ${args}; bash"`,
    { cwd: path, env, uid: userId });

  res.send('OK');
}
