// noinspection TypeScriptValidateJSTypes
// The Typescript typedefs for JQuery aren't working very well.
import $ from 'jquery';
import { DateTime, Timezone } from '@tubular/time';
import { ceil, cos_deg, floor, min, mod, Point, sin_deg } from '@tubular/math';
import {
  asLines, htmlEscape, isEdge, isFunction, isObject, isSafari, isString, last, padLeft, parseColor,
  processMillis, toNumber
} from '@tubular/util';
import compareVersions, { CompareOperator } from 'compare-versions';

export type KeyListener = (event: KeyboardEvent) => void;
export type ClickishEvent = JQuery.ClickEvent | MouseEvent

export interface JsonOptions {
  jsonp?: boolean;
  params?: Record<string, string>;
  timeout?: number;
  xhr?: JQueryXHR;
}

const keydownListeners: KeyListener[] = [];

export function pushKeydownListener(listener: KeyListener): void {
  keydownListeners.push(listener);
}

export function popKeydownListener(): void {
  keydownListeners.pop();
}

export const stopPropagation = (evt: ClickishEvent, callback: (evt?: ClickishEvent) => void): void => {
  callback(evt);
  evt.stopPropagation();
};

export function parseJson(json: string): any {
  try {
    return JSON.parse(json);
  }
  catch {}

  return undefined;
}

window.addEventListener('keydown', (event: KeyboardEvent) => {
  if (keydownListeners.length > 0)
    last(keydownListeners)(event);
});

$.fn.extend({
  enable: function (state?: boolean) {
    if (arguments.length === 0) {
      if (this.is('input, button'))
        return !this.attr('disabled');
      else
        return !this.hasClass('disabled');
    }
    else {
      return this.each(function () {
        const $this = $(this);

        if ($this.is('input, button')) {
          if (state)
            $this.removeAttr('disabled');
          else
            $this.attr('disabled', 'disabled');
        }
        else
          $this.toggleClass('disabled', !state);
      });
    }
  }
});

export function getJson<T>(url: string, options?: JsonOptions): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    $.ajax({
      url,
      data: options?.params || undefined,
      dataType: options?.jsonp ? 'jsonp' : 'json',
      timeout: options?.timeout != null ? options.timeout : 60000,
      success: (data: T, _textStatus: string, jqXHR: JQueryXHR) => {
        resolve(data);

        if (options)
          options.xhr = jqXHR;
      },
      error: (_jqXHR: JQueryXHR, textStatus: string, errorThrown: string) => reject(new Error(textStatus + ': ' + errorThrown))
    });
  });
}

export function getBinary(url: string): Promise<ArrayBuffer> {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const request = new XMLHttpRequest();

    request.open('GET', url, true);
    request.responseType = 'arraybuffer';
    request.onload = (): void => {
      if (request.status === 200)
        resolve(request.response);
      else
        reject(new Error(`${request.status}: ${request.statusText}`));
    };
    request.onerror = (err: any): void => reject(err);
    request.send();
  });
}

export function getText(url: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    $.ajax({
      url,
      success: (data: string, _textStatus: string) => { resolve(data); },
      error: (_jqXHR: JQueryXHR, textStatus: string, errorThrown: string) => reject(new Error(textStatus + ': ' + errorThrown))
    });
  });
}

export function domAlert(message: string, callback?: () => void): void {
  const alertElem = $('#alert-dialog');
  const alertOk = $('#alert-ok');
  let match: RegExpExecArray;

  if (((match = /<pre>(.*?)<\/pre>/.exec(message)) ?? [])[1])
    message = match[1];

  if (!message?.trim())
    message = 'Unknown error';

  pushKeydownListener((event: KeyboardEvent) => {
    if (event.code === 'Enter' || event.code === 'Escape') {
      event.preventDefault();
      alertOk.trigger('click');
    }
  });

  $('#alert-message').text(message);
  alertElem.show();
  alertOk.one('click', () => {
    popKeydownListener();
    alertElem.hide();

    if (callback)
      callback();
  });
}

