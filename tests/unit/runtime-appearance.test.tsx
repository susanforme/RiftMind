import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RuntimeEffects } from '../../src/app/providers';
import { applyTheme } from '../../src/app/theme';
import { setTransport } from '../../src/app/runtime';
import { fixtureTransport } from '../../src/lib/transport/fixture';
import type { Settings } from '../../src/generated/contracts';
import i18n from '../../src/i18n';

vi.mock('../../src/app/router', () => ({ router: {} }));
vi.mock('../../src/app/theme', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/app/theme')>()),
  applyTheme: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(applyTheme).mockClear();
});

it('does not reset language or theme when saving workspace state, while still applying appearance edits', async () => {
  await i18n.changeLanguage('en-US');
  const changeLanguage = vi.spyOn(i18n, 'changeLanguage');
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const transport = fixtureTransport();
  transport.subscribe = async () => () => {};
  setTransport(transport);
  const settings: Settings = {
    ...(await transport.call('get_settings', {})),
    languagePreference: 'en-US',
    colorModePreference: 'dark',
  };
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(['settings'], settings);
  render(
    <QueryClientProvider client={client}>
      <RuntimeEffects />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(applyTheme).toHaveBeenCalledOnce());
  const update = async (patch: Partial<Settings>) => {
    await act(async () => {
      client.setQueryData<Settings>(['settings'], (current) => ({ ...current!, ...patch }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  await update({ revision: settings.revision + 1, sidebarCollapsed: !settings.sidebarCollapsed });
  expect(changeLanguage).not.toHaveBeenCalled();
  expect(applyTheme).toHaveBeenCalledOnce();
  await update({ languagePreference: 'zh-CN' });
  await waitFor(() => expect(changeLanguage).toHaveBeenCalledWith('zh-CN'));
  expect(applyTheme).toHaveBeenCalledOnce();
  await update({ colorModePreference: 'light' });
  await waitFor(() => expect(applyTheme).toHaveBeenLastCalledWith('default', 'light'));
  expect(changeLanguage).toHaveBeenCalledOnce();
  client.clear();
});
