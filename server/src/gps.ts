import { processMillis } from 'ks-util';
import SerialPort from 'serialport';

const rpiGpio = require('rpi-gpio');

export class Gps {
  private readonly parser: SerialPort.parsers.Readline;
  private readonly ppsCallback = () => this.gotPps();
  private readonly serialCallback = (data: any) => this.parseGpsInfo(data.toString());
  private readonly serialPort: SerialPort;

  private lastDate: Date;
  private lastRead = 0;

  constructor() {
    this.serialPort = new SerialPort('/dev/serial0', {
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1
    });

    this.parser = this.serialPort.pipe(
      new SerialPort.parsers.Readline({
        delimiter: '\n',
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
    if (!(/^\$GPRMC\b/.test(s)))
      return;

    const parts = s.split(',');

    if (parts.length < 10 || parts[2] !== 'A')
      return;

    let $ = /(\d\d)(\d\d)(\d\d\.\d\d\d)/.exec(parts[1]);

    if (!$)
      return;

    const hrs = Number($[1]);
    const min = Number($[2]);
    const sec = Number($[3]);

    $ = /(\d\d)(\d\d)(\d\d)/.exec(parts[9]);

    if (!$)
      return;

    const d = Number($[1]);
    const m = Number($[2]);
    const y = Number($[3]) + 2000;

    this.lastDate = new Date(Date.UTC(y, m - 1, d, hrs, min, sec) + 1000);
    this.lastRead = processMillis();
  }

  private gotPps(): void {
    const procNow = processMillis();

    if (procNow > this.lastRead + 1000)
      console.warn('missed data');
    else
      console.log(this.lastDate.toISOString(), '*',
        this.lastDate.getTime() - Date.now(), '*', procNow - this.lastRead);
  }
}
