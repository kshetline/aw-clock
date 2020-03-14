import { Response } from 'express';

export function noCache(res: Response): void {
  res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  res.header('Expires', '-1');
  res.header('Pragma', 'no-cache');
}

export function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value) / values.length;
}

export function stdDev(values: number[]): number {
  const avg = average(values);
  const squaredDiffs = values.map(value => {
    const diff = avg - value;
    return diff * diff;
  });

  return Math.sqrt(average(squaredDiffs));
}

/**
 * Normalize a port into a number, string, or false.
 */
export function normalizePort(val: number | string): string | number | false {
  const port = parseInt(val as string, 10);

  if (isNaN(port)) {
    // named pipe
    return val;
  }

  if (port >= 0) {
    // port number
    return port;
  }

  return false;
}

export function splitIpAndPort(ipWithPossiblePort: string, defaultPort?: number): [string, number] {
  if (!ipWithPossiblePort)
    return [undefined, defaultPort];

  let $ = /^\[(.+)\]:(\d+)$/.exec(ipWithPossiblePort); // IPv6 with port

  if ($)
    return [$[1], Number($[2])];

  $ = /^([^[:]+):(\d+)$/.exec(ipWithPossiblePort); // domain or IPv4 with port

  if ($)
    return [$[1], Number($[2])];

  return [ipWithPossiblePort, defaultPort];
}
