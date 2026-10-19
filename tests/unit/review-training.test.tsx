import { beforeEach, expect, it } from 'vitest';
import { validateSearch } from '../../src/app/router';
import { useWorkspace } from '../../src/stores/workspace-tabs';
import { numberText, matchTime } from '../../src/features/review/format';
import { fixtureTransport, resetFixture, setScenario } from '../../src/lib/transport/fixture';
beforeEach(() => {
  resetFixture();
  useWorkspace.setState({ reviewDrafts: {}, workspaceChanged: false });
});
it('validates report, evidence and millisecond locations without accepting unsafe IDs', () => {
  expect(
    validateSearch({ player: 'NA1:p', report: 'r-1', evidence: 'event-2-0', at: 120000 }),
  ).toEqual({ player: 'NA1:p', report: 'r-1', evidence: 'event-2-0', at: 120000 });
  expect(validateSearch({ report: '../../secret', evidence: '<script>', at: Infinity })).toEqual(
    {},
  );
});
it('formats shared metric values without treating KDA as a percentage', () => {
  expect(numberText(0.6, 'ratio')).toBe('60.0%');
  expect(numberText(1, 'ratio')).toBe('100.0%');
  expect(numberText(6)).toBe('6');
  expect(numberText(null)).toBe('—');
  expect(matchTime(601234)).toBe('10:01');
});
it('keeps note drafts separate by workspace and isolates them with an explicit restore notice', () => {
  const draft = {
    text: 'unsaved',
    note: null,
    reportId: null,
    evidenceId: null,
    matchKey: 'NA1:1',
    playerKey: 'NA1:p',
    epoch: 'old',
  };
  useWorkspace.getState().setReviewDraft('old|NA1:p|NA1:1', draft);
  expect(useWorkspace.getState().reviewDrafts['old|NA1:p|NA1:1'].text).toBe('unsaved');
  useWorkspace.getState().markWorkspaceChanged();
  expect(useWorkspace.getState().reviewDrafts['old|NA1:p|NA1:1'].text).toBe('unsaved');
  expect(useWorkspace.getState().workspaceChanged).toBe(true);
});
it('development fixture uses Rust-generated facts and preserves annotations offline', async () => {
  setScenario('tencent');
  const transport = fixtureTransport();
  const playerKey = 'TENCENT_HN1:synthetic-player';
  const list = await transport.call('list_matches', {
    playerKey,
    queueId: 420,
    championId: null,
    from: null,
    to: null,
    cursor: null,
    pageSize: 1,
  });
  const matchKey = list.items[0].matchKey;
  await transport.call('fetch_match_details', { playerKey, matchKey });
  const data = await transport.call('get_match_review_data', {
    playerKey,
    matchKey,
    inputRevision: null,
    reportId: null,
  });
  const task = await transport.call('generate_review', {
    playerKey,
    matchKey,
    inputRevision: data.latestInputRevision!,
  });
  expect(task.state).toBe('completed');
  const report = await transport.call('get_review', { id: task.result!.reference });
  expect(report.metrics.find((m) => m.id === 'cs_10')?.value).toBe(70);
  setScenario('offline');
  await transport.call('save_review_note', {
    workspaceEpoch: 'fixture-epoch',
    id: null,
    matchKey,
    playerKey,
    reportId: report.id,
    evidenceId: null,
    text: 'offline fixture note',
    expectedRevision: 0,
  });
  const annotations = await transport.call('get_review_annotations', {
    matchKey,
    playerKey,
    reportId: report.id,
  });
  expect(annotations.notes[0].text).toBe('offline fixture note');
});
