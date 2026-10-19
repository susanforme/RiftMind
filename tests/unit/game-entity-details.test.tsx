import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GameEntityDetails } from '../../src/components/GameEntityDetails';
import { GameEntityDescription } from '../../src/components/GameEntityDescription';
import { ScoreboardItems } from '../../src/features/matches/ScoreboardLoadout';
import { setTransport } from '../../src/app/runtime';
import { fixtureTransport } from '../../src/lib/transport/fixture';
import type { Asset } from '../../src/generated/contracts';
import i18n from '../../src/i18n';

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

async function renderDetails(kind: 'item' | 'spell' | 'rune', override: Partial<Asset> = {}) {
  await i18n.changeLanguage('en-US');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const asset: Asset = {
    resourceId: `${kind}:4`,
    requestedVersion: '16.20.1',
    actualVersion: '16.20',
    locale: 'en-US',
    name: 'Entity name',
    description:
      '<stats><attention>130</attention> Ability Power</stats><br><b>Effect</b><br>Bonus damage.',
    price: null,
    cooldown: null,
    reference: null,
    hash: null,
    availability: 'missing',
    ...override,
  };
  client.setQueryData(['game-entity-art', '16.20.1', 'en-US', kind, 4], [asset]);
  render(
    <QueryClientProvider client={client}>
      <GameEntityDetails kind={kind} id={4} version="16.20.1" label="Fallback name" />
    </QueryClientProvider>,
  );
  return screen.getByRole('button', { name: asset.name || 'Fallback name' });
}

it.each(['item', 'spell', 'rune'] as const)(
  'shows %s details on hover and allows moving into the card',
  async (kind) => {
    const trigger = await renderDetails(kind, {
      price: kind === 'item' ? 3600 : null,
      cooldown: kind === 'spell' ? 300 : null,
    });
    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
    const panel = await screen.findByRole('dialog', { name: 'Entity name' });
    expect(within(panel).getByText('130')).toBeVisible();
    expect(within(panel).getByText('Effect')).toBeVisible();
    if (kind === 'item') expect(within(panel).getByText('3600')).toBeVisible();
    if (kind === 'spell') expect(within(panel).getByText('300s')).toBeVisible();
    fireEvent.pointerLeave(trigger, { pointerType: 'mouse' });
    fireEvent.pointerEnter(panel, { pointerType: 'mouse' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(panel).toBeVisible();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  },
);

it('supports keyboard focus, Tab dismissal and touch click pinning', async () => {
  const trigger = await renderDetails('spell');
  fireEvent.focus(trigger);
  expect(await screen.findByRole('dialog')).toBeVisible();
  fireEvent.keyDown(trigger, { key: 'Tab' });
  await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
  fireEvent.pointerDown(trigger, { pointerType: 'touch' });
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  fireEvent.blur(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

it('keeps the name available when this patch has no description', async () => {
  const trigger = await renderDetails('rune', { description: null });
  fireEvent.click(trigger);
  const panel = await screen.findByRole('dialog', { name: 'Entity name' });
  expect(within(panel).getByText('Details are unavailable for this version')).toBeVisible();
});

it('renders game markup without executing HTML or copying upstream attributes', () => {
  const { container } = render(
    <GameEntityDescription
      description={
        '<mainText><stats>25 Move Speed</stats><br><attention onclick="alert(1)">Effect</attention><img src="unsafe" onerror="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)">Description</a></mainText>'
      }
    />,
  );
  expect(container).toHaveTextContent('25 Move Speed');
  expect(screen.getByText('Effect').tagName).toBe('STRONG');
  expect(container).toHaveTextContent('Description');
  expect(container.querySelector('img, script, a, [onclick], [onerror]')).toBeNull();
});

it('does not make empty slots interactive and shares artwork and detail requests', async () => {
  await i18n.changeLanguage('en-US');
  const backend = fixtureTransport();
  const call = vi.spyOn(backend, 'call');
  setTransport(backend);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <ScoreboardItems items={[3089]} roleItem={3089} version="16.20.1" />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(call).toHaveBeenCalledTimes(1));
  expect(screen.getAllByRole('button')).toHaveLength(2);
  fireEvent.click(screen.getAllByRole('button')[0]);
  expect(await screen.findByRole('dialog')).toBeVisible();
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith('resolve_assets', {
    version: '16.20.1',
    locale: 'en-US',
    championIds: [],
    resourceIds: [{ kind: 'item', id: 3089 }],
  });
});
