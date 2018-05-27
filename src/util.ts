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
