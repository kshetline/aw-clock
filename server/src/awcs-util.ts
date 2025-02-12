import { Request, Response } from 'express';
import { acos, cos_deg, PI, sin_deg } from '@tubular/math';
import { ErrorMode, monitorProcess, spawn } from './process-util';
import { Alert, ForecastData } from './shared-types';
import { isNumber } from '@tubular/util';

export function noCache(res: Response): void {
  res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  res.header('Expires', '-1');
  res.header('Pragma', 'no-cache');
}

export function jsonOrJsonp(req: Request, res: Response, data: any): void {
  if (req.query.callback)
    res.jsonp(data);
  else
    res.json(data);
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

export function fToC(f: number): number {
  return (f - 32) / 1.8;
}

export function inchesToCm(i: number): number {
  return i * 2.54;
}

export function milesToKm(m: number): number {
  return m * 1.609344;
}

export function inHgToHpa(p: number): number {
  return p * 33.864;
}

export function hpaToInHg(p: number): number {
  return p / 33.864;
}

export function autoHpa(p: number): number {
  return p > 100 ? p : inHgToHpa(p);
}

export function autoInHg(p: number): number {
  return p < 100 ? p : hpaToInHg(p);
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

  let $ = /^\[(.+)]:(\d+)$/.exec(ipWithPossiblePort); // IPv6 with port

  if ($)
    return [$[1], Number($[2])];

  $ = /^([^[:]+):(\d+)$/.exec(ipWithPossiblePort); // domain or IPv4 with port

  if ($)
    return [$[1], Number($[2])];

  return [ipWithPossiblePort, defaultPort];
}

export function roughDistanceBetweenLocationsInKm(lat1: number, long1: number, lat2: number, long2: number): number {
  let deltaRad = acos(sin_deg(lat1) * sin_deg(lat2) + cos_deg(lat1) * cos_deg(lat2) * cos_deg(long1 - long2));

  while (deltaRad > PI)
    deltaRad -= PI;

  while (deltaRad < -PI)
    deltaRad += PI;

  return deltaRad * 6378.14; // deltaRad * radius_of_earth_in_km
}

async function hasCommand(command: string): Promise<boolean> {
  return !!(await monitorProcess(spawn('which', [command]), null, ErrorMode.ANY_ERROR)).trim();
}

export async function hasGps(): Promise<boolean> {
  return await hasCommand('gpspipe') || await hasCommand('ntpq');
}

export function getRemoteAddress(req: Request): string {
  return (req.headers['x-real-ip'] as string) || req.socket.remoteAddress;
}

export function checkForecastIntegrity(forecast: ForecastData, currentOnly = false): boolean {
  return forecast?.currently && isNumber(forecast.currently.temperature) &&
    (currentOnly || (
      forecast.hourly && forecast.hourly.length > 23 && isNumber(forecast.hourly[0].temperature) &&
      forecast.daily && forecast.daily.data && forecast.daily.data.length > 3 && isNumber(forecast.daily.data[0].time)));
}

const charsNeedingRegexEscape = /[-[\]/{}()*+?.\\^$|]/g;

export function escapeForRegex(s: string): string {
  return s.replace(charsNeedingRegexEscape, '\\$&');
}

export function timeStamp(): string {
  return '[' + new Date().toISOString() + ']';
}

export function unref(timer: any): any {
  if (timer?.unref)
    timer.unref();

  return timer;
}

export function filterError(error: any): string {
  error = error?.message ?? error?.toString();

  return error && error.replace(/^\s*Error:\s*/i, '');
}

export function alertCleanUp(alertText: string): string {
  // Check for UTF-8 wrongly decoded as Latin-1
  if (!/[\u0100-\uFFFF]/.test(alertText) &&
      /[\u00C0-\u00DF][\u0080-\u00BF]|([\u00E0-\u00EF][\u0080-\u00BF]{2})|([\u00F0-\u00F7][\u0080-\u00BF]{3})/.test(alertText)) {
    const bytes = Buffer.from(alertText, 'latin1');
    // The heck it isn't the right number of arguments!
    // noinspection TypeScriptValidateJSTypes
    const altText = bytes.toString('utf8');

    if (altText.length < alertText.length)
      alertText = altText;
  }

  let alert = alertText.trim()
    .replace(/(?<=issued an?)\n\n?\* /g, ' ')
    .replace(/\bfor\.\.\.\n.*?\n\n?\* /s, match => {
      let goodLines = true;
      const lines = match.split('\n').filter(line => !!line).slice(1, -1).map(line => {
        if (line.endsWith('...'))
          return '• ' + line.trim().slice(0, -3);

        goodLines = false;
        return line;
      });

      if (goodLines)
        return 'for:\n\n' + lines.join('\n') + '\n\n* ';
      else
        return match;
    })
    .replace(/\.\.\.\n\*\s+([A-Z]{3,})\.\.\./g, '.\n\n• $1: ')
    .replace(/^((\* )?(WHAT|WHERE|WHEN|IMPACTS?|HAZARD|SOURCE))\.\.\./mg, '\n• $3: ')
    .replace(/^- (?=\w)/mg, '\xA0\xA0◦ ').replace(/([12]?\d)([0-5]\d) ([AP]M)/g, '$1:$2 $3')
    .replace(/^(.*)\.\.\.\s{3,}(.*?)(\.\.\.)?\n/mg, (match, $1, $2, $3) => {
      if (match.substring(0, 35).endsWith('   '))
        return $3 ? `${$1}, ${$2}, ` : `${$1}, ${$2} `;
      else
        return match;
    })
    .replace(/^(?<!.*\.\.\.\s{3,}.*)\.\.\.\n/mg, ':\n')
    .replace(/(?<!\.)\.\n\.\.\./g, '.\n\n')
    .replace(/\.\.\.\n/g, ':\n\n')
    .replace(/^\.(?=\w)/mg, '')
    .replace(/^[ \t]*\.{3,}/mg, '')
    .replace(/&&\s*$/, '')
    .replace(/&&/g, '⚠︎')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (alert.startsWith('•'))
    alert = '\n\n' + alert;

  return alert;
}

export function checksum53(s: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;

  for (let i = 0, ch; i < s.length; ++i) {
    ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).toUpperCase().padStart(14, '0');
}

export function setAlertId(alert: Alert): Alert {
  alert.id = checksum53(`${alert.title}\t${alert.description}\t${alert.severity}`);

  return alert;
}
