import type { CommandMap, EventEnvelope } from '../../generated/contracts';
export type CommandName = keyof CommandMap;
export interface Transport {
  mode: 'desktop' | 'fixture' | 'dev-harness';
  call<K extends CommandName>(
    command: K,
    args: CommandMap[K]['input'],
  ): Promise<CommandMap[K]['output']>;
  subscribe(listener: (event: EventEnvelope) => void): Promise<() => void>;
}
export async function createTransport(): Promise<Transport> {
  if (
    import.meta.env.DEV &&
    import.meta.env.MODE === 'development' &&
    import.meta.env.VITE_TRANSPORT === 'fixture'
  ) {
    return (await import('./fixture')).fixtureTransport();
  }
  if (
    import.meta.env.DEV &&
    import.meta.env.MODE === 'development' &&
    import.meta.env.VITE_TRANSPORT === 'dev-harness'
  ) {
    return (await import('./harness')).harnessTransport();
  }
  return (await import('./desktop')).desktopTransport;
}
