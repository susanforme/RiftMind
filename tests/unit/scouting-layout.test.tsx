import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AnalysisFilters } from '../../src/features/analysis/AnalysisFilters';
import ChampionGamesChart from '../../src/features/champions/ChampionGamesChart';
import PersonalDistributionChart from '../../src/features/analysis/PersonalDistributionChart';
import i18n from '../../src/i18n';

const chart = vi.hoisted(() => ({
  setOption: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
}));
const initializeChart = vi.hoisted(() => vi.fn(() => chart));
vi.mock('echarts/core', () => ({ init: initializeChart, use: vi.fn() }));

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('en-US');
  document.documentElement.dataset.theme = 'default';
  document.documentElement.dataset.mode = 'dark';
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.mode;
});

it('keeps the analysis fields, applies draft dates and patch, and resets them together', () => {
  const change = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AnalysisFilters
        search={{ queue: 420, champion: 103, position: 'MIDDLE' }}
        onChange={change}
      />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText('Patch'), { target: { value: '16.20' } });
  fireEvent.change(screen.getByLabelText(i18n.t('matches.from')), {
    target: { value: '2026-10-01' },
  });
  fireEvent.change(screen.getByLabelText(i18n.t('matches.to')), {
    target: { value: '2026-10-19' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  expect(change).toHaveBeenLastCalledWith({
    queue: 420,
    champion: 103,
    position: 'MIDDLE',
    patch: '16.20',
    from: '2026-10-01',
    to: '2026-10-19',
  });
  fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
  expect(change).toHaveBeenLastCalledWith({});
  expect(screen.getByLabelText('Patch')).toHaveValue('');
  expect(screen.getByLabelText(i18n.t('matches.from'))).toHaveValue('');
  expect(screen.getByLabelText(i18n.t('matches.to'))).toHaveValue('');
  client.clear();
});

it.each(['pool', 'distribution'])(
  'updates the %s chart for theme and mode changes without recreating it',
  async (kind) => {
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      () =>
        ({
          getPropertyValue: (name: string) =>
            `${document.documentElement.dataset.theme}:${document.documentElement.dataset.mode}:${name}`,
        }) as CSSStyleDeclaration,
    );
    const view = render(
      kind === 'pool' ? (
        <ChampionGamesChart rows={[]} />
      ) : (
        <PersonalDistributionChart
          metric={{
            id: 'cs_per_min',
            version: '1',
            unit: 'count',
            current: 7,
            count: 10,
            median: 6,
            lowerQuartile: 5,
            upperQuartile: 8,
            delta: 1,
            samples: [],
          }}
        />
      ),
    );
    expect(initializeChart).toHaveBeenCalledTimes(1);
    expect(chart.setOption).toHaveBeenCalledTimes(1);
    document.documentElement.dataset.theme = 'alternate';
    await waitFor(() => expect(chart.setOption).toHaveBeenCalledTimes(2));
    document.documentElement.dataset.mode = 'light';
    await waitFor(() => expect(chart.setOption).toHaveBeenCalledTimes(3));
    const options = chart.setOption.mock.lastCall?.[0];
    expect(options.tooltip.backgroundColor).toBe('alternate:light:--popover');
    expect(options.xAxis.axisLine.lineStyle.color).toBe('alternate:light:--chart-axis');
    expect(options.yAxis.splitLine.lineStyle.color).toBe('alternate:light:--chart-grid');
    expect(kind === 'pool' ? options.color[0] : options.series[1].itemStyle.color).toBe(
      'alternate:light:--chart-self',
    );
    expect(initializeChart).toHaveBeenCalledTimes(1);
    expect(chart.setOption.mock.lastCall).toHaveLength(1);
    view.unmount();
    expect(chart.dispose).toHaveBeenCalledTimes(1);
  },
);
