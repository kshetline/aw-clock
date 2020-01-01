export interface NtpData {
  li: number; // 2 bits from 0th byte
  vn: number; // 3 bits from 0th byte
  mode: number; // 3 bits from 0th byte
  stratum: number; // 1 byte
  poll: number; // 1 byte
  precision: number; // 1 byte
  rootDelay: number; // 4 bytes
  rootDispersion: number; // 4 bytes
  refId: string; // 4 bytes
  refTm_s: number; // 4 bytes
  refTm_f: number; // 4 bytes
  refTm?: number; // (FP of previous two fields)
  origTm_s: number; // 4 bytes
  origTm_f: number; // 4 bytes
  origTm?: number; // (FP of previous two fields)
  rxTm_s: number; // 4 bytes
  rxTm_f: number; // 4 bytes
  rxTm?: number; // (FP of previous two fields)
  txTm_s: number; // 4 bytes
  txTm_f: number; // 4 bytes
  txTm?: number; // (FP of previous two fields)

  address?: string; // from socket
  roundTripTime?: number; // derived
  sendDelay?: number; // derived
}
