import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { i18nAssistantSchema } from '../server/src/schema.js';

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
}

const ajv = new Ajv({ allErrors: true });
// The schema is a plain typed object; cast to Ajv's expected schema input.
const validate = ajv.compile(i18nAssistantSchema as any);

test('the example config file validates against the schema', () => {
  const example = readJson('../.zed/i18n-assistant.example.json');
  assert.equal(validate(example), true, ajv.errorsText(validate.errors));
});

test('the schema rejects unknown keys, a bad localeDirsMode, and a package without root', () => {
  assert.equal(validate({ defaultLocale: 'en-US', packages: [{ root: 'apps/web', localeDirsMode: 'override' }] }), true, ajv.errorsText(validate.errors));
  assert.equal(validate({ unknownKey: true }), false);
  assert.equal(validate({ packages: [{ root: 'apps/web', localeDirsMode: 'merge' }] }), false);
  assert.equal(validate({ packages: [{ defaultLocale: 'en' }] }), false);
});

test('the committed schema file matches the source object', () => {
  const committed = readJson('../schema/i18n-assistant.schema.json');
  assert.deepEqual(committed, JSON.parse(JSON.stringify(i18nAssistantSchema)));
});
