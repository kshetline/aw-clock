import { floor, min, round } from 'ks-math';

interface Barbs {
  half: number;
  full: number;
  pennants: number;
}

function knotsToBarbs(knots: number): Barbs {
  knots = min(floor((knots + 2.5) / 5) * 5, 100);
  let half = round(min(knots, 100) / 5);
  let full = floor(half / 2);
  half -= full * 2;
  const pennants = floor(full / 5);
  full -= pennants * 5;

  return { half, full, pennants };
}

export function windBarbsSvg(knots: number, direction: number): string {
  if (knots == null || isNaN(knots) || knots < 0 || direction == null || isNaN(direction))
    return '';

  const barbs = knotsToBarbs(knots);

  if (barbs.half === 0 && barbs.full === 0 && barbs.pennants === 0)
    return '<circle style="stroke-width: 10; fill: transparent" cx="50" cy="50" r="45"/>' +
           '<circle style="stroke-width: 5; fill: transparent; stroke: currentColor" cx="50" cy="50" r="45"/>';

  let rotation = '';

  if (knots >= 2.5 && direction !== 0)
    rotation = ` transform="rotate(${direction}, 50, 50)"`;

  let x = 53.75;
  let y = 95;
  let path = '<path class="compass" style="stroke-width: 5; fill: transparent" ' +
             'd="M 50 0 L 61.5 22.3 L 85.4 14.6 L 77.7 38.5 L 100 50 L 77.7 61.5 L 85.4 85.4 L 61.5 77.7 ' +
             'L 50 100 L 38.5 77.7 L 14.6 85.4 L 22.3 61.5 L 0 50 L 22.3 38.5 L 14.6 14.6 L 38.5 22.3 Z"/>' +
             `<g${rotation}><path style="stroke-width: 2.5" d="M ${x} ${y}`;
  const addPoint = () => path += ` L ${x} ${y}`;

  x -= 7.5;
  addPoint();
  y = barbs.pennants === 0 ? 11.25 : 1.25;
  addPoint();
  x += 7.5;
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
    y += 7.5;
    addPoint();
    x -= 37.5; y += 10;
    addPoint();
    y += 7.5;
    addPoint();
  }

  if (barbs.half) {
    if (barbs.pennants === 0 && barbs.full === 0) {
      y += 10;
      addPoint();
    }

    x += 18.75; y -= 5;
    addPoint();
    y += 7.5;
    addPoint();
    x -= 18.75; y += 5;
    addPoint();
  }

  return path + ' Z"/><g>';
}
