import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RuntimeEffects } from '../../src/app/providers';
import { queryClient } from '../../src/app/query-client';
import { setTransport } from '../../src/app/runtime';
import { fixtureTransport, resetFixture } from '../../src/lib/transport/fixture';
import type { EventEnvelope } from '../../src/generated/contracts';

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('resolves missing entity art and skin catalogues again after the resource cache changes', async () => {
  resetFixture();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  let receive: ((event: EventEnvelope) => void) | undefined;
  setTransport({
    ...fixtureTransport(),
    subscribe: async (listener) => {
      receive = listener;
      return () => {};
    },
  });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <RuntimeEffects />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(invalidate).toHaveBeenCalled());
  invalidate.mockClear();
  receive!({
    eventVersion: 1,
    runtimeId: 'resource-test-runtime',
    workspaceEpoch: 'resource-test-workspace',
    sequence: 1,
    revision: 0,
    kind: 'assets-ready',
    objectKey: null,
  });
  for (const key of [
    'player-profile-icon',
    'champion-splash',
    'champion-skins',
    'game-entity-art',
  ]) {
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
  }
});
