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

export type KeyListener = (KeyboardEvent) => void;

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
  enable: function(state) {
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

export function isSafari(): boolean {
  return /^((?!chrome|android).)*safari/i.test(navigator.userAgent) && !isEdge();
}

export function isFirefox(): boolean {
  return /firefox/i.test(navigator.userAgent) && !/seamonkey/i.test(navigator.userAgent);
}

export function isIE(): boolean {
  return /(?:\b(MS)?IE\s+|\bTrident\/7\.0;.*\s+rv:)(\d+)/.test(navigator.userAgent);
}

export function isEdge(): boolean {
  return /\bedge\b/i.test(navigator.userAgent) && isWindows();
}

export function isWindows(): boolean {
  return navigator.appVersion.includes('Windows') || navigator.platform.startsWith('Win');
}

export function isRaspbian(): boolean {
  return navigator.userAgent.includes('Raspbian');
}

export function setSvgHref(elem: JQuery, href: string) {
  elem.attr('href', href);

  if (isSafari() || isEdge()) {
    elem.each(function() {
      this.setAttributeNS('http://www.w3.org/1999/xlink', 'href', href);
    });
  }
}

export function getTextWidth(items: string | string[], font: string | HTMLElement, fallbackFont?: string): number {
  const canvas = ((getTextWidth as any).canvas as HTMLCanvasElement ||
                  ((getTextWidth as any).canvas = document.createElement('canvas') as HTMLCanvasElement));
  const context = canvas.getContext('2d');
  let maxWidth = 0;

  if (typeof font === 'string')
    context.font = (font ? font : 'normal 12px sans-serif');
  else if (typeof font === 'object') {
    const style = window.getComputedStyle(font);
    let elementFont = style.getPropertyValue('font');

    if (elementFont)
      context.font = elementFont;
    else {
      const fontStyle = style.getPropertyValue('font-style');
      const fontVariant = style.getPropertyValue('font-variant');
      const fontWeight = style.getPropertyValue('font-weight');
      const fontSize = style.getPropertyValue('font-size');
      const fontFamily = style.getPropertyValue('font-family');

      elementFont = (fontStyle + ' ' + fontVariant + ' ' + fontWeight + ' ' + fontSize + ' ' + fontFamily)
        .replace(/ +/g, ' ').trim();

      if (elementFont)
        context.font = elementFont;
      else if (fallbackFont)
        context.font = fallbackFont;
      else
        context.font = 'normal 12px sans-serif';
    }
  }

  if (!Array.isArray(items))
    items = [items];

  for (const item of items) {
    const width = context.measureText(item).width;
    maxWidth = Math.max(maxWidth, width);
  }

  return maxWidth;
}

interface FsDocument extends HTMLDocument {
  mozFullScreenElement?: Element;
  msFullscreenElement?: Element;
  msExitFullscreen?: () => void;
  mozCancelFullScreen?: () => void;
}

export function isFullScreen(): boolean {
  const fsDoc = <FsDocument> document;

  return !!(fsDoc.fullscreenElement || fsDoc.mozFullScreenElement || fsDoc.webkitFullscreenElement || fsDoc.msFullscreenElement);
}

interface FsDocumentElement extends HTMLElement {
  msRequestFullscreen?: () => void;
  mozRequestFullScreen?: () => void;
}

export function toggleFullScreen(): void {
  const fsDoc = <FsDocument> document;

  if (!isFullScreen()) {
    const fsDocElem = <FsDocumentElement> document.documentElement;

    if (fsDocElem.requestFullscreen)
      fsDocElem.requestFullscreen();
    else if (fsDocElem.msRequestFullscreen)
      fsDocElem.msRequestFullscreen();
    else if (fsDocElem.mozRequestFullScreen)
      fsDocElem.mozRequestFullScreen();
    else if (fsDocElem.webkitRequestFullscreen)
      fsDocElem.webkitRequestFullscreen();
  }
  else if (fsDoc.exitFullscreen)
    fsDoc.exitFullscreen();
  else if (fsDoc.msExitFullscreen)
    fsDoc.msExitFullscreen();
  else if (fsDoc.mozCancelFullScreen)
    fsDoc.mozCancelFullScreen();
  else if (fsDoc.webkitExitFullscreen)
    fsDoc.webkitExitFullscreen();
}

export function setFullScreen(full: boolean): void {
  if (full !== isFullScreen())
    toggleFullScreen();
}
