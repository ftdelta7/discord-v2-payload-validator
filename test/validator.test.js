'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { validatePayload } = require('..');

const message = (...components) => ({ flags: 32768, components });
const display = (content = 'Hello') => ({ type: 10, content });
const section = accessory => ({ type: 9, components: [display()], accessory });
const media = { url: 'https://example.com/picture.png' };
const button = { type: 2, style: 1, label: 'Next', custom_id: 'next' };
const row = (...components) => ({ type: 1, components });
const container = (...components) => ({ type: 17, components });
const builder = value => ({ toJSON: () => value });

function pass(payload) {
  assert.deepEqual(validatePayload(payload), { valid: true, errors: [], warnings: [] });
}

function fails(payload, path, code) {
  const result = validatePayload(payload);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(issue =>
    issue.path === path && issue.code === code && typeof issue.message === 'string'
  ), JSON.stringify(result));
}

test('valid complete layout with combined flags and both Section accessory types', () => {
  const layout = container(section({ type: 11, media }), section(button), display(),
    { type: 12, items: [{ media }] }, { type: 13, file: { url: 'attachment://notes.txt' } },
    { type: 14, spacing: 2 }, row({ type: 5, custom_id: 'pick' }));
  pass({ flags: 32768 | 64, components: [{ ...layout, accent_color: 0xffffff }] });
});

test('raw messages, nested builders, standalone containers and throwing builders', () => {
  pass(builder(message(builder(container(builder(display()))))));
  pass(builder(container(display())));
  fails({ components: [builder(container(display()))] }, '$.flags', 'MISSING_V2_FLAG');
  fails(message({ toJSON() { throw new Error('Invalid builder'); } }),
    '$.components[0]', 'SERIALIZATION_FAILED');
  for (const value of [null, [], 'hello', builder(null)]) fails(value, '$', 'EXPECTED_OBJECT');
  fails({ components: null }, '$.components', 'EXPECTED_ARRAY');
});

test('flag and legacy fields are checked at the message level', () => {
  pass({ content: 'Hello', embeds: [], components: [row(button)] });
  fails({ flags: 64, components: [display()] }, '$.flags', 'MISSING_V2_FLAG');
  fails({ flags: '32768' }, '$.flags', 'INVALID_FLAGS');
  for (const [field, value] of Object.entries({
    content: '', embeds: [], stickers: [], sticker_ids: [], poll: null,
  })) {
    fails({ ...message(display()), [field]: value }, '$.' + field, 'LEGACY_FIELD');
  }
});

test('component total includes containers, rows, buttons and accessories but excludes gallery items', () => {
  const components = [container(section(button), row(button), { type: 12, items: [{ media }] }),
    ...Array.from({ length: 33 }, () => ({ type: 14 }))];
  pass(message(...components));
  fails(message(...components, display()), '$', 'COMPONENT_LIMIT');
});

test('text budget sums displays across branches and allows exactly 4000', () => {
  const first = container(display('a'.repeat(3999)));
  pass(message(first, display('b')));
  fails(message(first, display('bc')), '$', 'TEXT_LIMIT');
  for (const value of ['', null, 1]) fails(message(display(value)), '$.components[0].content', 'TEXT_CONTENT');
});

test('sections require one to three displays and a button or thumbnail', () => {
  for (const components of [[], Array(4).fill(display())]) {
    fails(message({ ...section(button), components }), '$.components[0].components', 'CHILD_COUNT');
  }
  fails(message(section(undefined)), '$.components[0].accessory', 'EXPECTED_OBJECT');
  fails(message(section(display())), '$.components[0].accessory.type', 'COMPONENT_TYPE');
  fails(message(section({ type: 11 })), '$.components[0].accessory.media.url', 'MEDIA_URL');
  fails(message({ ...section(button), components: [button] }), '$.components[0].components[0].type', 'COMPONENT_TYPE');
});

test('row size, select exclusivity and placement', () => {
  pass(message(row(...Array.from({ length: 5 }, (_, i) => ({ ...button, custom_id: String(i) })))));
  for (const type of [3, 5, 6, 7, 8]) {
    const select = { type, custom_id: 'pick' };
    pass(message(row(select)));
    fails(message(row(select, button)), '$.components[0].components[0]', 'ROW_SELECT');
  }
  for (const components of [[], Array(6).fill(button)]) {
    fails(message(row(...components)), '$.components[0].components', 'CHILD_COUNT');
  }
  fails(message(row(display())), '$.components[0].components[0].type', 'COMPONENT_TYPE');
  for (const type of [2, 3, 4, 11, 99]) fails(message({ type }), '$.components[0].type', 'COMPONENT_TYPE');
});

test('gallery sizes and item URLs, file URL and compatibility alias', () => {
  pass(message({ type: 12, items: Array(10).fill({ media }) }));
  for (const items of [null, [], Array(11).fill({ media })]) {
    fails(message({ type: 12, items }), '$.components[0].items', 'GALLERY_SIZE');
  }
  fails(message({ type: 12, items: [null] }), '$.components[0].items[0].media.url', 'MEDIA_URL');
  for (const field of ['media', 'file']) {
    for (const url of [media.url, 'attachment://']) {
      fails(message({ type: 13, [field]: { url } }), '$.components[0].' + field + '.url', 'FILE_URL');
    }
  }
  const result = validatePayload(message({ type: 13, media: { url: 'attachment://x' } }));
  assert.equal(result.valid, true);
  assert.equal(result.warnings[0].code, 'FILE_MEDIA_ALIAS');
});

test('separator spacing, container children and RGB bounds', () => {
  for (const spacing of [undefined, 1, 2]) pass(message({ type: 14, spacing }));
  fails(message({ type: 14, spacing: '1' }), '$.components[0].spacing', 'SEPARATOR_SPACING');
  for (const accent_color of [-1, 0x1000000, 1.5, 'red']) {
    fails(message({ ...container(display()), accent_color }), '$.components[0].accent_color', 'ACCENT_COLOR');
  }
  fails(message(container(container(display()))), '$.components[0].components[0].type', 'COMPONENT_TYPE');
});

test('CLI exit status and diagnostics for success, invalid input and file errors', t => {
  const dir = mkdtempSync(join(tmpdir(), 'v2-validate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'message.json');
  const run = (...args) => spawnSync(process.execPath, [require.resolve('../bin/cli'), ...args], { encoding: 'utf8' });
  assert.equal(run().status, 1);
  assert.equal(run(file).status, 1);
  writeFileSync(file, '{');
  assert.equal(run(file).status, 1);
  writeFileSync(file, JSON.stringify({ components: [display()] }));
  const invalid = run(file);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /\$\.flags \[MISSING_V2_FLAG\]/);
  writeFileSync(file, JSON.stringify(message(display())));
  const valid = run(file);
  assert.equal(valid.status, 0);
  assert.match(valid.stdout, /PASS/);
});
