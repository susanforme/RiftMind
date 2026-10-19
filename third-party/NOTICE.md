# Third-party references

Server configuration and alias mappings in `crates/riftmind-core/src/domain/servers.json`
and `domain/mod.rs` are derived from LeagueAkari, commit
`56cdfde00e56148f4641d1a8cf86acb66e903124`, MIT licensed; see
[LeagueAkari-LICENSE](LeagueAkari-LICENSE).

Sources:
- https://github.com/LeagueAkari/LeagueAkari/blob/56cdfde00e56148f4641d1a8cf86acb66e903124/src/main/shards/akari-api/builtin.ts
- https://github.com/LeagueAkari/LeagueAkari/blob/56cdfde00e56148f4641d1a8cf86acb66e903124/src/shared/utils/sgp.ts
- https://github.com/LeagueAkari/LeagueAkari/blob/56cdfde00e56148f4641d1a8cf86acb66e903124/src/shared/types/sgp/match-history.ts

`reference_only` means reviewed against this source, not tested against a live server.
PBE/PREPBE entries are retained as explicitly unsupported environments.
Community Dragon assets are downloaded on demand; game artwork remains owned by Riot Games.
No League of Legends art or private credentials are bundled with the production app.
Development-only UI fixtures use Riot Data Dragon 16.20.1 images; see
[UI fixture sources](../tests/fixtures/ui-art/SOURCES.md).

The Button/Dialog source follows shadcn/ui's open-source composition pattern
(MIT, https://github.com/shadcn-ui/ui); Tailwind tokens are project-owned.

UI layout and default light/dark palette reference League Akari's sidebar, player
tabs and match-history cards. RiftMind uses its own React components and only
implements the two Stage 1 pages. Reference sources:
- https://github.com/LeagueAkari/LeagueAkari/blob/56cdfde00e56148f4641d1a8cf86acb66e903124/src/renderer/src-main-window/components/sidebar/Sidebar.vue
- https://github.com/LeagueAkari/LeagueAkari/blob/56cdfde00e56148f4641d1a8cf86acb66e903124/src/renderer-shared/assets/css/theme-system.css
- https://github.com/LeagueAkari/LeagueAkari/blob/v1.2.5/pictures/main_page_match-history-tabs.png