type OkCallback = (isOk: boolean) => void;

interface ConfirmOptions {
  cancelText?: string;
  okText?: string;
  optionalHtml?: string;
}

export function domConfirm(message: string, callback: OkCallback): void;
export function domConfirm(message: string, optionsHtml: string | ConfirmOptions, callback: OkCallback): void;
export function domConfirm(message: string, callbackOrOptions: OkCallback | string | ConfirmOptions, callback?: OkCallback): void {
  let cancelText = '';
  let okText = '';
  let optionalHtml: string;

  if (isFunction(callbackOrOptions))
    callback = callbackOrOptions;
  else if (isObject(callbackOrOptions))
    ({ cancelText, okText, optionalHtml } = callbackOrOptions);
  else if (isString(callbackOrOptions))
    optionalHtml = callbackOrOptions;

  const confirmDialog = $('#confirm-dialog');
  const confirmOk = $('#confirm-ok');
  const confirmCancel = $('#confirm-cancel');
  const confirmOptions = $('#confirm-options');

  confirmCancel.text(cancelText || 'Cancel');
  confirmOk.text(okText || 'OK');

  if (optionalHtml) {
    confirmOptions.css('display', 'block');
    confirmOptions.html(optionalHtml);
  }
  else {
    confirmOptions.css('display', 'none');
    confirmOptions.html('');
  }

  pushKeydownListener((event: KeyboardEvent) => {
    if (event.code === 'Enter') {
      event.preventDefault();
      confirmOk.trigger('click');
    }
    else if (event.code === 'Escape') {
      event.preventDefault();
      confirmCancel.trigger('click');
    }
  });

  const doCallback = (isOk: boolean, evt?: JQuery.ClickEvent): void => {
    if (evt)
      evt.stopPropagation();

    popKeydownListener();
    confirmOk.off('click');
    confirmCancel.off('click');
    confirmDialog.hide();
    callback(isOk);
  };

  if (/[\r\n]/.test(message))
    $('#confirm-message').html(asLines(message).map(l => htmlEscape(l)).join('<br>\n').trim());
  else
    $('#confirm-message').text(message);

  confirmOk.one('click', (evt) => doCallback(true, evt));
  confirmCancel.one('click', (evt) => doCallback(false, evt));
  confirmDialog.show();
}

export function domConfirmP(message: string): Promise<boolean>;
export function domConfirmP(message: string, optionsHtml: string | ConfirmOptions): Promise<boolean>;
export function domConfirmP(message: string, callbackOrOptions?: OkCallback | string | ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>(resolve => domConfirm(message, callbackOrOptions as any, ok => resolve(ok)));
}

export function setSvgHref(elem: JQuery, href: string): void {
  elem.attr('href', href);

  if (isSafari() || isEdge()) {
    elem.each(function () {
      this.setAttributeNS('http://www.w3.org/1999/xlink', 'href', href);
    });
  }
}

export function polarToRectangular(cx: number, cy: number, radius: number, angleInDegrees: number): Point {
  return {
    x: cx + radius * cos_deg(angleInDegrees),
    y: cy + radius * sin_deg(angleInDegrees)
  };
}

export function describeArc(cx: number, cy: number, radius: number, startAngle: number, endAngle: number): string {
  const start = polarToRectangular(cx, cy, radius, startAngle);
  const end = polarToRectangular(cx, cy, radius, endAngle);
  const largeArcFlag = (endAngle - startAngle <= 180 ? 0 : 1);

  return [
    'M', start.x, start.y,
    'A', radius, radius, 0, largeArcFlag, 1, end.x, end.y
  ].join(' ');
}

