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
let hub: HTMLElement;
let dayOfWeekCaption: HTMLElement;
let dateCaption: HTMLElement;
let monthCaption: HTMLElement;
let yearCaption: HTMLElement;
let timeCaption: HTMLElement;
let nextDayCaption: HTMLElement;

let newMinuteCallback: NewMinuteCallback = null;
let amPm = false;
let hideseconds = false;

function pad(n) {
  return (n < 10 ? '0' : '') + n;
}

function addTickMarks() {
  const svgns = 'http://www.w3.org/2000/svg';
  const radius = 41;
  const textRadius = 33.5;
  const constellationRadius = 24;
  const center = 50;
  const clock = document.getElementById('clock');
  const planetTracks = document.getElementById('planet-tracks');

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
      const text2 = document.createElementNS(svgns, 'text');

      text2.setAttributeNS(null, 'x', x2.toString());
      text2.setAttributeNS(null, 'y', y2.toString());
      text2.setAttributeNS(null, 'dy', '3.5');
      text2.classList.add('clock-face');
      text2.textContent = h.toString();
      clock.insertBefore(text2, hands);

      const x3 = center + constellationRadius * Math.cos(Math.PI * (-i - 15) / 180);
      const y3 = center + constellationRadius * Math.sin(Math.PI * (-i - 15) / 180);
      const text3 = document.createElementNS(svgns, 'text');

      text3.setAttributeNS(null, 'x', x3.toString());
      text3.setAttributeNS(null, 'y', y3.toString());
      text3.setAttributeNS(null, 'dy', '1');
      text3.classList.add('constellation');
      text3.textContent = String.fromCodePoint(0x2648 + i / 30);
      planetTracks.appendChild(text3);
    }
  }

  const planetSymbols = [0x263C, 0x263D, 0x0263F, 0x2640, 0x2642, 0x2643, 0x2644]; // Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn

  planetSymbols.forEach((planet, index) => {
    const x = center + 10 + index * 2;
    const dy = 0.75 + (index % 2) * 2;
    const rect = document.createElementNS(svgns, 'rect');
    const text = document.createElementNS(svgns, 'text');

    rect.setAttributeNS(null, 'x', (x - 0.9).toString());
    rect.setAttributeNS(null, 'y', (center + dy - 2).toString());
    rect.setAttributeNS(null, 'width', '1.8');
    rect.setAttributeNS(null, 'height', '2.7');
    rect.setAttributeNS(null, 'fill', 'black');
    planetTracks.appendChild(rect);

    text.setAttributeNS(null, 'x', x.toString());
    text.setAttributeNS(null, 'y', center.toString());
    text.setAttributeNS(null, 'dy', dy.toString());
    text.classList.add('constellation');
    text.textContent = String.fromCodePoint(planet);
    planetTracks.appendChild(text);
  });
}

export function initClock() {
  secHand = document.getElementById('sec-hand');
  sweep = document.getElementById('sweep') as SVGAnimationElement;
  minHand = document.getElementById('min-hand');
  hourHand = document.getElementById('hour-hand');
  hands = document.getElementById('hands');
  hub = document.getElementById('hub');
  dayOfWeekCaption = document.getElementById('day-of-week');
  dateCaption = document.getElementById('date');
  monthCaption = document.getElementById('month');
  yearCaption = document.getElementById('year');
  timeCaption = document.getElementById('time');
  nextDayCaption = document.getElementById('next-day-caption');
}

function adjustTimeFontSize() {
  timeCaption.style['font-size'] = (amPm && !hideseconds ? '7.5' : '10');
}

export function setAmPm(doAmPm: boolean) {
  amPm = doAmPm;
  adjustTimeFontSize();
}

export function setHideSeconds(hide: boolean) {
  hideseconds = hide;
  adjustTimeFontSize();

  if (hide) {
    secHand.style.visibility = 'hidden';
    hub.style.visibility = 'hidden';
  }
  else {
    secHand.style.visibility = 'visible';
    hub.style.visibility = 'visible';
  }
}

export function updateTimezone(newZone: KsTimeZone) {
  zone = newZone;
}

export function getTimezone(): KsTimeZone {
  return zone;
}

function tick() {
  function rotate(elem: HTMLElement, deg: number) {
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

    let displayHour = hour;
    let suffix = '';

    if (amPm) {
      if (displayHour === 0)
        displayHour = 12;
      else if (displayHour > 12)
        displayHour -= 12;

      suffix = (hour < 12 ? ' AM' : ' PM');
    }

    timeCaption.textContent =
      pad(displayHour) + ':' +
      pad(mins) + (hideseconds ? '' : ':' + pad(secs)) + suffix;

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

export function triggerRefresh() {
  lastMinute = -1;
}
