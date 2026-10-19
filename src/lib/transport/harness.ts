import type { Transport } from './index';
import type { Asset } from '../../generated/contracts';
export function harnessTransport(): Transport {
  const token = import.meta.env.VITE_HARNESS_TOKEN;
  if (!token) throw new Error('Missing development harness token');
  return {
    mode: 'dev-harness',
    async call(command, args) {
      const response = await fetch('/bridge/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-riftmind-token': token },
        body: JSON.stringify({ command, args }),
      });
      if (!response.ok) throw new Error(`Bridge HTTP ${response.status}`);
      const body = await response.json();
      if (body.error) throw body.error;
      if (command === 'resolve_assets') {
        return body.ok.map((asset: Asset) => ({
          ...asset,
          reference:
            asset.reference?.replace('http://cdragon.localhost/', '/bridge/resources/') ?? null,
        }));
      }
      return body.ok;
    },
    async subscribe(listener) {
      const ws = new WebSocket(
        `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/bridge/events?token=${encodeURIComponent(token)}`,
      );
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error('Bridge unavailable'));
      });
      ws.onmessage = (e) => listener(JSON.parse(e.data));
      return () => ws.close();
    },
  };
}
