import $ from 'jquery';
import SimpleKeyboard from 'simple-keyboard';
import { isTypeInInput } from './util';

interface Point {
  x: number;
  y: number;
}

const KEEP_ONSCREEN_HEIGHT = 32;
const KEEP_ONSCREEN_WIDTH = 100;

export class Keyboard {
  private allInputs: JQuery;
  private capsOn = false;
  private enabled = true;
  private enterListeners = new Set<() => void>();
  private focusHandler = () => this.gotFocus();
  private input: HTMLInputElement;
  private readonly keyboard: SimpleKeyboard;
  private readonly keyboardElem: HTMLElement;
  private lastFocus: HTMLElement;
  private lastKeyboardCheck: any;
  private shiftOn = false;
  private shown = false;
  private topElem: HTMLElement = document.body;

  constructor(selector?: string | HTMLDivElement) {
    const defaultKeys = [
      '` 1 2 3 4 5 6 7 8 9 0 - = {bksp}',
      '{tab} q w e r t y u i o p [ ] \\',
      '{lock} a s d f g h j k l ; \' {enter}',
      '{shift} z x c v b n m , . / {shift}',
      '{space} {clear} {larr} {rarr}'
    ];
    const shiftKeys = [
      '~ ! @ # $ % ^ & * ( ) _ + {bksp}',
      '{tab} Q W E R T Y U I O P { } |',
      '{lock} A S D F G H J K L : " {enter}',
      '{shift} Z X C V B N M < > ? {shift}',
      '{space} {clear} {larr} {rarr}'
    ];
    const options = {
      display: {
        '{bksp}': 'delete',
        '{clear}': 'clear',
        '{enter}': '\xA0\xA0\xA0↵\xA0\xA0\xA0',
        '{larr}': '←',
        '{lock}': 'caps\xA0lock',
        '{rarr}': '→',
        '{shift}': 'shift',
        '{space}': ' ',
        '{tab}': '\xA0\xA0⇥\xA0\xA0'
      },
      layout: {
        default: defaultKeys,
        shift: shiftKeys,
        caps: defaultKeys.map(row => row.replace(/\b[a-z]\b/g, m => m[0].toUpperCase())),
        shiftCaps: shiftKeys.map(row => row.replace(/\b[A-Z]\b/g, m => m[0].toLowerCase()))
      },
      onChange: input => {
        if (this.input)
          this.input.value = input;
      },
      onKeyPress: button => {
        if (!this.enabled)
          return;

        if (button === '{enter}') {
          Array.from(this.enterListeners).forEach(l => l());
          return;
        }

        if (!this.input)
          return;

        const start = this.input.selectionStart;
        let end = this.input.selectionEnd;

        if (button === '{clear}') {
          this.input.value = '';
          this.keyboard.clearInput(this.input.name);

          return;
        }

        if (button === '{larr}' || button === '{rarr}') {
          const delta = button === '{larr}' ? -1 : 1;
          let pos: number;

          if (start === end)
            pos = Math.min(Math.max(start + delta, 0), this.input.value?.length ?? 0);
          else if (delta > 0)
            pos = end;
          else
            pos = start;

          this.keyboard.caretPosition = this.input.selectionStart = this.input.selectionEnd = pos;

          return;
        }

        if ((button.length === 1 || button === '{bksp}' || button === '{space}') && end > start) {
          const val = this.input.value;

          this.input.value = val.substr(0, start) + (button === '{bksp}' ? val.substr(start - 1, 1) : '') +
            val.substr(end);
          this.keyboard.setInput(this.input.value);
          end = start;
        }

        const wasShifted = this.shiftOn;

        if (button === '{lock}' || button === '{shift}' || (this.shiftOn && button !== '{shift}')) {
          let layoutName = 'default';

          this.capsOn = (+this.capsOn ^ +(button === '{lock}')) === 1;
          this.shiftOn = (+this.shiftOn ^ +(button !== '{lock}')) === 1;
          this.keyboard[this.capsOn ? 'addButtonTheme' : 'removeButtonTheme']('{lock}', 'key-locked');
          this.keyboard[this.shiftOn ? 'addButtonTheme' : 'removeButtonTheme']('{shift}', 'key-locked');

          if (this.capsOn && this.shiftOn)
            layoutName = 'shiftCaps';
          else if (this.capsOn)
            layoutName = 'caps';
          else if (this.shiftOn)
            layoutName = 'shift';

          this.keyboard.setOptions({ layoutName });
        }

        if (button === '{tab}' && document.hasFocus() && document.activeElement) {
          const focusList = $('input, button, select', this.topElem).filter(':not(:disabled)');
          const i = focusList.index(document.activeElement);
          const len = focusList.length;

          if (len > 0) {
            if (i < 0)
              this.lastFocus = focusList[0];
            else if (wasShifted)
              this.lastFocus = focusList[(i - 1 + len) % len];
            else
              this.lastFocus = focusList[(i + 1) % len];

            if (!isTypeInInput(this.lastFocus))
              this.setInput(null);

            this.lastFocus.focus();
          }
        }

        if (button.length === 1 || button === '{bksp}')
          setTimeout(() => this.input.selectionStart = this.input.selectionEnd = Math.max(end + (button === '{bksp}' ? -1 : 1), 0));
      },
      preventMouseDownDefault: true,
      tabCharOnTab: false
    };

    if (selector)
      this.keyboard = new SimpleKeyboard(selector as any, options);
    else
      this.keyboard = new SimpleKeyboard(options);

    this.keyboard.addButtonTheme('{clear}', 'clear-key');
    this.keyboard.addButtonTheme('{larr}', 'arrow-key');
    this.keyboard.addButtonTheme('{lock}', 'caps-lock');
    this.keyboard.addButtonTheme('{rarr}', 'arrow-key');
    this.keyboardElem = $('.keyboard')[0];

    $('#keyboard-close').on('click', () => {
      this.hide();

      if (this.input)
        this.input.blur();
    });

    const dragArea = $('.keyboard-title');
    let keyboardStart: Point;
    let dragStart: Point;
    let dragging = false;

    document.addEventListener('mousedown', event => {
      dragStart = { x: event.clientX, y: event.clientY };
      keyboardStart = this.keyboardElem && { x: this.keyboardElem.offsetLeft, y: this.keyboardElem.offsetTop };
    }, { capture: true, passive: true });

    dragArea.on('mousedown', event => {
      event.preventDefault();
      dragging = true;
    });
    document.addEventListener('mouseup', () => dragging = false);
    document.addEventListener('mouseleave', () => dragging = false);

    document.addEventListener('mousemove', event => {
      if (!dragging || !dragStart || !keyboardStart)
        return;

      const newPoint = { x: event.clientX, y: event.clientY };
      const dx = newPoint.x - dragStart.x;
      const dy = newPoint.y - dragStart.y;

      this.keepKeyboardOnScreen(keyboardStart.x + dx, keyboardStart.y + dy);
    });

    window.addEventListener('resize', () => {
      if (!this.enabled)
        return;

      if (this.lastKeyboardCheck) {
        clearTimeout(this.lastKeyboardCheck);
        this.lastKeyboardCheck = undefined;
      }

      if (this.keyboardElem) {
        setTimeout(() => {
          this.keepKeyboardOnScreen(this.keyboardElem.offsetLeft, this.keyboardElem.offsetTop);
          this.lastKeyboardCheck = undefined;
        }, 500);
      }
    });
  }

