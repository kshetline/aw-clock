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
    if (/^\$GPGGA\b/.test(s)) {
      console.log(s.trim());
    }
  }
}
