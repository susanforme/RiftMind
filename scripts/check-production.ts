import { readdir } from 'node:fs/promises';
const developmentMarkers =
  /synthetic-player|synthetic-rso|\/bridge\/|fixture-runtime|dev-toolbar|dev-banner|Preview data|预览数据|Test scenario|测试场景|riftmind-production-leak-sentinel/;
for (const file of await readdir('dist/assets')) {
  if (
    /^(?:fixture|notebook-fixture|scouting-fixture|review-fixture|harness|DevToolbar|champion-\d|item-\d|skill-\d|spell-\d)/.test(
      file,
    )
  )
    throw new Error(`Development asset leaked into production: ${file}`);
  if (!/\.(?:js|css|map)$/.test(file)) continue;
  const source = await Bun.file(`dist/assets/${file}`).text();
  if (developmentMarkers.test(source))
    throw new Error(`Development content leaked into production: ${file}`);
}
const capability = await Bun.file('src-tauri/capabilities/default.json').text();
if (/sql:|shell:|fs:/.test(capability)) throw new Error('Unsafe frontend capability');
console.log('Production bundle isolation passed.');
