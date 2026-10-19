const child = Bun.spawn(['cargo', 'run', '--quiet', '--locked', '-p', 'riftmind-core', '--bin', 'export-contracts'], { stdout: 'pipe', stderr: 'inherit' });
const generated = await new Response(child.stdout).text();
if (await child.exited) process.exit(1);
const file = 'src/generated/contracts.ts';
if (process.argv.includes('--check')) { if (generated !== await Bun.file(file).text()) { console.error('Generated IPC contracts differ. Run bun run generate:contracts.'); process.exit(1); } }
else await Bun.write(file, generated);