export function formatHour(hours: number, amPm: boolean, withH = false): string {
  let hour = hours;
  let suffix = '';

  if (amPm) {
    if (hour === 0)
      hour = 12;
    else if (hour > 12)
      hour -= 12;

    suffix = (hours < 12 ? 'a' : 'p');
  }
  else if (withH)
    suffix = 'h';

  return padLeft(hour, 2, '0') + suffix;
}

export function formatTime(date: DateTime, amPm: boolean): string {
  const hours = formatHour(date.wallTime.hrs, amPm);

  return hours.substr(0, 2) + ':' + padLeft(date.wallTime.min, 2, '0') + hours.substr(2);
}

export function convertSpeed(s: number, toKph: boolean): number {
  return toKph ? s * 1.609344 : s / 1.609344;
}

export function convertTemp(t: number, toCelsius: boolean): number {
  return toCelsius ? (t - 32) / 1.8 : t * 1.8 + 32;
}

export function convertPressure(p: number, toHPa: boolean): number {
  return toHPa ? p * 33.864 : p / 33.864;
}

export function mphToKnots(m: number): number {
  return m / 1.15078;
}

export function kphToKnots(k: number): number {
  return k / 1.852;
}

const compassPoints = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function compassPoint(angle: number): string {
  return compassPoints[floor(mod(angle + 11.25, 360) / 22.5)];
}

export function setSignalLevel(elem: JQuery, quality: number): void {
  const newLevel = 'signal-' + (quality < 0 ? 'lost' : 'level-' + Math.max(Math.floor((quality + 19) / 20), 1));
  let classes = ((elem[0].className as any).baseVal || '').replace(/signal-[-\w]+/, newLevel);

  if (!classes.includes(newLevel))
    classes = (classes + ' ' + newLevel).trim();

  (elem[0].className as any).baseVal = classes;
  elem.attr('data-signal-quality', (quality < 0 ? 0 : quality) + '%');
}

export function adjustCityName(city: string): string {
  return (city || '').trim().replace(/(, [A-Z]{2}), USA?$/, '$1').replace(', ,', ',').replace(/(^,\s*)|(\s*,$)/g, '');
}

export function isTypeInInput(elem: HTMLElement): boolean {
  if (!(elem instanceof HTMLInputElement))
    return false;

  const type = elem.getAttribute('type');

  return /^(date|datetime-local|email|file|month|number|password|search|tel|text|time|url|week)$/.test(type);
}

interface DialogInfo {
  textArea: JQuery;
  lastLineHeight?: number;
}

const dialogStack: DialogInfo[] = [];
const initDone = new Set<string>();
const OUTER_CLICK_DELAY = 500;
let openTime = 0;
let otherDialogCount = 0;

export function anyDialogOpen(): boolean {
  return dialogStack.length > 0 || otherDialogCount > 0;
}

export function incrementDialogCounter(): void {
  ++otherDialogCount;
}

export function decrementDialogCounter(): void {
  otherDialogCount = Math.max(otherDialogCount - 1, 0);
}

function checkFont(): void {
  const dialogInfo = last(dialogStack);
  const textArea = dialogInfo?.textArea;
  const pageLines = toNumber(textArea?.parent().css('--page-lines'));

  if (!pageLines)
    return;

  const style = document.defaultView.getComputedStyle(dialogInfo.textArea.parent()[0], null);
  const exactHeight = parseFloat(style.getPropertyValue('line-height'));
  const roundedHeight = Math.floor(exactHeight);

  if (dialogInfo.lastLineHeight !== roundedHeight) {
    const top = Math.floor(roundedHeight / 2) - 1;
    const bottom = roundedHeight - top - 2;
    const maxHeight = Math.round(roundedHeight * pageLines);
    const pageHeight = Math.floor(toNumber(textArea?.parent().css('--page-height')) / 100 * window.innerHeight);
    const scrollExcess = Math.max(textArea[0].scrollHeight - maxHeight, 0);
    const bottomMargin = Math.min(pageHeight ? pageHeight - maxHeight : 0, scrollExcess);

    dialogInfo.textArea.css('line-height', roundedHeight + 'px');
    dialogInfo.textArea.css('max-height', maxHeight + 'px');
    dialogInfo.textArea.css('--top-hr-margin', top + 'px');
    dialogInfo.textArea.css('--bottom-hr-margin', bottom + 'px');
    dialogInfo.textArea.css('margin-bottom', bottomMargin + 'px');
    dialogInfo.lastLineHeight = roundedHeight;
  }
}