  addEnterListener(listener: () => void) {
    this.enterListeners.add(listener);
  }

  removeEnterListener(listener: () => void) {
    this.enterListeners.delete(listener);
  }

  setInput(input: HTMLInputElement): void {
    if (input && this.input !== input) {
      this.keyboard.setInput(input.value ?? '', input.name);
      input.addEventListener('focus', this.focusHandler);

      if (this.input)
        this.input.removeEventListener('focus', this.focusHandler);
    }
    else if (!input) {
      this.keyboard.setInput(null);
      return;
    }

    this.lastFocus = this.input = input;
    this.focusHandler();
  }

  setTopElement(elem: HTMLElement): void {
    this.topElem = elem;

    if (this.allInputs) {
      this.allInputs.off('focus');
      this.allInputs.off('blur');
    }

    this.allInputs = $('input, button, select', elem);
    this.allInputs.on('focus', event => {
      this.lastFocus = event.currentTarget;

      if (isTypeInInput(this.lastFocus)) {
        this.show();
        this.setInput(event.target as HTMLInputElement);
      }
      else
        this.setInput(null);
    });

    this.allInputs.on('blur', () => {
      this.lastFocus = undefined;

      setTimeout(() => {
        if (this.lastFocus === undefined)
          this.hide();
      }, 500);
    });
  }

  show(isShown = true): void {
    if (!this.keyboardElem || (!this.enabled && isShown))
      return;

    this.keyboardElem.style.display = isShown ? 'block' : 'none';

    if (isShown && !this.shown) {
      const x = (document.body.offsetWidth - this.keyboardElem.offsetWidth) / 2;
      const y = (document.body.offsetHeight - this.keyboardElem.offsetHeight) / 3;

      this.keepKeyboardOnScreen(x, y);
      this.shown = true;
    }
  }

  hide(): void {
    this.show(false);
  }

  enable(isEnabled = true): void {
    this.enabled = isEnabled;

    if (!isEnabled)
      this.hide();
  }

  disable(): void {
    this.enable(false);
  }

  private gotFocus() {
    const offset = this.lastFocus && $(this.lastFocus).offset();

    if (!offset)
      return;

    const bottom = offset.top + this.lastFocus.offsetHeight + 8;

    if (this.keyboardElem.offsetTop < bottom)
      this.keepKeyboardOnScreen(this.keyboardElem.offsetLeft, bottom);
  }

  private keepKeyboardOnScreen(x: number, y: number): void {
    const keyboardWidth = this.keyboardElem.offsetWidth;
    const docWidth = document.body.offsetWidth;
    const docHeight = document.body.offsetHeight;

    this.keyboardElem.style.left = Math.min(Math.max(x, 100 - keyboardWidth), docWidth - KEEP_ONSCREEN_WIDTH) + 'px';
    this.keyboardElem.style.top = Math.min(Math.max(y, 0), docHeight - KEEP_ONSCREEN_HEIGHT) + 'px';
  }
}
