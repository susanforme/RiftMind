import { readdir } from 'node:fs/promises';
import ts from 'typescript';
for (const file of await readdir('src/i18n/locales/zh-CN')) {
  const zh = await Bun.file(`src/i18n/locales/zh-CN/${file}`).json();
  const en = await Bun.file(`src/i18n/locales/en-US/${file}`).json();
  if (JSON.stringify(Object.keys(zh).sort()) !== JSON.stringify(Object.keys(en).sort()))
    throw new Error(`Translation keys differ: ${file}`);
  for (const key of Object.keys(zh)) {
    const params = (s: string) =>
      [...s.matchAll(/{{(\w+)}}/g)]
        .map((m) => m[1])
        .sort()
        .join();
    if (params(zh[key]) !== params(en[key]))
      throw new Error(`Translation params differ: ${file}:${key}`);
  }
}
const source = await Bun.file('src/styles/themes/default.css').text();
const [light, dark] = source.split('[data-theme="default"][data-mode="dark"]');
const tokens = (s: string) =>
  [...s.matchAll(/--([\w-]+):/g)]
    .map((m) => m[1])
    .sort()
    .join();
if (tokens(light) !== tokens(dark)) throw new Error('Theme token contract differs');
console.log('Translation and theme contracts passed.');
const luminance = (hex: string) => {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};
const pairs = [
  ['window-close-foreground', 'window-close'],
  ['foreground', 'background'],
  ['muted-foreground', 'card'],
  ['primary', 'primary-foreground'],
  ['accent-foreground', 'accent'],
  ['win', 'win-bg'],
  ['loss', 'loss-bg'],
  ['warning', 'warning-bg'],
  ['unknown', 'unknown-bg'],
  ['remake', 'remake-bg'],
];
for (const [mode, css] of [
  ['light', light],
  ['dark', dark],
]) {
  const colors = Object.fromEntries(
    [...css.matchAll(/--([\w-]+):\s*(#[\da-f]{6});/gi)].map((m) => [m[1], m[2]]),
  );
  for (const [foreground, background] of pairs) {
    const a = luminance(colors[foreground]);
    const b = luminance(colors[background]);
    const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (contrast < 4.5)
      throw new Error(`${mode} ${foreground}/${background} contrast is ${contrast.toFixed(2)}`);
  }
}
console.log('Core text color token pairs meet 4.5:1 contrast.');

// Business controls must compose the shared shadcn components (AGENTS.md).
const nativeControls = new Set([
  'button',
  'input',
  'select',
  'textarea',
  'progress',
  'table',
  'label',
]);
for (const path of await readdir('src', { recursive: true })) {
  const relative = path.replaceAll('\\', '/');
  if (!relative.endsWith('.tsx') || relative.startsWith('components/ui/')) continue;
  const file = `src/${relative}`;
  const source = ts.createSourceFile(
    file,
    await Bun.file(file).text(),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  function check(node: ts.Node) {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      nativeControls.has(node.tagName.getText(source))
    ) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      throw new Error(
        `${file}:${line + 1}: use the shared shadcn component for ${node.tagName.getText(source)}`,
      );
    }
    ts.forEachChild(node, check);
  }
  check(source);
}
console.log('Business controls use shared shadcn components.');
