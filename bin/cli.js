#!/usr/bin/env node
'use strict';

const { readFileSync } = require('node:fs');
const { validatePayload } = require('../src');

function main(args) {
  if (args.length !== 1) {
    console.error('Usage: v2-validate <file.json>');
    return 1;
  }
  const [file] = args;
  try {
    const payload = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    const { valid, errors, warnings } = validatePayload(payload);
    for (const { path, code, message } of warnings) {
      console.error(`WARN ${path} [${code}] ${message}`);
    }
    if (valid) {
      console.log(`PASS ${file}`);
      return 0;
    }
    console.error(`FAIL ${file}`);
    for (const { path, code, message } of errors) {
      console.error(`  ${path} [${code}] ${message}`);
    }
  } catch (error) {
    console.error(`FAIL ${file}: ${error.message}`);
  }
  return 1;
}

process.exitCode = main(process.argv.slice(2));
