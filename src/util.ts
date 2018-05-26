import * as $ from 'jquery';

export interface JQuery {
  enable(state?: boolean): JQuery;
}

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
