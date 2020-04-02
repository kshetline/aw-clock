/* eslint @typescript-eslint/indent: 0 */
/* eslint no-multi-spaces: 0 */
import fs from 'fs';

// Pin conversion tables below taken from Gordon Henderson's WiringPi

// Revision 1, 1.1:

const wpiToGpioR1 = [
  17, 18, 21, 22, 23, 24, 25, 4,  // From the Original Wiki - GPIO 0 through 7: wpi 0 - 7
   0,  1,       // I2C  - SDA1, SCL1        wpi  8 -  9
   8,  7,       // SPI  - CE1, CE0          wpi 10 - 11
  10,  9, 11,   // SPI  - MOSI, MISO, SCLK  wpi 12 - 14
  14, 15,       // UART - Tx, Rx            wpi 15 - 16

// Padding:

      -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, // ... 31
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, // ... 47
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, // ... 63
];

// Revision 2:

const wpiToGpioR2 = [
  17, 18, 27, 22, 23, 24, 25, 4,  // From the Original Wiki - GPIO 0 through 7: wpi  0 - 7
   2,  3,       // I2C  - SDA0, SCL0                    wpi  8 - 9
   8,  7,       // SPI  - CE1, CE0                      wpi 10 - 11
  10,  9, 11,   // SPI  - MOSI, MISO, SCLK              wpi 12 - 14
  14, 15,       // UART - Tx, Rx                        wpi 15 - 16
  28, 29, 30, 31,     // Rev 2: New GPIOs 8 though 11   wpi 17 - 20
   5,  6, 13, 19, 26, // B+                             wpi 21, 22, 23, 24, 25
  12, 16, 20, 21,     // B+                             wpi 26, 27, 28, 29
   0,  1,             // B+                             wpi 30, 31

// Padding:

  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, // ... 47
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, // ... 63
];

let wpiToGpio = wpiToGpioR2;

// physToGpio:
//  Take a physical pin (1 through 26/40) and re-map it to the BCM_GPIO pin
//  Cope for 2 different board revisions here.
//  For P5 connector, P5 pin numbers are offset by 50, i.e. 3, 4, 5, 6 => 53, 54, 55, 56

const physToGpioR1 = [
  -1,     // 0
  -1, -1, // 1, 2
   0, -1,
   1, -1,
   4, 14,
  -1, 15,
  17, 18,
  21, -1,
  22, 23,
  -1, 24,
  10, -1,
   9, 25,
  11,  8,
  -1,  7, // 25, 26

                                              -1, -1, -1, -1, -1, // ... 31
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, // ... 47
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, // ... 63
];

const physToGpioR2 = [
  -1,     // 0
  -1, -1, // 1, 2
   2, -1,
   3, -1,
   4, 14,
  -1, 15,
  17, 18,
  27, -1,
  22, 23,
  -1, 24,
  10, -1,
   9, 25,
  11,  8,
  -1,  7, // 25, 26

// B+:

   0,  1, // 27, 18
   5, -1,
   6, 12,
  13, -1,
  19, 16,
  26, 20,
  -1, 21, // 39, 40

// Filler:

  -1, -1,
  -1, -1,
  -1, -1,
  -1, -1,
  -1, -1,

  // P5 connector on Rev 2 boards:

   // Note: The original code had GPIO 28 and 29 here, 30 and 31 on the next line,
   // mapping positions 51-54 to P5 3-6. I believe this was an error, and moved
   // the GPIO numbers forward by two positions accordingly.
    -1, -1,
    28, 29, // 53, 54 (P5-3, P5-4)
    30, 31, // 55, 56 (P5-5, P5-6)
    -1, -1,

    // Filler:

      -1, -1,
      -1, -1,
      -1
];

let physToGpio = physToGpioR2;

enum GpioLayout {
    UNCHECKED,
    LAYOUT_1, // A, B, Rev 1, 1.1
    LAYOUT_2, // A2, B2, A+, B+, CM, Pi2, Pi3, Pi4, Zero
    UNKNOWN
};

export enum PinSystem { GPIO, PHYS, WIRING_PI, VIRTUAL = 2 };

let gpioLayout = GpioLayout.UNCHECKED;
let supportPhysPins = false;

