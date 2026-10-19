import type { Transport } from './index';
export function harnessTransport(): Transport {
  const token = import.meta.env.VITE_HARNESS_TOKEN;
  return {
    mode: 'dev-harness',
    async call(command, args) {
      const response = await fetch('/bridge/command', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-riftmind-token': token }, body: JSON.stringify({ command, args }) });
      if (!response.ok) throw new Error(`Bridge HTTP ${response.status}`);
      const body = await response.json();
      if (body.error) throw body.error;
      return body.ok;
    },
    async subscribe(listener) {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/bridge/events?token=${encodeURIComponent(token)}`);
      await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error('Bridge unavailable')); });
      ws.onmessage = e => listener(JSON.parse(e.data));
      return () => ws.close();
    },
  };
}
