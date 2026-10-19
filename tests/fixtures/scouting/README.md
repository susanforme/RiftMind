# Stage 3 synthetic samples

`live.json` is a hand-constructed public champion-select/gameflow response envelope,
with ten public PUUIDs and no credentials. Tests derive anonymous cells, cancellation,
champion changes, game IDs, disconnect/reconnect and stale responses from it.
`expected.json` records independent rule and denominator expectations, not generated
answers. Existing Stage 2 SUMMARY/DETAILS inputs provide completed-match evidence.

Interface reference fixed at LeagueAkari commit
`56cdfde00e56148f4641d1a8cf86acb66e903124`; see
`src/main/shards/ongoing-game/index.ts` and the LCU API adapters in that revision.
RiftMind independently implements the Rust state machine and shadcn React UI;
no Akari source code is transplanted. Public LCU identities only; no anonymous
identity recovery and no Live Client Data API. These are synthetic shapes and
remain unverified against real Riot/Tencent clients.

`lobby.json` is a synthetic `/lol-lobby/v2/lobby` payload with the signed-in
player and one party member. Field names follow `Lobby`, `LocalMember`, and
`GameConfig` in Akari's `src/shared/types/league-client/lobby.ts` at the commit
above. Tests derive solo rooms, joins/leaves, matchmaking, ready checks, bots,
spectators, missing member lists, and a return from champion select from it.
