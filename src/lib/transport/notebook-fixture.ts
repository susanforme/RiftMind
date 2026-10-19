// Development notebook interactions. Persistence and statistical acceptance use the Rust harness.
import type { CommandMap, NotebookEntry, PracticeEntry } from '../../generated/contracts';
import type { CommandName } from './index';
let entries: NotebookEntry[] = [];
let history = new Map<string, NotebookEntry[]>();
let practices: PracticeEntry[] = [];
export function resetNotebookFixture() {
  entries = [];
  history = new Map();
  practices = [];
}
export function notebookFixture(
  command: CommandName,
  args: unknown,
  context: { fail: (code: string) => never; emit: (kind: string) => void },
) {
  const { fail, emit } = context;
  switch (command) {
    case 'list_notebook_entries': {
      const query = args as CommandMap['list_notebook_entries']['input'];
      return entries
        .filter(
          (entry) =>
            entry.deleted === query.trash &&
            (!query.championId || entry.content.championId === query.championId) &&
            (!query.kind || entry.content.kind === query.kind) &&
            (!query.opponentId || entry.content.opponentId === query.opponentId) &&
            `${entry.content.title} ${entry.content.text}`
              .toLowerCase()
              .includes(query.search.toLowerCase()),
        )
        .sort((left, right) => Number(right.content.pinned) - Number(left.content.pinned));
    }
    case 'save_notebook_entry': {
      const query = args as CommandMap['save_notebook_entry']['input'];
      if (query.workspaceEpoch !== 'fixture-epoch') return fail('session_changed');
      const previous = entries.find((entry) => entry.id === query.id);
      if ((previous?.revision || 0) !== query.expectedRevision) return fail('revision_conflict');
      if (!query.content.title.trim()) return fail('invalid_input');
      const entry: NotebookEntry = {
        id: query.id || crypto.randomUUID(),
        revision: query.expectedRevision + 1,
        content: structuredClone(query.content),
        reviewedRevision: query.confirmPatch ? query.expectedRevision + 1 : null,
        deleted: false,
        updatedAt: new Date().toISOString(),
      };
      if (query.confirmPatch) entry.content.confirmedPatch = query.confirmPatch;
      entries = entries.filter((candidate) => candidate.id !== entry.id);
      entries.push(entry);
      history.set(entry.id, [structuredClone(entry), ...(history.get(entry.id) || [])]);
      emit('notebooks-changed');
      return entry;
    }
    case 'get_notebook_history': {
      const { id } = args as { id: string };
      if (!history.has(id)) return fail('not_found');
      return { entryId: id, revisions: history.get(id) };
    }
    case 'change_notebook_entry': {
      const query = args as CommandMap['change_notebook_entry']['input'];
      const entry = entries.find((entry) => entry.id === query.id);
      if (!entry) return fail('not_found');
      if (query.workspaceEpoch !== 'fixture-epoch') return fail('session_changed');
      if (entry.revision !== query.expectedRevision) return fail('revision_conflict');
      if (query.action === 'purge' && query.confirmPermanent && entry.deleted) {
        entries = entries.filter((candidate) => candidate.id !== entry.id);
        history.delete(entry.id);
      } else {
        if (query.action === 'restore') {
          const old = history
            .get(entry.id)
            ?.find((revision) => revision.revision === query.restoreRevision);
          if (!old) return fail('not_found');
          entry.content = structuredClone(old.content);
          entry.deleted = false;
        } else if (query.action === 'trash') entry.deleted = true;
        else if (query.action === 'recover') entry.deleted = false;
        else return fail('invalid_input');
        entry.revision++;
        entry.updatedAt = new Date().toISOString();
        history.set(entry.id, [structuredClone(entry), ...(history.get(entry.id) || [])]);
      }
      emit('notebooks-changed');
      return {};
    }
    case 'list_practice_entries': {
      const query = args as CommandMap['list_practice_entries']['input'];
      return practices.filter(
        (practice) => !query.championId || practice.championId === query.championId,
      );
    }
    case 'save_practice_entry': {
      const query = args as CommandMap['save_practice_entry']['input'];
      const old = practices.find((practice) => practice.id === query.entry.id);
      if ((old?.revision || 0) !== query.expectedRevision) return fail('revision_conflict');
      practices = practices.filter((practice) => practice.id !== query.entry.id);
      if (!query.delete)
        practices.push({
          ...structuredClone(query.entry),
          revision: query.expectedRevision + 1,
          updatedAt: new Date().toISOString(),
        });
      emit('notebooks-changed');
      return {};
    }
    case 'export_champion_notebook': {
      const query = args as CommandMap['export_champion_notebook']['input'];
      const exported = structuredClone(
        entries.filter((entry) => !entry.deleted && entry.content.championId === query.championId),
      );
      const ids = new Set(exported.map((entry) => entry.id));
      for (const entry of exported) {
        entry.content.sources = [];
        entry.content.links = entry.content.links.filter((link) => ids.has(link.entryId));
      }
      return {
        format: 'riftmind-champion-notebook',
        version: 1,
        championId: query.championId,
        entries: exported,
      };
    }
    case 'get_item_catalogue': {
      const query = args as CommandMap['get_item_catalogue']['input'];
      return {
        version: query.version,
        items: [
          {
            id: 1001,
            name: query.locale === 'zh-CN' ? '速度之靴' : 'Boots',
            purchasable: true,
            maps: [11, 12],
          },
          {
            id: 1052,
            name: query.locale === 'zh-CN' ? '增幅典籍' : 'Amplifying Tome',
            purchasable: true,
            maps: [11, 12],
          },
          {
            id: 3089,
            name: query.locale === 'zh-CN' ? '灭世者的死亡之帽' : "Rabadon's Deathcap",
            purchasable: true,
            maps: [11, 12],
          },
        ],
      };
    }
    case 'list_match_preparations':
      return [];
    case 'get_personal_baseline':
    case 'get_review_event_context':
    case 'preview_match_preparation':
    case 'start_match_preparation':
    case 'change_match_preparation':
    case 'import_champion_notebook':
    case 'export_item_build':
    case 'apply_item_build':
    case 'save_item_build_file':
    case 'save_champion_notebook_file':
      return fail('endpoint_unsupported');
    default:
      return undefined;
  }
}
