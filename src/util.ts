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

export function setSvgHref(elem: JQuery, href: string) {
  elem.attr('href', href);

  if (isSafari()) {
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
    const elementFont = window.getComputedStyle(font).getPropertyValue('font');

    if (elementFont)
      context.font = elementFont;
    else if (fallbackFont)
      context.font = fallbackFont;
    else
      context.font = 'normal 12px sans-serif';
  }

  if (!Array.isArray(items))
    items = [items];

  for (const item of items) {
    const width = context.measureText(item).width;
    maxWidth = Math.max(maxWidth, width);
  }

  return maxWidth;
}
