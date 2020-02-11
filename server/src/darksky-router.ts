import { Request, Response, Router } from 'express';
import request from 'request';

export const router = Router();

router.get('/', (req: Request, res: Response) => {
  res.setHeader('cache-control', 'no-cache, no-store');

  let url = `https://api.darksky.net/forecast/${process.env.AWC_DARK_SKY_API_KEY}${req.originalUrl}`.replace('/darksky/', '/');
  let frequent = false;
  const match = /(.*)(&id=)([^&]*)$/.exec(url);

  if (match) {
    url = match[1];

    if (process.env.AWC_FREQUENT_ID && match[3] === process.env.AWC_FREQUENT_ID)
      frequent = true;
  }

  req.pipe(request({
    url: url,
    qs: req.query,
    method: req.method
  }))
    .on('response', remoteRes => {
      remoteRes.headers['cache-control'] = 'max-age=' + (frequent ? '240' : '840');
    })
    .on('error', err => {
      res.status(500).send('Error connecting to Dark Sky: ' + err);
    })
    .pipe(res);
});
