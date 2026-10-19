import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
const files = [
  'crates/riftmind-core/src/clients/mod.rs',
  'crates/riftmind-core/src/domain/servers.json',
  'src/lib/transport/fixture.ts',
  'tests/fixtures/icon.png',
  'tests/fixtures/update-test.pub',
  'tests/fixtures/update-artifact.bin',
  'tests/fixtures/update-artifact.bin.sig',
];
files.push(
  ...(await readdir('tests/fixtures/ui-art'))
    .filter((file) => file.endsWith('.png') || file.endsWith('.json'))
    .sort()
    .map((file) => `tests/fixtures/ui-art/${file}`),
);
files.push(
  ...(await readdir('tests/fixtures/review'))
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => `tests/fixtures/review/${file}`),
);
files.push(
  ...(await readdir('tests/fixtures/scouting'))
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => `tests/fixtures/scouting/${file}`),
);
files.push(
  ...(await readdir('tests/fixtures/notebooks'))
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => `tests/fixtures/notebooks/${file}`),
);
const entries = [];
for (const path of files)
  entries.push({
    path,
    sha256: createHash('sha256')
      .update(Buffer.from(await Bun.file(path).arrayBuffer()))
      .digest('hex'),
  });
const manifest = {
  schemaVersion: 1,
  source:
    'synthetic generators, source-referenced server mappings, Riot Data Dragon 16.20.1 UI preview art; no captured credentials',
  entries,
};
if (process.argv.includes('--check')) {
  const saved = await Bun.file('tests/fixtures/manifest.json').json();
  if (JSON.stringify(saved) !== JSON.stringify(manifest))
    throw new Error('Fixture hashes changed. Run bun scripts/fixture-manifest.ts and review.');
} else await Bun.write('tests/fixtures/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
