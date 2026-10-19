import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps globals limited to theme mappings, element defaults and accessibility rules', () => {
  const source = readFileSync('src/styles/globals.css', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@import\s+[^;]+;/g, '');
  const allowedSelectors = new Set([
    '*',
    '::before',
    '::after',
    '::backdrop',
    '*::before',
    '*::after',
    'html',
    'body',
    '#root',
    'button',
    'button:disabled',
    'input',
    ':focus-visible',
    'h1',
    'h2',
    'p',
    'small',
    'code',
  ]);
  const allowedAtRules = new Set([
    '@theme inline',
    '@layer base',
    '@media (prefers-reduced-motion: reduce)',
  ]);
  for (const [, header] of source.matchAll(/([^{}]+)\{/g)) {
    const trimmed = header.trim();
    if (trimmed.startsWith('@')) {
      expect(allowedAtRules.has(trimmed), trimmed).toBe(true);
    } else {
      for (const selector of trimmed.split(',')) {
        expect(allowedSelectors.has(selector.trim()), selector).toBe(true);
      }
    }
  }
  expect(source).not.toContain('@apply');
});

it('keeps CSS files in the global and theme styles directory', () => {
  const stylesheets = readdirSync('src', { recursive: true })
    .map((path) => String(path).replaceAll('\\', '/'))
    .filter((path) => path.endsWith('.css'));
  expect(stylesheets.length).toBeGreaterThan(0);
  for (const stylesheet of stylesheets) {
    expect(
      stylesheet === 'styles/globals.css' || stylesheet.startsWith('styles/themes/'),
      stylesheet,
    ).toBe(true);
  }
});
