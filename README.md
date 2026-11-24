# discord-v2-payload-validator

Check a Discord message’s Components V2 layout before sending it. This zero-dependency CommonJS package provides a synchronous validator and a CLI for saved JSON files. Diagnostics include the field path, a machine-readable code, and a message.

## Installation

With Node.js 18 or newer, install the local checkout into your bot project.

```sh
npm install /path/to/discord-v2-payload-validator
```

You can also run the CLI and tests directly from this repository.

## Programmatic usage

```js
const { validatePayload } = require('discord-v2-payload-validator');

const payload = { components: [{ type: 10, content: 'Build finished.' }] };
const result = validatePayload(payload);
console.log(result.errors[0]);
// { path: '$.flags', code: 'MISSING_V2_FLAG',
//   message: 'Set the IS_COMPONENTS_V2 flag (32768).' }
```

`validatePayload(payload)` returns `{ valid, errors, warnings }`. Each issue has string fields `path`, `code`, and `message`. Paths start at `$` and use zero-based array indexes. Errors make `valid` false. Warnings describe accepted inputs that need attention.

### With discord.js

In a bot using a Components V2-capable version of discord.js, pass the same options object to validation and to `channel.send()`.

```js
const { ContainerBuilder, MessageFlags } = require('discord.js');
const { validatePayload } = require('discord-v2-payload-validator');

async function sendBuildUpdate(channel) {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(text => text.setContent('Build finished.'));
  const payload = { flags: MessageFlags.IsComponentsV2, components: [container] };
  const { valid, errors } = validatePayload(payload);
  if (!valid) throw new Error(errors.map(e => `${e.path} ${e.message}`).join('\n'));
  return channel.send(payload);
}
```

Message and component objects can supply synchronous `toJSON()` methods. A serialization exception produces an issue at the builder’s path. Passing a standalone `ContainerBuilder` checks its layout in isolation. Pass the complete message to also check flags and legacy fields.

## CLI usage

Save a message as `message.json`.

```json
{
  "flags": 32768,
  "components": [{ "type": 10, "content": "Build finished." }]
}
```

Run from the checkout or use the installed command from your bot project.

```sh
node bin/cli.js message.json
npx --no-install v2-validate message.json
```

Success prints `PASS message.json` and exits with status 0. Invalid payloads, unreadable files, malformed JSON, and usage errors exit with status 1. Diagnostics go to standard error.

## Validation rules

- A message containing types 9–14 or 17 needs the `32768` bit in its integer `flags`. Other bits may be present.
- With that bit set, omit top-level `content`, `embeds`, `stickers`, `sticker_ids`, and `poll`, including empty values.
- A layout can contain 40 components in total. The count includes layout wrappers, interactive children, and Section accessories. Gallery items are media entries.
- All Text Displays share a 4,000-character budget measured using JavaScript string length (UTF-16 code units).

| Component | Layout checks |
| --- | --- |
| Action Row (1) | Holds one to five Buttons (2) or a single select menu (3, 5, 6, 7, 8). |
| Section (9) | Has one to three Text Displays and one Button or Thumbnail accessory. |
| Text Display (10) | Requires a non-empty string in `content`. |
| Thumbnail (11) | Appears as a Section accessory and requires a non-blank `media.url`. |
| Media Gallery (12) | Contains one to ten items, each with a non-blank `media.url`. |
| File (13) | Uses `file.url` with an `attachment://` prefix and a filename. The validator also accepts `media.url` and warns to rename the field before sending. |
| Separator (14) | Optional `spacing` is 1 (small) or 2 (large). |
| Container (17) | Groups one or more components of types 1, 9, 10, 12, 13, or 14. Optional `accent_color` accepts an RGB integer from 0 through 16777215, or `null`. |

Validation covers the layout rules above. Interactive component settings such as button styles and select options, attachment uploads, and endpoint-specific requirements are outside its scope. [Discord component reference](https://docs.discord.com/developers/components/reference)

## Development

```sh
npm test
npm run check
```

Released under the [MIT license](LICENSE).
