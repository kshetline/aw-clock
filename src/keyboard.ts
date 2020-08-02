import * as $ from 'jquery';
import SimpleKeyboard from 'simple-keyboard';

interface Point {
  x: number;
  y: number;
}

const KEEP_ONSCREEN_HEIGHT = 32;
const KEEP_ONSCREEN_WIDTH = 100;

export class Keyboard {
  private capsOn = false;
  private readonly keyboard: SimpleKeyboard;
  private readonly keyboardElem: HTMLElement;
  private lastKeyboardCheck: any;
  private shiftOn = false;

  constructor() {
    this.keyboard = new SimpleKeyboard({
      display: {
        '{bksp}': 'delete',
        '{enter}': '\xA0\xA0\xA0↵\xA0\xA0\xA0',
        '{lock}': 'caps\xA0lock',
        '{shift}': 'shift',
        '{space}': ' ',
        '{tab}': '\xA0\xA0⇥\xA0\xA0'
      },
      layout: {
        default: [
          '` 1 2 3 4 5 6 7 8 9 0 - = {bksp}',
          '{tab} q w e r t y u i o p [ ] \\',
          '{lock} a s d f g h j k l ; \' {enter}',
          '{shift} z x c v b n m , . / {shift}',
          '{space}'
        ],
        shift: [
          '~ ! @ # $ % ^ & * ( ) _ + {bksp}',
          '{tab} Q W E R T Y U I O P { } |',
          '{lock} A S D F G H J K L : " {enter}',
          '{shift} Z X C V B N M < > ? {shift}',
          '{space}'
        ],
        caps: [
          '` 1 2 3 4 5 6 7 8 9 0 - = {bksp}',
          '{tab} Q W E R T Y U I O P [ ] \\',
          '{lock} A S D F G H J K L ; \' {enter}',
          '{shift} Z X C V B N M , . / {shift}',
          '{space}'
        ],
        shiftCaps: [
          '~ ! @ # $ % ^ & * ( ) _ + {bksp}',
          '{tab} q w e r t y u i o p { } |',
          '{lock} a s d f g h j k l : " {enter}',
          '{shift} z x c v b n m < > ? {shift}',
          '{space}'
        ]
      },
      onChange: input => console.log(input),
      onKeyPress: button => {
        console.log(button);

        if (button === '{lock}' || button === '{shift}') {
          let layoutName = 'default';

          this.capsOn = (+this.capsOn ^ +(button === '{lock}')) === 1;
          this.shiftOn = (+this.shiftOn ^ +(button === '{shift}')) === 1;
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
      }
    });

    this.keyboard.addButtonTheme('{lock}', 'caps-lock');
    this.keyboard.addButtonTheme('{space}', 'space-key');
    this.keyboardElem = $('.keyboard')[0];

    const document = window.document;
    const dragArea = $('.keyboard-title, .hg-row');
    let keyboardStart: Point;
    let dragStart: Point;
    let dragging = false;

    document.addEventListener('mousedown', event => {
      dragStart = { x: event.clientX, y: event.clientY };
      keyboardStart = this.keyboardElem && { x: this.keyboardElem.offsetLeft, y: this.keyboardElem.offsetTop };
    }, { capture: true, passive: true });

    dragArea.on('mousedown', () => dragging = true);
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

  private keepKeyboardOnScreen(x: number, y: number): void {
    const keyboardWidth = this.keyboardElem.offsetWidth;
    const docWidth = document.body.offsetWidth;
    const docHeight = document.body.offsetHeight;

    this.keyboardElem.style.left = Math.min(Math.max(x, 100 - keyboardWidth), docWidth - KEEP_ONSCREEN_WIDTH) + 'px';
    this.keyboardElem.style.top = Math.min(Math.max(y, 0), docHeight - KEEP_ONSCREEN_HEIGHT) + 'px';
  }
}
