let performanceCopy: any;

try {
  performanceCopy = performance;
}
catch (err) {}

export function processMillis(): number {
  if (performanceCopy)
    return performanceCopy.now();
  else if ((process.hrtime as any).bigint)
    return Number((process.hrtime as any).bigint()) / 1000000;
  else {
    const time = process.hrtime();

    return time[0] * 1000 + time[1] / 1000000;
  }
}

export function toBoolean(str: string): boolean {
  if (/^(true|t|yes|y)$/i.test(str))
    return true;
  else if (/^(false|f|no|n)$/i.test(str))
    return false;

  const n = Number(str);

  if (!isNaN(n))
    return n !== 0;

  return undefined;
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

export function mod(x: number, y: number): number {
  const m = x % y;

  if ((m < 0 && y > 0) || (m > 0 && y < 0)) {
    return y + m;
  }

  return m;
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
