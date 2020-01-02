/*
  Copyright © 2018 Kerry Shetline, kerry@shetline.com

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

import * as $ from 'jquery';
import { isEdge, isSafari } from 'ks-util';
import { cos_deg, Point, sin_deg } from 'ks-math';

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
    keydownListeners[keydownListeners.length - 1](event);
});

$.fn.extend({
  enable: function(state: boolean) {
    if (arguments.length === 0) {
      if (this.is('input, button'))
        return !this.attr('disabled');
      else
        return !this.hasClass('disabled');
    }
    else {
      return this.each(function() {
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

export function htmlEncode(value) {
  return $('<div/>').text(value).html();
}

export function domAlert(message: string): void {
  const alertElem = $('#alert-dialog');
  const alertOk = $('#alert-ok');

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

export function setSvgHref(elem: JQuery, href: string) {
  elem.attr('href', href);

  if (isSafari() || isEdge()) {
    elem.each(function() {
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
