import previewSkins from '../../../tests/fixtures/ui-art/champion-skins.json';
import { notebookFixture, resetNotebookFixture } from './notebook-fixture';
import type {
  AppState,
  ConnectionState,
  EventEnvelope,
  MatchSummary,
  Settings,
  Task,
  UpdateSettings,
  MatchQuery,
  CommandMap,
  AssetRequest,
} from '../../generated/contracts';
import { scoutingFixture, resetScoutingFixture, scoutingPlayers } from './scouting-fixture';
import { reviewFixture, resetReviewFixture } from './review-fixture';
import type { CommandName, Transport } from './index';
const previewArt = import.meta.glob<string>('../../../tests/fixtures/ui-art/*.{png,jpg}', {
  eager: true,
  query: '?url',
  import: 'default',
});
const championNames: Record<number, [string, string]> = {
  103: ['阿狸', 'Ahri'],
  64: ['李青', 'Lee Sin'],
  222: ['金克丝', 'Jinx'],
  157: ['亚索', 'Yasuo'],
  99: ['拉克丝', 'Lux'],
  51: ['凯特琳', 'Caitlyn'],
};
const itemNames: Record<number, [string, string]> = {
  3089: ['灭世者的死亡之帽', "Rabadon's Deathcap"],
  3020: ['法师之靴', "Sorcerer's Shoes"],
  3118: ['恶意', 'Malignance'],
  3135: ['虚空之杖', 'Void Staff'],
  4645: ['影焰', 'Shadowflame'],
  3157: ['中娅沙漏', "Zhonya's Hourglass"],
};
const listeners = new Set<(e: EventEnvelope) => void>();
let sequence = 0;
let now = new Date('2026-10-19T00:00:00Z');
let settings: Settings;
let connection: ConnectionState;
let matches: MatchSummary[];
let tasks: Record<string, Task>;
const app: AppState = {
  phase: 'ready',
  runtimeId: 'fixture-runtime',
  workspaceEpoch: 'fixture-epoch',
  appVersion: '0.1.0',
  databaseVersion: 3,
  settingsVersion: 1,
  updateStatus: {
    state: 'unavailable',
    version: null,
    downloaded: 0,
    total: null,
    reason: 'UPDATE_NOT_CONFIGURED',
  },
};
export function resetFixture() {
  resetNotebookFixture();
  resetReviewFixture();
  resetScoutingFixture();
  now = new Date('2026-10-19T00:00:00Z');
  settings = {
    schemaVersion: 1,
    revision: 0,
    languagePreference: 'system',
    themeId: 'default',
    colorModePreference: 'system',
    sidebarCollapsed: false,
    closeBehavior: 'tray',
    autoConnect: true,
    autoSync: true,
    syncPages: 3,
    workspaceTabs: [],
    activeTab: '',
  };
  connection = {
    phase: 'disconnected',
    sessionEpoch: 'fixture-session',
    instance: null,
    player: null,
    identification: null,
    sgpReady: false,
    lcuReady: false,
    retryAt: null,
  };
  matches = [];
  tasks = {};
  sequence = 0;
}
resetFixture();
const emit = (kind: string, objectKey: string | null = null) => {
  const event: EventEnvelope = {
    eventVersion: 1,
    runtimeId: app.runtimeId,
    workspaceEpoch: app.workspaceEpoch,
    sequence: ++sequence,
    revision: settings.revision,
    kind,
    objectKey,
  };
  listeners.forEach((fn) => fn(event));
};
export function setFixtureClock(date: string) {
  now = new Date(date);
}
const errors = new Map<CommandName, string>();
export function injectError(command: CommandName, code: string) {
  errors.set(command, code);
}
function fail(code: string): never {
  throw {
    code: code.toUpperCase(),
    params: {},
    retryable: false,
    requestId: 'fixture-request',
    taskId: null,
  };
}
export function setScenario(name: string) {
  if (name === 'no-client' || name === 'offline') {
    connection = { ...connection, phase: 'disconnected', player: null };
    emit('connection-changed');
    return;
  }
  const server = name === 'riot' ? 'NA1' : 'TENCENT_HN1';
  const identification = {
    realm: name === 'riot' ? 'riot' : 'tencent',
    environment: 'live',
    serverId: server,
    region: name === 'riot' ? 'NA' : 'TENCENT',
    rsoPlatformId: name === 'riot' ? null : 'HN1',
    mappingVersion: 'synthetic',
    evidence: ['synthetic'],
    verification: 'synthetic',
  };
  connection = {
    ...connection,
    phase:
      name === 'waiting'
        ? 'waiting_auth'
        : name === 'conflict'
          ? 'conflict'
          : name === 'unknown'
            ? 'unsupported'
            : 'connected',
    sessionEpoch: crypto.randomUUID(),
    identification,
    sgpReady: name !== 'waiting',
    player: {
      playerKey: `${server}:synthetic-player`,
      puuid: 'synthetic-player',
      serverId: server,
      displayName: 'Rift Walker #DEMO',
      profileIconId: 0,
      summonerLevel: 182,
      updatedAt: now.toISOString(),
    },
    instance: { id: 'synthetic', pid: '1000', startedAt: now.toISOString(), identification },
  };
  if (settings.autoSync && connection.phase === 'connected') generateMatches();
  emit('connection-changed');
  emit('match-updated');
}
function generateMatches() {
  const p = connection.player!;
  matches = [
    ...matches.filter((m) => m.playerKey !== p.playerKey),
    ...Array.from(
      { length: 125 },
      (_, i): MatchSummary => ({
        matchKey: `${p.serverId}:${i}`,
        playerKey: p.playerKey,
        gameId: String(i),
        serverId: p.serverId,
        startedAt: new Date(now.getTime() - i * 3600000).toISOString(),
        queueId: i % 3 ? 420 : 450,
        championId: [103, 64, 222, 157, 99, 51][i % 6],
        version: '16.20.1',
        outcome: i % 3 ? 'win' : 'loss',
        kills: [8, 12, 5, 3, 6, 14][i % 6],
        deaths: [5, 3, 2, 7, 4, 6][i % 6],
        assists: [12, 8, 9, 4, 17, 10][i % 6],
        duration: 1560 + (i % 5) * 137,
        position: ['MIDDLE', 'JUNGLE', 'BOTTOM', 'TOP', 'MIDDLE', 'BOTTOM'][i % 6],
        cs: 180 + (i % 70),
        items: [3089, 3020, 3118, 3135, 4645, 3157].slice(0, 4 + (i % 3)),
        source: 'sgp',
        fallbackReason: null,
        revision: 1,
        reviewState: null,
      }),
    ),
  ];
}
async function execute(command: CommandName, args: unknown): Promise<unknown> {
  const injected = errors.get(command);
  if (injected) {
    errors.delete(command);
    fail(injected);
  }
  switch (command) {
    case 'get_app_state':
      return app;
    case 'get_settings':
      return settings;
    case 'update_settings': {
      const input = args as UpdateSettings;
      if (input.expectedRevision !== settings.revision) fail('settings_conflict');
      settings = {
        ...settings,
        ...Object.fromEntries(Object.entries(input.patch).filter(([, v]) => v !== null)),
        revision: settings.revision + 1,
      };
      emit('settings-changed');
      return settings;
    }
    case 'get_connection_state':
      return connection;
    case 'retry_connection':
      emit('connection-changed');
      return connection;
    case 'list_client_instances':
      return connection.instance ? [connection.instance] : [];
    case 'select_client_instance':
      return connection;
    case 'list_players':
      return [
        ...scoutingPlayers(),
        ...new Map(
          matches.map((m) => [
            m.playerKey,
            {
              playerKey: m.playerKey,
              serverId: m.serverId,
              puuid: 'synthetic-player',
              displayName: 'Rift Walker #DEMO',
              profileIconId: connection.player?.profileIconId ?? null,
              summonerLevel: connection.player?.summonerLevel ?? null,
              updatedAt: now.toISOString(),
            },
          ]),
        ).values(),
      ];
    case 'list_matches': {
      const q = args as MatchQuery;
      const rows = matches.filter(
        (m) =>
          m.playerKey === q.playerKey &&
          (!q.queueId || m.queueId === q.queueId) &&
          (!q.championId || m.championId === q.championId) &&
          (!q.from || m.startedAt >= q.from) &&
          (!q.to || m.startedAt <= q.to),
      );
      const offset = Number(q.cursor) || 0;
      return {
        items: rows.slice(offset, offset + 50),
        total: rows.length,
        nextCursor: rows.length > offset + 50 ? String(offset + 50) : null,
        coverage: {
          pages: 3,
          matchesCount: rows.length,
          exhausted: true,
          lastSync: now.toISOString(),
        },
      };
    }
    case 'sync_player_matches': {
      if (!connection.player || connection.phase !== 'connected') fail('waiting_auth');
      generateMatches();
      const id = crypto.randomUUID();
      tasks[id] = {
        id,
        kind: 'sync',
        result: null,
        stage: 'completed',
        retryAt: null,
        playerKey: connection.player.playerKey,
        state: 'completed',
        checkpoint: 3,
        budget: 3,
        sessionEpoch: connection.sessionEpoch,
        updatedAt: now.toISOString(),
        error: null,
      };
      emit('match-updated');
      return tasks[id];
    }
    case 'get_task_status':
    case 'cancel_task':
      return tasks[(args as { id: string }).id] || fail('not_found');
    case 'get_champion_skins': {
      const query = args as CommandMap['get_champion_skins']['input'];
      return {
        championId: query.championId,
        skins: previewSkins[String(query.championId) as keyof typeof previewSkins] || [],
      };
    }
    case 'resolve_assets': {
      const q = args as AssetRequest;
      const ids = [
        ...q.championIds.map((id) => ({ kind: 'champion', id })),
        ...(q.resourceIds || []),
      ];
      return ids.map(({ kind, id }) => {
        const reference =
          previewArt[`../../../tests/fixtures/ui-art/${kind}-${id}.png`] ||
          previewArt[`../../../tests/fixtures/ui-art/${kind}-${id}.jpg`] ||
          null;
        return {
          resourceId: `${kind}:${id}`,
          requestedVersion: q.version,
          actualVersion: reference ? '16.20.1' : null,
          locale: q.locale,
          name:
            (kind === 'champion' ? championNames : itemNames)[id]?.[q.locale === 'zh-CN' ? 0 : 1] ||
            null,
          reference,
          hash: null,
          availability: reference ? 'available' : 'missing',
        };
      });
    }
    case 'get_storage_usage':
    case 'clear_asset_cache':
      return { databaseBytes: matches.length * 1024, assetBytes: 0, backupBytes: 0 };
    case 'check_for_updates':
    case 'install_update':
      return {
        state: 'unavailable',
        version: null,
        downloaded: 0,
        total: null,
        reason: 'UPDATE_NOT_CONFIGURED',
      };
    case 'create_backup':
    case 'restore_backup':
    case 'export_diagnostics':
      return fail('endpoint_unsupported');
    default: {
      const context: Parameters<typeof reviewFixture>[2] = {
        matches,
        connection,
        now,
        emit,
        fail,
        task: (reference, kind) => {
          const id = crypto.randomUUID();
          const task: Task = {
            id,
            kind,
            result: { reference, workspaceEpoch: app.workspaceEpoch },
            playerKey: connection.player?.playerKey || null,
            state: 'completed',
            checkpoint: 2,
            budget: 2,
            sessionEpoch: connection.sessionEpoch,
            updatedAt: now.toISOString(),
            error: null,
            stage: 'completed',
            retryAt: null,
          };
          tasks[id] = task;
          return task;
        },
      };
      const notebook = notebookFixture(command, args, context);
      if (notebook !== undefined) return notebook;
      const value = scoutingFixture(command, args, context, context);
      return value === undefined ? reviewFixture(command, args, context) : value;
    }
  }
}
export function fixtureTransport(): Transport {
  return {
    mode: 'fixture',
    call: <K extends CommandName>(command: K, args: CommandMap[K]['input']) =>
      execute(command, args).then((v) => structuredClone(v) as CommandMap[K]['output']),
    subscribe: async (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
