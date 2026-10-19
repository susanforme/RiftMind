import { expect, it } from 'vitest';
import i18n from '../../src/i18n';
import { championIds, championName, codeName, groupName, matchName, positionName, queueName, rankName, skillName, spellName, errorName, playerName } from '../../src/lib/display-names';

it('translates client, game phase, mode, monster and source codes', () => {
  const t = i18n.getFixedT('zh-CN');
  expect(codeName(t, 'realm', 'tencent')).toBe('国服');
  expect(codeName(t, 'environment', 'live')).toBe('正式服');
  expect(codeName(t, 'source', 'lcu')).toBe('本地客户端');
  expect(codeName(t, 'phase', 'ChampSelect')).toBe('英雄选择');
  expect(codeName(t, 'mode', 'CLASSIC')).toBe('经典模式');
  expect(codeName(t, 'monster', 'BARON_NASHOR')).toBe('纳什男爵');
  expect(codeName(t, 'phase', 'NEW_PHASE')).toBe('未知');
});

it('names numeric and ranked queue codes and normalizes position aliases', () => {
  const t = i18n.getFixedT('zh-CN');
  expect(queueName(t, 440)).toBe('灵活组排');
  expect(queueName(t, 'RANKED_SOLO_5x5')).toBe('单双排位');
  expect(queueName(t, 999999)).toBe('未知模式');
  expect(queueName(t, null)).toBe('未知模式');
  expect(positionName(t, 'middle')).toBe('中单');
  expect(positionName(t, 'support')).toBe('辅助');
  expect(positionName(t, 'UNKNOWN')).toBe('未知');
});

it('renders comparability groups and match links without internal composite keys', () => {
  const t = i18n.getFixedT('zh-CN');
  expect(groupName(t, '420:MIDDLE:16.20:1')).toBe('单双排位 · 中单 · 版本 16.20 · 分析规则 1');
  expect(groupName(t, 'UNKNOWN:UNKNOWN:unknown')).toBe('未知模式 · 未知 · 版本 未知');
  expect(matchName(t, 'TENCENT_HN1:123')).toBe('艾欧尼亚 · 对局 123');
  expect(matchName(t, 'opaque-uuid')).toBe('对局');
});

it('uses localized Riot champion and summoner spell names with labeled resource fallbacks', () => {
  const zh = i18n.getFixedT('zh-CN'); const en = i18n.getFixedT('en-US');
  expect(championName(zh, 103)).toBe('九尾妖狐');
  expect(championName(en, 103)).toBe('Ahri');
  expect(spellName(zh, 4)).toBe('闪现');
  expect(spellName(en, 4)).toBe('Flash');
  expect(skillName(zh, 4)).toBe('技能 R');
  expect(championName(zh, 999999)).toBe('英雄 999999');
  expect(championName(zh, null)).toBe('未知');
  for (const id of championIds) {
    expect(i18n.exists(`champion_${id}`, { lng: 'zh-CN', ns: 'labels', fallbackLng: false })).toBe(true);
    expect(i18n.exists(`champion_${id}`, { lng: 'en-US', ns: 'labels', fallbackLng: false })).toBe(true);
  }
});

it('formats rank queue, tier, division and league points in the selected language', () => {
  const rank = { queue: 'RANKED_SOLO_5x5', tier: 'DIAMOND', division: 'IV', points: 42 };
  expect(rankName(i18n.getFixedT('zh-CN'), rank)).toBe('单双排位 璀璨钻石 IV 42 胜点');
  expect(rankName(i18n.getFixedT('en-US'), rank)).toBe('Ranked Solo/Duo Diamond IV 42 LP');
});

it('keeps opaque player IDs and unknown error keys out of user-facing labels', () => {
  const t = i18n.getFixedT('zh-CN');
  const p = { playerKey: 'NA1:opaque-uuid', puuid: 'opaque-uuid', displayName: 'opaque-uuid', serverId: 'NA1', updatedAt: '' };
  expect(playerName(t, p)).toBe('未知玩家');
  expect(playerName(t, { ...p, displayName: 'Player#123' })).toBe('Player#123');
  expect(errorName(t, 'EndpointUnsupported')).toBe(t('errors.endpoint_unsupported'));
  expect(errorName(t, 'FUTURE_ERROR')).toBe(t('errors.network_unavailable'));
});
