import { afterEach, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '../../src/i18n';
import { serverName } from '../../src/lib/server-name';
import servers from '../../crates/riftmind-core/src/domain/servers.json';
import { fixtureTransport, resetFixture, setScenario } from '../../src/lib/transport/fixture';
import { setTransport } from '../../src/app/runtime';
import { SettingsPage } from '../../src/features/settings/SettingsPage';
import { useWorkspace } from '../../src/stores/workspace-tabs';

afterEach(() => {
  cleanup();
  void i18n.changeLanguage('en-US');
});

it('uses Akari Chinese names for Tencent, merged and overseas servers', () => {
  const t = i18n.getFixedT('zh-CN');
  for (const [id, name] of Object.entries({
    TENCENT_HN1: '艾欧尼亚',
    TENCENT_HN10: '黑色玫瑰',
    TENCENT_NJ100: '联盟一区',
    TENCENT_TJ101: '联盟五区',
    TENCENT_BGP2: '峡谷之巅',
    TENCENT_PBE: '体验服',
    NA1: '北美',
    EUW: '欧洲西',
  })) {
    expect(serverName(t, id)).toBe(name);
  }
});

it('covers every configured server in both languages and preserves unknown IDs', () => {
  for (const language of ['zh-CN', 'en-US']) {
    const t = i18n.getFixedT(language);
    for (const { id } of servers)
      expect(i18n.exists(id, { lng: language, ns: 'servers', fallbackLng: false })).toBe(true);
    expect(serverName(t, 'TENCENT_FUTURE')).toBe('TENCENT_FUTURE');
    expect(serverName(t, undefined)).toBe('—');
    expect(serverName(t, null)).toBe('—');
    expect(serverName(t, '')).toBe('—');
  }
});

it('updates the displayed server with the UI language while keeping connection identity', async () => {
  resetFixture();
  setScenario('tencent');
  setTransport(fixtureTransport());
  useWorkspace.setState({ draft: null, dirty: false });
  await i18n.changeLanguage('zh-CN');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <SettingsPage />
    </QueryClientProvider>,
  );
  expect(await screen.findByText('艾欧尼亚')).toBeVisible();
  expect(screen.getByText(/国服 · 正式服/)).toBeVisible();
  expect(screen.queryByText(/tencent · live/)).toBeNull();
  expect(screen.queryByText('TENCENT_HN1')).toBeNull();
  await act(async () => {
    await i18n.changeLanguage('en-US');
  });
  expect(await screen.findByText('Ionia')).toBeVisible();
  expect((await fixtureTransport().call('get_connection_state', {})).identification?.serverId).toBe(
    'TENCENT_HN1',
  );
  view.unmount();
  client.clear();
});