function getLayout(): void {
  if (gpioLayout === GpioLayout.UNCHECKED) {
    gpioLayout = GpioLayout.UNKNOWN;

    let lines: string[];

    try {
      lines = fs.readFileSync('/proc/cpuinfo',  { encoding: 'ascii' }).split(/\r\n|\r|\n/);
    }
    catch {
      console.error("Can't read /proc/cpuinfo");
    }

    for (const line of lines) {
      const $ = /^Revision\s*:\s*\w*(\w{4})$/.exec(line);

      if ($) {
        if ($[1] === '0002' || $[1] === '0003') {
          gpioLayout = GpioLayout.LAYOUT_1;
          wpiToGpio = wpiToGpioR1;
          physToGpio = physToGpioR1;
        }
        else
          gpioLayout = GpioLayout.LAYOUT_2;

        supportPhysPins = true;
        break;
      }
    }
  }
}

let convertInit = false;
const gpioToPhys = new Array(32).fill(-1);
const gpioToWPi = new Array(32).fill(-1);

function getConversions(): void {
  getLayout();

  if (convertInit || gpioLayout === GpioLayout.UNKNOWN)
    return;

  for (let i = 0; i < 64; ++i) {
    let gpio = wpiToGpio[i];

    if (gpio >= 0)
      gpioToWPi[gpio] = i;

    gpio = physToGpio[i];

    if (gpio >= 0)
      gpioToPhys[gpio] = i;
  }

  convertInit = true;
}

function convertPinImpl(pinNumber: number, pinSysFrom: PinSystem, pinSysTo: PinSystem) {
  getConversions();

  if (!supportPhysPins && (pinSysFrom === PinSystem.PHYS || pinSysTo === PinSystem.PHYS))
    throw new Error('Unknown hardware - physical pin numbering not supported');
  else if (pinNumber < 0 || pinNumber > 63 || (pinSysFrom !== PinSystem.PHYS && pinNumber > 31))
    return -1;

  let gpio: number;

  switch (pinSysFrom) {
    case PinSystem.GPIO:
      switch (pinSysTo) {
        case PinSystem.GPIO: return pinNumber;
        case PinSystem.PHYS: return gpioToPhys[pinNumber];
        case PinSystem.WIRING_PI: return gpioToWPi[pinNumber];
      }
      break;

    case PinSystem.PHYS:
      switch (pinSysTo) {
        case PinSystem.GPIO: return physToGpio[pinNumber];
        case PinSystem.PHYS: return pinNumber;
        case PinSystem.WIRING_PI: return (gpio = physToGpio[pinNumber]) >= 0 ? gpioToWPi[gpio] : -1;
      }
      break;

    case PinSystem.WIRING_PI:
      switch (pinSysTo) {
        case PinSystem.GPIO: return wpiToGpio[pinNumber];
        case PinSystem.PHYS: return (gpio = wpiToGpio[pinNumber]) >= 0 ? gpioToPhys[gpio] : -1;
        case PinSystem.WIRING_PI: return pinNumber;
      }
  }
}
export function convertPin(pin: number, pinSystemFrom: PinSystem, pinSystemTo: PinSystem): number;
export function convertPin(gpioPin: number, pinSystemTo: PinSystem): number;
export function convertPin(pin: string, pinSystemTo: PinSystem): number;
export function convertPin(pin: number | string, pinSystem0: PinSystem, pinSystem1?: PinSystem): number {
  let pinNumber: number;
  let pinSystemFrom: number;
  let pinSystemTo: number;

  if (typeof pin === 'string') {
    pinNumber = parseFloat(pin);
    pinNumber = (isNaN(pinNumber) ? 27 : pinNumber);
    const pinSystemIndex = 'pwv'.indexOf(pin.substr(-1).toLowerCase()) + 1;
    pinSystemFrom = [PinSystem.GPIO, PinSystem.PHYS, PinSystem.WIRING_PI, PinSystem.VIRTUAL][pinSystemIndex];
    pinSystemTo = pinSystem0;
  }
  else {
    pinNumber = pin;

    if (pinSystem1 == null) {
      pinSystemFrom = PinSystem.GPIO;
      pinSystemTo = pinSystem0;
    }
    else {
      pinSystemFrom = pinSystem0;
      pinSystemTo = pinSystem1;
    }
  }

  return convertPinImpl(pinNumber, pinSystemFrom, pinSystemTo);
}

export function convertPinToGpio(pinNumber: number, pinSys: PinSystem) {
  return convertPin(pinNumber, pinSys, PinSystem.GPIO);
}
