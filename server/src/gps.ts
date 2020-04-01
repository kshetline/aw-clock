import SerialPort from 'serialport';

export class Gps {
  private readonly parser: SerialPort.parsers.Readline;
  private serialCallback = (data: any) => this.parseGpsInfo(data.toString());
  private readonly serialPort: SerialPort;

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
  }

  public close(): void {
    this.parser.off('data', this.serialCallback);
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

    const date = new Date(Date.UTC(y, m - 1, d, hrs, min, sec));

    console.log(date.toISOString(), new Date().toISOString);
  }
}
