import type { Transport } from '../lib/transport';
export let transport: Transport;
export function setTransport(value: Transport) {
  transport = value;
}
