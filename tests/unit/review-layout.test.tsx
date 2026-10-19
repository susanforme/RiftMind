import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { TrainingGoal } from '../../src/generated/contracts';
import ReviewChart from '../../src/features/review/ReviewChart';
import GoalTrendChart from '../../src/features/progress/GoalTrendChart';

const chart = vi.hoisted(() => ({
  setOption: vi.fn(),
  on: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
}));
const initialize = vi.hoisted(() => vi.fn());
vi.mock('echarts/core', () => ({
  init: initialize,
  use: vi.fn(),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  initialize.mockReturnValue(chart);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-mode');
});

it('redraws review charts for theme and mode changes while retaining the chart session', async () => {
  render(<ReviewChart data={{ points: [], limitations: [] }} metric="gold" onSelect={() => {}} />);
  const chartElement = screen.getByRole('img', { name: 'review.goldChart' });
  chartElement.style.setProperty('--chart-self', 'self-series');
  chartElement.style.setProperty('--chart-opponent', 'opponent-series');
  document.documentElement.setAttribute('data-theme', 'another-theme');
  await waitFor(() => expect(chart.setOption).toHaveBeenCalledTimes(2));
  expect(chart.setOption).toHaveBeenLastCalledWith(
    expect.objectContaining({ color: ['self-series', 'opponent-series'] }),
  );
  document.documentElement.setAttribute('data-mode', 'dark');
  await waitFor(() => expect(chart.setOption).toHaveBeenCalledTimes(3));
  expect(initialize).toHaveBeenCalledTimes(1);
  expect(chart.dispose).not.toHaveBeenCalled();
  expect(chart.setOption.mock.calls.every((arguments_) => arguments_.length === 1)).toBe(true);
});

it('redraws training trends without replacing legend selection or displaying internal match keys', async () => {
  const goal: TrainingGoal = {
    id: 'goal',
    version: 1,
    revision: 1,
    scope: {
      playerKey: 'NA1:player',
      championId: 103,
      queueId: 420,
      position: 'MIDDLE',
      patch: '16.20',
      metricId: 'cs_10',
      metricVersion: '1',
      direction: 'increase',
      target: 80,
    },
    state: 'active',
    baseline: [
      {
        matchKey: 'NA1:internal-match-key',
        reportId: 'report',
        inputFingerprint: 'fingerprint',
        startedAt: '2026-10-19T08:00:00Z',
        value: 70,
      },
    ],
    baselineExcluded: null,
    createdAt: '2026-10-19T08:00:00Z',
    windowStart: '2026-10-19T08:00:00Z',
    previousGoalId: null,
  };
  render(<GoalTrendChart goal={goal} evaluation={null} onOpen={() => {}} />);
  expect(chart.setOption).toHaveBeenCalledWith(
    expect.objectContaining({ xAxis: expect.objectContaining({ data: ['10-19'] }) }),
  );
  document.documentElement.setAttribute('data-theme', 'another-theme');
  await waitFor(() => expect(chart.setOption).toHaveBeenCalledTimes(2));
  document.documentElement.setAttribute('data-mode', 'dark');
  await waitFor(() => expect(chart.setOption).toHaveBeenCalledTimes(3));
  expect(initialize).toHaveBeenCalledTimes(1);
  expect(chart.dispose).not.toHaveBeenCalled();
  expect(chart.setOption.mock.calls.every((arguments_) => arguments_.length === 1)).toBe(true);
});
