import { Request, Response } from 'express';
import { acos, cos_deg, PI, sin_deg } from 'ks-math';
import { ErrorMode, monitorProcess, spawn } from './process-util';
import { ForecastData } from './shared-types';

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

export function cToF(c: number): number {
  return c * 1.8 + 32;
}

export function inchesToCm(i: number): number {
  return i * 2.54;
}

export function milesToKm(m: number): number {
  return m * 1.609344;
}

export function cmToInches(cm: number): number {
  return cm / 2.54;
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
  return (req.headers['x-real-ip'] as string) || req.connection.remoteAddress;
}

export function checkForecastIntegrity(forecast: ForecastData, currentOnly = false): boolean {
  return forecast && forecast.currently && typeof forecast.currently.temperature === 'number' &&
    (currentOnly || (
      forecast.hourly && forecast.hourly.length > 23 && typeof forecast.hourly[0].temperature === 'number' &&
      forecast.daily && forecast.daily.data && forecast.daily.data.length > 3 && typeof forecast.daily.data[0].time === 'number'));
}

const charsNeedingRegexEscape = /[-[\]/{}()*+?.\\^$|]/g;

export function escapeForRegex(s: string): string {
  return s.replace(charsNeedingRegexEscape, '\\$&');
}

export function timeStamp(): string {
  return new Date().toISOString().replace('T', ' ');
}
