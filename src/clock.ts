// Started by using https://codepen.io/dudleystorey/pen/HLBki, but this has grown quite a bit from there.

import { getDayOfWeek, KsDateTime, KsTimeZone } from 'ks-date-time-zone';

interface SVGAnimationElement extends HTMLElement {
  beginElement: () => void;
}

type NewMinuteCallback = (hour: number, minute: number, forceRefresh: boolean) => void;

let zone = KsTimeZone.OS_ZONE;

let lastSecRotation = 0;
let lastMinute = -1;
let lastTick = -1;
const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let secHand: HTMLElement;
let sweep: SVGAnimationElement;
let minHand: HTMLElement;
let hourHand: HTMLElement;
let hands: HTMLElement;
let dayOfWeekCaption: HTMLElement;
let dateCaption: HTMLElement;
let monthCaption: HTMLElement;
let yearCaption: HTMLElement;
let timeCaption: HTMLElement;
let nextDayCaption: HTMLElement;

let newMinuteCallback: NewMinuteCallback = null;

function pad(n) {
  return (n < 10 ? '0' : '') + n;
}

function addTickMarks() {
  const svgns = 'http://www.w3.org/2000/svg';
  const radius = 41;
  const textRadius = 33.5;
  const center = 50;
  const clock = document.getElementById('clock');

  for (let i = 0; i < 360; i += 6) {
    const x1 = center + radius * Math.cos(Math.PI * i / 180);
    const y1 = center + radius * Math.sin(Math.PI * i / 180);
    const tickMark = document.createElementNS(svgns, 'circle');

    tickMark.setAttributeNS(null, 'cx', x1.toString());
    tickMark.setAttributeNS(null, 'cy', y1.toString());
    tickMark.setAttributeNS(null, 'r', (i % 30 === 0 ? 1 : 0.333).toString());
    tickMark.setAttributeNS(null, 'fill', 'white');
    tickMark.setAttributeNS(null, 'fill-opacity', '1');
    clock.appendChild(tickMark);

    if (i % 30 === 0) {
      const h = (i === 270 ? 12 : ((i + 90) % 360) / 30);
      const x2 = center + textRadius * Math.cos(Math.PI * i / 180);
      const y2 = center + textRadius * Math.sin(Math.PI * i / 180);
      const text = document.createElementNS(svgns, 'text');

      text.setAttributeNS(null, 'x', x2.toString());
      text.setAttributeNS(null, 'y', y2.toString());
      text.setAttributeNS(null, 'dy', '3.5');
      text.classList.add('clock-face-font');
      text.setAttributeNS(null, 'text-anchor', 'middle');
      text.setAttributeNS(null, 'fill', 'white');
      text.textContent = h.toString();
      clock.insertBefore(text, hands);
    }
  }
}

export function initClock() {
  secHand = document.getElementById('sec-hand');
  sweep = document.getElementById('sweep') as SVGAnimationElement;
  minHand = document.getElementById('min-hand');
  hourHand = document.getElementById('hour-hand');
  hands = document.getElementById('hands');
  dayOfWeekCaption = document.getElementById('day-of-week');
  dateCaption = document.getElementById('date');
  monthCaption = document.getElementById('month');
  yearCaption = document.getElementById('year');
  timeCaption = document.getElementById('time');
  nextDayCaption = document.getElementById('next-day-caption');
}

export function updateTimezone(newZone: KsTimeZone) {
  zone = newZone;
}

function tick() {
  function rotate(elem, deg) {
    elem.setAttribute('transform', 'rotate(' + deg + ' 50 50)');
  }

  function sweepSecondHand(start, end) {
    if (end < start) {
      end += 360;
    }

    sweep.setAttribute('from', start + ' 50 50');
    sweep.setAttribute('to', end + ' 50 50');
    sweep.setAttribute('values', start + ' 50 50; ' + (end + 2) + ' 50 50; ' + end + ' 50 50');
    sweep.beginElement();
  }

  const now = Date.now() + 200;
  const date = new KsDateTime(now, zone).wallTime;
  const secs = date.sec;
  const secRotation = 6 * secs;
  const mins = date.min;
  const hour = date.hrs;

  sweepSecondHand(lastSecRotation, secRotation);
  rotate(secHand, secRotation);
  lastSecRotation = secRotation;
  rotate(minHand, 6 * mins + 0.1 * secs);
  rotate(hourHand, 30 * (hour % 12) + mins / 2 + secs / 120);
  setTimeout(tick, 1000 - date.millis);

  setTimeout(() => {
    const dayOfTheWeek = getDayOfWeek(date.n);

    dayOfWeekCaption.textContent = daysOfWeek[dayOfTheWeek].toUpperCase();
    dateCaption.textContent = pad(date.d);
    monthCaption.textContent = months[date.m - 1].toUpperCase();
    yearCaption.textContent = date.y.toString();
    nextDayCaption.textContent = daysOfWeek[(dayOfTheWeek + 2) % 7];

    timeCaption.textContent =
      pad(hour) + ':' +
      pad(mins) + ':' +
      pad(secs);

    if (mins !== lastMinute || lastTick + 60000 <= now) {
      if (newMinuteCallback) {
        newMinuteCallback(hour, mins, lastMinute < 0);
      }

      lastMinute = mins;
      lastTick = now;
    }
  }, 200);
}

export function startClock(callback?: NewMinuteCallback) {
  newMinuteCallback = callback;
  addTickMarks();
  tick();
}