window.addEventListener('resize', checkFont);

export function displayHtml(dialogId: string, html: string, background = 'white', callback?: () => void): void {
  openTime = processMillis();

  const id = '#' + dialogId;
  const dialog = $(id);
  const closer = $(`${id} > div > .dialog-close`);
  const textArea = $(`${id} > div > .dialog-text`);
  const fader = (/(<div class="dialog-fader"[^<]+?<\/div>)\s*$/.exec(textArea.html()) ?? [])[1] ?? '';
  const rgb = parseColor(background);

  if (fader) {
    textArea.css('--fade-from', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
    textArea.css('--fade-to', background);
  }

  textArea.parent().css('background-color', background);
  textArea.html(html + fader);
  dialog.show();
  textArea.scrollTop(0);

  dialogStack.push({ textArea });
  checkFont();

  const hide = (evt?: any): void => {
    if (evt?.preventDefault)
      evt.preventDefault();

    if (evt?.stopPropagation)
      evt.stopPropagation();

    popKeydownListener();
    dialogStack.pop();
    dialog.hide();

    if (callback)
      callback();
  };

  pushKeydownListener((evt: KeyboardEvent) => {
    if (evt.code === 'Enter' || evt.code === 'Escape') {
      evt.preventDefault();
      hide();
    }
  });

  if (!initDone.has(dialogId)) {
    let dragging = false;
    let downY: number;
    let lastY: number;
    let scrollY: number;
    let gotTouch = false;

    const mouseDown = (target: HTMLElement, offsetX: number, y: number): void => {
      // Ignore clicks inside the scrollbar (if present)
      if (offsetX > target.clientWidth)
        return;

      dragging = true;
      lastY = downY = y;
      scrollY = textArea.scrollTop();
    };

    textArea.on('mousedown', event => mouseDown(event.target, event.offsetX, event.pageY));
    textArea.on('touchstart', event => event.touches[0] &&
      mouseDown(event.target, event.touches[0].pageX - event.target.getBoundingClientRect().left, event.touches[0].pageY));

    const mouseMove = (y: number): void => {
      if (!gotTouch || !dragging || y === lastY)
        return;

      const dy = y - downY;

      lastY = y;
      textArea.scrollTop(scrollY - dy);
    };

    textArea.on('mousemove', event => mouseMove(event.pageY));
    textArea.on('touchmove', event => {
      if (!gotTouch) {
        textArea.css('user-select', 'none');
        gotTouch = true;
      }

      mouseMove(event.touches[0]?.pageY ?? lastY);
    });

    const mouseUp = (): void => {
      dragging = false;
      lastY = downY = undefined;
    };

    textArea.on('mouseup', () => mouseUp());
    textArea.on('touchend', () => mouseUp());
    textArea.on('touchcancel', () => mouseUp());

    closer.on('click', hide);
    textArea.parent().on('click', evt => evt.stopPropagation());
    dialog.on('click', evt => {
      if (processMillis() >= openTime + OUTER_CLICK_DELAY)
        hide(evt);
    });

    initDone.add(dialogId);
  }
}

export function localDateString(time: number, zone: Timezone): string {
  const wallTime = new DateTime(time, zone).wallTime;

  return new Date(wallTime.y, wallTime.m - 1, wallTime.d, 12).toLocaleDateString(undefined,
    { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

export function localShortDateTime(time: number, zone: Timezone, amPm: boolean): string {
  const wallTime = new DateTime(time, zone).wallTime;
  const options: Intl.DateTimeFormatOptions =
    { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };

  if (amPm)
    options.hourCycle = 'h12';
  else
    options.hourCycle = 'h23';

  return new Date(wallTime.y, wallTime.m - 1, wallTime.d, wallTime.hrs, wallTime.min).toLocaleDateString(undefined, options);
}

export function localShortDate(time: number, zone: Timezone): string {
  const wallTime = new DateTime(time, zone).wallTime;
  const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit' };

  return new Date(wallTime.y, wallTime.m - 1, wallTime.d).toLocaleDateString(undefined, options);
}

export function localShortTime(time: number, zone: Timezone, amPm: boolean): string {
  const wallTime = new DateTime(time, zone).wallTime;
  const options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };

  if (amPm)
    options.hourCycle = 'h12';
  else
    options.hourCycle = 'h23';

  return new Date(wallTime.y, wallTime.m - 1, wallTime.d, wallTime.hrs, wallTime.min).toLocaleTimeString(undefined, options);
}

export function safeCompareVersions(firstVersion: string, secondVersion: string, defValue?: number): number;
export function safeCompareVersions(firstVersion: string, secondVersion: string, operator?: CompareOperator, defValue?: boolean): boolean;
export function safeCompareVersions(firstVersion: string, secondVersion: string,
                                    operatorOrDefValue: CompareOperator | number, defValue = false): number | boolean {
  try {
    if (isString(operatorOrDefValue))
      return compareVersions.compare(firstVersion, secondVersion, operatorOrDefValue);
    else {
      /* false inspection alarm */ // noinspection JSUnusedAssignment
      operatorOrDefValue = operatorOrDefValue ?? -1;

      return compareVersions(firstVersion, secondVersion);
    }
  }
  catch {}

  return isString(operatorOrDefValue) ? defValue : operatorOrDefValue;
}

export function getDayClasses(qlass: string): HTMLElement[] {
  return (Array.from(document.getElementsByClassName(qlass)) as HTMLElement[])
    .filter(h => !h.id.includes('dayN'))
    .sort((a, b) => parseFloat(a.id.substr(3)) - parseFloat(b.id.substr(3)));
}

export function fToC(f: number): number {
  return (f - 32) / 1.8;
}

export function findRepeatTime(baseTime: number, repeat: string, currTime): number {
  currTime = floor(currTime / 60000); // Convert to minutes

  if (baseTime > 1440 && baseTime < currTime + 60) {
    if (repeat === 'W')
      return baseTime + ceil(currTime - baseTime, 1440 * 7);
    else if (repeat === 'BW')
      return baseTime + ceil(currTime - baseTime, 1440 * 14);
    else if (repeat === 'M' || repeat === 'Y') {
      const base = new DateTime(baseTime * 60000, 'UTC').wallTime;
      const currDate = new DateTime(currTime * 60000, 'UTC');
      const curr = { y: currDate.wallTime.y, m: currDate.wallTime.m, d: currDate.wallTime.d,
                     hrs:  currDate.wallTime.hrs, min: currDate.wallTime.min };

      if (repeat === 'M' && (curr.y > base.y || curr.y === base.y && curr.m > base.m))
        curr.d = min(base.d, currDate.getLastDateInMonth(curr.y, curr.m));
      else if (repeat === 'Y') {
        curr.m = base.m;
        curr.d = min(base.d, currDate.getLastDateInMonth(curr.y, base.m));

        if (new DateTime(curr, 'UTC').utcTimeMillis < currDate.utcTimeMillis) {
          ++curr.y;
          curr.d = min(base.d, currDate.getLastDateInMonth(curr.y, base.m));
        }
      }
      else
        return baseTime;

      return floor(new DateTime(curr, 'UTC').utcTimeMillis / 60000);
    }
  }

  return baseTime;
}
