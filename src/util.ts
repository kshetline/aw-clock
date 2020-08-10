/*
  Copyright © 2018-2020 Kerry Shetline, kerry@shetline.com

  MIT license: https://opensource.org/licenses/MIT

  Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
  documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
  rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
  persons to whom the Software is furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
  Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
  WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
  COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
  OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

import $ from 'jquery';
import { KsDateTime } from 'ks-date-time-zone';
import { cos_deg, Point, sin_deg } from 'ks-math';
import { asLines, htmlEscape, isEdge, isSafari, last, padLeft } from 'ks-util';

export type KeyListener = (event: KeyboardEvent) => void;

const keydownListeners: KeyListener[] = [];

export function pushKeydownListener(listener: KeyListener): void {
  keydownListeners.push(listener);
}

export function popKeydownListener(): void {
  keydownListeners.pop();
}

window.addEventListener('keydown', (event: KeyboardEvent) => {
  if (keydownListeners.length > 0)
    last(keydownListeners)(event);
});

$.fn.extend({
  enable: function (state: boolean) {
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

export function getJson(url: string, jsonp = false): Promise<any> {
  return new Promise(resolve => {
    // `$.ajax()` returns a Promise, but if I try to use that Promise directly, I can't find a way to get
    //   around "Uncaught (in promise)" errors, when what I want is a Promise resolved with an Error value.
    // noinspection JSIgnoredPromiseFromCall
    $.ajax({
      url,
      dataType: jsonp ? 'jsonp' : 'json',
      success: data => resolve(data),
      error: (jqXHR: JQueryXHR, textStatus: string, errorThrown: string) => resolve(new Error(textStatus + ': ' + errorThrown))
    });
  });
}

const basicEntities: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;' };

export function htmlEncode(s: string): string {
  return s.replace(/[<>&]/g, match => basicEntities[match]);
}

export function domAlert(message: string): void {
  const alertElem = $('#alert-dialog');
  const alertOk = $('#alert-ok');
  let match: RegExpExecArray;

  if (((match = /<pre>(.*?)<\/pre>/.exec(message)) ?? [])[1])
    message = match[1];

  if (!message.trim())
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
  });
}

type OkCallback = (isOk: boolean) => void;

export function domConfirm(message: string, callback: OkCallback): void;
export function domConfirm(message: string, optionsHtml: string, callback: OkCallback): void;
export function domConfirm(message: string, callbackOrOptions: OkCallback | string, callback?: OkCallback): void {
  let optionalHtml: string;

  if (typeof callbackOrOptions === 'string')
    optionalHtml = callbackOrOptions;
  else if (!(typeof callback === 'function'))
    callback = callbackOrOptions;

  const confirmElem = $('#confirm-dialog');
  const confirmOk = $('#confirm-ok');
  const confirmCancel = $('#confirm-cancel');
  const confirmOptions = $('#confirm-options');

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

  const doCallback = (isOk: boolean) => {
    popKeydownListener();
    confirmElem.hide();
    callback(isOk);
  };

  if (/[\r\n]/.test(message))
    $('#confirm-message').html(asLines(message).map(l => htmlEscape(l)).join('<br>\n').trim());
  else
    $('#confirm-message').text(message);

  confirmElem.show();

  confirmOk.one('click', () => doCallback(true));
  confirmCancel.one('click', () => doCallback(false));
}

export function setSvgHref(elem: JQuery, href: string) {
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

export function describeArc(x: number, y: number, radius: number, startAngle: number, endAngle: number): string {
  const start = polarToRectangular(x, y, radius, startAngle);
  const end = polarToRectangular(x, y, radius, endAngle);
  const largeArcFlag = (endAngle - startAngle <= 180 ? 0 : 1);

  return [
    'M', start.x, start.y,
    'A', radius, radius, 0, largeArcFlag, 1, end.x, end.y
  ].join(' ');
}

export function formatHour(hours: number, amPm: boolean, withH = false) {
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

export function formatTime(date: KsDateTime, amPm: boolean) {
  const hours = formatHour(date.wallTime.hrs, amPm);

  return hours.substr(0, 2) + ':' + padLeft(date.wallTime.min, 2, '0') + hours.substr(2);
}

export function convertTemp(t: number, toCelsius: boolean): number {
  return toCelsius ? (t - 32) / 1.8 : t * 1.8 + 32;
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
  return (city || '').replace(/(, [A-Z]{2}), USA?$/, '$1');
}

export function isTypeInInput(elem: HTMLElement): boolean {
  if (!(elem instanceof HTMLInputElement))
    return false;

  const type = elem.getAttribute('type');

  return /^(date|datetime-local|email|file|month|number|password|search|tel|text|time|url|week)$/.test(type);
}
