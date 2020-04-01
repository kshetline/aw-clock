import { processMillis, toNumber } from 'ks-util';
import SerialPort from 'serialport';
import { floor } from 'ks-math';

const rpiGpio = require('rpi-gpio');

function parseError(msg?: string): string[] {
  throw new Error('Parsing error' + msg ? ': ' + msg : '');
}

export interface Coordinates {
  latitude: number;
  longitude: number;
  altitude: number;
}

export class Gps {
  private readonly parser: SerialPort.parsers.Readline;
  private readonly ppsCallback = () => this.gotPps();
  private readonly serialCallback = (data: any) => this.parseGpsInfo(data.toString());
  private readonly serialPort: SerialPort;

  private lastCoordinates: Coordinates;
  private lastDate: Date;
  private lastLeapExcess = 0;
  private lastDateRead = 0;
  private lastLocationRead = 0;

  constructor() {
    this.serialPort = new SerialPort('/dev/serial0', {
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1
    });

    this.parser = this.serialPort.pipe(
      new SerialPort.parsers.Readline({
        delimiter: '\r\n',
        includeDelimiter: false
      })
    );
    this.parser.on('data', this.serialCallback);

    rpiGpio.setup(7, rpiGpio.DIR_IN, rpiGpio.EDGE_RISING);
    rpiGpio.on('change', this.ppsCallback);
  }

  public close(): void {
    this.parser.off('data', this.serialCallback);
    rpiGpio.off('change', this.ppsCallback);
    this.serialPort.close();
  }

  private parseGpsInfo(s: string): void {
    // Both of these messages convey time and location, but GPRMC has more
    // precise and detailed time info, whereas GPGGA provides altitude along
    // with longitude and latitude, which GPRMC doesn't.
    if (/^\$GPRMC,/.test(s))
      this.parseGpsTime(s);
    else if (/^\$GPGGA,/.test(s))
      this.parseGpsLocation(s);
  }

  private parseGpsTime(s: string): void {
    const parts = s.split(',');

    try {
      if (parts.length < 13 || parts[2] !== 'A')
        parseError('acquisition');

      let $ = /(\d\d)(\d\d)(\d\d\.\d\d\d)/.exec(parts[1]) ?? parseError('time');

      const hrs = Number($[1]);
      const min = Number($[2]);
      let sec = Number($[3]);

      $ = /(\d\d)(\d\d)(\d\d)/.exec(parts[9]) ?? parseError('date');

      const d = Number($[1]);
      const m = Number($[2]);
      const yy = Number($[3]);
      const y = yy + (yy < 20 ? 2100 : 2000);

      // I'd prefer to know that a leap secomd is about to happen, rather than learning after
      // it has just happened, but that seems to be how the timing of the data works out.
      if (sec < 60)
        this.lastLeapExcess = 0;
      else {
        this.lastLeapExcess = sec - 59.999;
        sec = 59.999;
      }

      const millis = Math.min(Math.round((sec - floor(sec)) * 1000), 999);

      this.lastDate = new Date(Date.UTC(y, m - 1, d, hrs, min, floor(sec), millis) + 1000);
      this.lastDateRead = processMillis();
    }
    catch (err) {
      console.error(err.toString());
    }
  }

  private parseGpsLocation(s: string): void {
    const parts = s.split(',');

    try {
      if (parts.length < 15 || toNumber(parts[6]) === 0)
        parseError('fix');

      let $ = /(\d\d)(\d\d\.\d\d\d\d)/.exec(parts[2]) ?? parseError('latitude');
    
      const latitude = (Number($[1]) + Number($[2]) / 60) * (parts[3] === 'S' ? -1 : 1);

      $ = /(\d\d\d)(\d\d\.\d\d\d\d)/.exec(parts[4]) ?? parseError('longitude');
    
      const longitude = (Number($[1]) + Number($[2]) / 60) * (parts[5] === 'W' ? -1 : 1);

      $ = /(-?\d+(?:\.\d*))/.exec(parts[9]) ?? parseError('altitude');

      const altitude = toNumber($[1]) * (parts[10] === 'M' ? 1 : 0);

      this.lastCoordinates = { latitude, longitude, altitude };
      this.lastLocationRead = processMillis();
    }
    catch (err) {
      console.log(err.toString());
    } 
  }

  private gotPps(): void {
    const procNow = processMillis();

    if (procNow > this.lastDateRead + 1000)
      console.warn('missed time data');
    else
      console.log(this.lastDate.toISOString(),
       '*'.repeat(this.lastLeapExcess === 0 ? 1 : 4),
        this.lastDate.getTime() - Date.now(), '*',
        Math.round(procNow - this.lastDateRead),
        Math.round(procNow - this.lastLocationRead),
        this.lastCoordinates?.latitude?.toFixed(4),
        this.lastCoordinates?.longitude?.toFixed(4),
        this.lastCoordinates?.altitude?.toFixed(0));
  }
}
