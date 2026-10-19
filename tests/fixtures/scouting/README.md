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
