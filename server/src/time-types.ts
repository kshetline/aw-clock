export interface CurrentDelta {
  delta: number;
  dut1: number[] | null;
  pendingLeap: number;
  pendingLeapDate: string;
}

export interface TimeInfo {
  time: number;
  leapSecond: number;
  leapExcess: number;
  text: string;
}
