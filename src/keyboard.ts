import * as $ from 'jquery';
import SimpleKeyboard from 'simple-keyboard';

interface Point {
  x: number;
  y: number;
}

export class Keyboard {
  private capsOn = false;
  private keyboard: SimpleKeyboard;
  private shiftOn = false;

  constructor() {
    this.keyboard = new SimpleKeyboard({
      display: {
        '{bksp}': 'delete',
        '{enter}': '↵',
        '{lock}': 'caps lock',
        '{shift}': 'shift',
        '{space}': ' ',
        '{tab}': '⇥'
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

          if (this.capsOn)
            this.keyboard.addButtonTheme('{lock}', 'key-locked');
          else
            this.keyboard.removeButtonTheme('{lock}', 'key-locked');

          if (this.shiftOn)
            this.keyboard.addButtonTheme('{shift}', 'key-locked');
          else
            this.keyboard.removeButtonTheme('{shift}', 'key-locked');

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

    this.keyboard.addButtonTheme('{space}', 'space-key');

    const document = window.document;
    const keyboardElem = $('.keyboard');
    const dragArea = $('.keyboard-title, .hg-row');
    let keyboardStart: Point;
    let dragStart: Point;
    let dragging = false;

    document.addEventListener('mousedown', event => {
      dragStart = { x: event.clientX, y: event.clientY };
      keyboardStart = keyboardElem[0] && { x: keyboardElem[0].offsetLeft, y: keyboardElem[0].offsetTop };
    }, { capture: true, passive: true });

    dragArea.on('mousedown', () => dragging = true);
    document.addEventListener('mouseup', () => dragging = false);

    document.addEventListener('mousemove', event => {
      if (!dragging || !dragStart || !keyboardStart)
        return;

      const newPoint = { x: event.clientX, y: event.clientY };
      const dx = newPoint.x - dragStart.x;
      const dy = newPoint.y - dragStart.y;

      keyboardElem[0].style.left = (keyboardStart.x + dx) + 'px';
      keyboardElem[0].style.top = (keyboardStart.y + dy) + 'px';
    });
  }
}
