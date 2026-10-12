import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { i18nAssistantSchema } from '../server/src/schema.js';

// Serialize the typed schema source to the committed JSON Schema that the
// documented `$schema` URL serves. Run with `bun run schema:build`.
const outFile = fileURLToPath(new URL('../schema/i18n-assistant.schema.json', import.meta.url));
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(i18nAssistantSchema, null, 2) + '\n');
console.log('Wrote ' + outFile);
