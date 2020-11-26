import { floor, min, round } from 'ks-math';
import { mphToKnots } from './util';

interface Barbs {
  halves: number;
  full: number;
  pennants: number;
}

function speedToBarbs(speed: number, isMetric: boolean): Barbs {
  let halves: number;

  if (isMetric)
    halves = min(round(speed * 1000 / 3600 / 2.5), 20);
  else
    halves = min(round(mphToKnots(speed) / 5), 20);

  let full = floor(halves / 2);
  halves -= full * 2;
  const pennants = floor(full / 5);
  full -= pennants * 5;

  return { halves, full, pennants };
}

function barbPath(barbs: Barbs, direction: number, blankIfLow: boolean, qlass = ''): string {
  if (qlass)
    qlass = ` class="${qlass}"`;

  if (barbs.halves === 0 && barbs.full === 0 && barbs.pennants === 0)
    return blankIfLow ? '' :
      '<circle style="stroke-width: 10; fill: transparent" cx="50" cy="50" r="45"/>' +
      `<circle${qlass} style="stroke-width: 5; fill: transparent; stroke: currentColor" cx="50" cy="50" r="45"/>`;

  let rotation = '';

  if ((barbs.pennants > 0 || barbs.full > 0 || barbs.halves > 0) && direction !== 0)
    rotation = ` transform="rotate(${direction}, 50, 50)"`;

  let x = 54;
  let y = 98;
  let path = `<g${rotation}><path${qlass} style="stroke-width: 2.5" d="M ${x} ${y}`;
  const addPoint = () => path += ` L ${x} ${y}`;

  x -= 8;
  addPoint();
  y = barbs.pennants === 0 ? 11.5 : 1.5;
  addPoint();
  x += 8;
  addPoint();

  for (let i = 0; i < barbs.pennants; ++i) {
    x += 37.5; y += 10;
    addPoint();
    x -= 37.5; y += 10;
    addPoint();

    if (i === barbs.pennants - 1) {
      y += 5;
      addPoint();
    }
  }

  for (let i = 0; i < barbs.full; ++i) {
    x += 37.5; y -= 10;
    addPoint();
    y += 8;
    addPoint();
    x -= 37.5; y += 10;
    addPoint();
    y += 8;
    addPoint();
  }

  if (barbs.halves) {
    if (barbs.pennants === 0 && barbs.full === 0) {
      y += 10;
      addPoint();
    }

    x += 18.75; y -= 5;
    addPoint();
    y += 8;
    addPoint();
    x -= 18.75; y += 5;
    addPoint();
  }

  return path + ' Z"/></g>';
}

const compass = '<path class="compass" style="stroke-width: 5; fill: transparent" ' +
                'd="M 50 0 L 61.5 22.3 L 85.4 14.6 L 77.7 38.5 L 100 50 L 77.7 61.5 L 85.4 85.4 L 61.5 77.7 ' +
                'L 50 100 L 38.5 77.7 L 14.6 85.4 L 22.3 61.5 L 0 50 L 22.3 38.5 L 14.6 14.6 L 38.5 22.3 Z"/>';

export function windBarbsSvg(speed: number, gust: number, isMetric: boolean, direction: number, blankIfLow = false): string {
  if (speed == null || isNaN(speed) || speed < 0 || direction == null || isNaN(direction))
    return '';

  const barbs = speedToBarbs(speed, isMetric);
  const gustBarbs = gust && speedToBarbs(gust, isMetric);
  const windPath = barbPath(barbs, direction, blankIfLow);
  let path = '';

  if (!windPath.includes('circle'))
    path = compass;
  else if (gust)
    path += compass;

  if (gustBarbs)
    path += barbPath(gustBarbs, direction, blankIfLow, 'gust');

  return path + windPath;
}
