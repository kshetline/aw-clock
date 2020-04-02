declare module 'rpi-gpio' {
  export const DIR_IN: 'in';
  export const EDGE_RISING: 'rising';

  export function off(eventType: 'change', callback: (channel: number, value: boolean) => void): void;
  export function on(eventType: 'change', callback: (channel: number, value: boolean) => void): void;

  export function setup(physPin: number, direction: 'in', edge: 'rising'): void;
}
