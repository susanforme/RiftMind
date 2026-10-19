import type { MatchSummary } from '../generated/contracts';

export const matchOutcomeClasses = {
  win: '[--outcome:var(--win)] [--row-bg:var(--win-bg)]',
  loss: '[--outcome:var(--loss)] [--row-bg:var(--loss-bg)]',
  remake: '[--outcome:var(--remake)] [--row-bg:var(--remake-bg)]',
  unknown: '[--outcome:var(--unknown)] [--row-bg:var(--unknown-bg)]',
} satisfies Record<MatchSummary['outcome'], string>;
