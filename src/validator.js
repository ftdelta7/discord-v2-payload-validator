'use strict';

const V2_FLAG = 1 << 15;
const v2Types = [9, 10, 11, 12, 13, 14, 17];
const containerTypes = [1, 9, 10, 12, 13, 14];
const topLevelTypes = [...containerTypes, 17];
const selectTypes = [3, 5, 6, 7, 8];
const rowTypes = [2, ...selectTypes];
const legacyFields = ['content', 'embeds', 'stickers', 'sticker_ids', 'poll'];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validatePayload(input) {
  const errors = [];
  const warnings = [];
  let componentCount = 0;
  let textLength = 0;
  let usesV2 = false;

  function error(path, code, message) {
    errors.push({ path, code, message });
  }

  function asObject(value, path) {
    try {
      if (typeof value?.toJSON === 'function') value = value.toJSON();
    } catch (cause) {
      error(path, 'SERIALIZATION_FAILED', `toJSON() failed: ${cause?.message ?? cause}`);
      return;
    }
    if (isObject(value)) return value;
    error(path, 'EXPECTED_OBJECT', 'Expected an object.');
  }

  function checkMedia(media, path, attachment = false) {
    const url = media?.url;
    if (typeof url !== 'string' || !url.trim()) {
      error(`${path}.url`, 'MEDIA_URL', 'Supply a non-empty media URL.');
    } else if (attachment && !(url.startsWith('attachment://') && url.slice(13).trim())) {
      error(`${path}.url`, 'FILE_URL', 'Use attachment:// followed by a filename.');
    }
  }

  function children(node, path, allowed, min, max) {
    const list = node.components;
    if (!Array.isArray(list)) {
      error(path, 'EXPECTED_ARRAY', 'Expected a components array.');
      return;
    }
    if (list.length < min || list.length > max) {
      error(path, 'CHILD_COUNT', `Expected ${min} to ${max} children, received ${list.length}.`);
    }
    for (let i = 0; i < list.length; i++) {
      const childPath = `${path}[${i}]`;
      const type = visit(list[i], childPath, allowed);
      if (node.type === 1 && selectTypes.includes(type) && list.length !== 1) {
        error(childPath, 'ROW_SELECT', 'A select menu must be the only component in its row.');
      }
    }
  }

  function visit(value, path, allowed) {
    const node = asObject(value, path);
    if (!node) return;
    const { type } = node;
    componentCount++;
    if (v2Types.includes(type)) usesV2 = true;
    if (!allowed.includes(type)) {
      error(`${path}.type`, 'COMPONENT_TYPE', `Expected one of the component types: ${allowed.join(', ')}.`);
      return type;
    }
    switch (type) {
      case 1:
        children(node, `${path}.components`, rowTypes, 1, 5);
        break;
      case 9:
        children(node, `${path}.components`, [10], 1, 3);
        visit(node.accessory, `${path}.accessory`, [11, 2]);
        break;
      case 10:
        if (typeof node.content !== 'string' || !node.content.length) {
          error(`${path}.content`, 'TEXT_CONTENT', 'Supply a non-empty string.');
        } else {
          textLength += node.content.length;
        }
        break;
      case 11:
        checkMedia(node.media, `${path}.media`);
        break;
      case 12:
        if (!Array.isArray(node.items) || node.items.length < 1 || node.items.length > 10) {
          error(`${path}.items`, 'GALLERY_SIZE', 'Supply 1 to 10 gallery items.');
        } else {
          for (const [i, item] of node.items.entries()) {
            checkMedia(item?.media, `${path}.items[${i}].media`);
          }
        }
        break;
      case 13: {
        const alias = node.file === undefined && node.media !== undefined;
        if (alias) {
          warnings.push({ path: `${path}.media`, code: 'FILE_MEDIA_ALIAS',
            message: 'Rename media to file before sending this component to Discord.' });
        }
        const field = alias ? 'media' : 'file';
        checkMedia(node[field], `${path}.${field}`, true);
        break;
      }
      case 14:
        if (node.spacing !== undefined && ![1, 2].includes(node.spacing)) {
          error(`${path}.spacing`, 'SEPARATOR_SPACING', 'Use spacing 1 or 2.');
        }
        break;
      case 17: {
        const color = node.accent_color;
        if (color != null && (!Number.isInteger(color) || color < 0 || color > 0xffffff)) {
          error(`${path}.accent_color`, 'ACCENT_COLOR', 'Use a 24-bit RGB integer or null.');
        }
        children(node, `${path}.components`, containerTypes, 1, 40);
        break;
      }
    }
    return type;
  }

  const payload = asObject(input, '$');
  if (payload) {
    const standalone = payload.type === 17 && typeof input.toJSON === 'function';
    if (standalone) {
      visit(payload, '$', [17]);
    } else {
      const flags = payload.flags;
      const flagsValid = Number.isSafeInteger(flags) && flags >= 0;
      const enabled = flagsValid && (flags & V2_FLAG) !== 0;
      if (flags !== undefined && !flagsValid) {
        error('$.flags', 'INVALID_FLAGS', 'Use a non-negative integer bitfield.');
      }
      if (enabled) {
        for (const key of legacyFields) {
          if (payload[key] !== undefined) {
            error(`$.${key}`, 'LEGACY_FIELD', `Omit ${key} when using Components V2.`);
          }
        }
      }
      if (payload.type !== undefined) {
        error('$.type', 'EXPECTED_MESSAGE', 'Wrap raw components in a message payload.');
      }
      if (payload.components !== undefined) {
        children(payload, '$.components', topLevelTypes, 0, 40);
      }
      if (usesV2 && !enabled) {
        error('$.flags', 'MISSING_V2_FLAG', 'Set the IS_COMPONENTS_V2 flag (32768).');
      }
    }
    if (componentCount > 40) {
      error('$', 'COMPONENT_LIMIT', `Found ${componentCount} components. The maximum is 40.`);
    }
    if (textLength > 4000) {
      error('$', 'TEXT_LIMIT', `Text displays total ${textLength} characters. The maximum is 4000.`);
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

module.exports = { validatePayload };
