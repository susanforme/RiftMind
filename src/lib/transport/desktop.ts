import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { EventEnvelope } from '../../generated/contracts';
import type { Transport } from './index';
export const desktopTransport: Transport = {
  mode: 'desktop',
  call(command, args) {
    return invoke('dispatch', { request: { command, args } });
  },
  async subscribe(listener) {
    return listen<EventEnvelope>('riftmind-event', (e) => listener(e.payload));
  },
};
