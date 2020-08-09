import { exec } from 'child_process';
import { Request, Response, Router } from 'express';
import fs from 'fs';
import { asLines } from 'ks-util';
import { noCache } from './util';
import { monitorProcess, spawn } from './process-util';

export const router = Router();

router.post('/*', async (req: Request, res: Response) => {
  noCache(res);

  const command = req.url.replace(/^\//, '');
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
    res.status(500).send(`Command "${cmd}" failed: ${e.message}`);
    return;
  }

  if (command === 'update') {
    await performUpdate(response, res);
    return;
  }

  res.status(200);
});

async function performUpdate(gitStatus: string, res: Response): Promise<void> {
  const lines = asLines(gitStatus);

  if (lines?.length !== 1 || lines[0] !== '## master...origin/master') {
    res.status(400).send('This automated update will only run if your Git repository is a clean checkout of the master branch.');
  }

  exec('DISPLAY=:0 lxterminal --command="git pull && ./build.sh --dev --reboot"', { cwd: process.env.AWC_GIT_REPO_PATH });
  spawn('pkill', ['-o', 'chromium']);

  res.status(200);
}
