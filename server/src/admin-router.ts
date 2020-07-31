import { Request, Response, Router } from 'express';
import { noCache } from './util';
import { monitorProcess, spawn } from './process-util';

export const router = Router();

router.post('/*', async (req: Request, res: Response) => {
  noCache(res);

  const cmd = req.url.replace(/^\//, '');
  let args: string[] = [];

  switch (cmd) {
    case 'reboot':
      break;

    case 'shutdown':
      args = ['0'];
      break;

    default:
      res.status(400).send(`Unknown command: ${cmd}`);
      return;
  }

  try {
    await monitorProcess(spawn(cmd, args, { uid: 0 }));
    res.status(200);
  }
  catch (e) {
    res.status(500).send(`Command "${req.query.cmd}" failed: ${e.message}`);
  }
});
