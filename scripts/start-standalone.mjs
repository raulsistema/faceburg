import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const serverPath = path.join(rootDir, '.next', 'standalone', 'server.js');

function stripInlineComment(value) {
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const previous = value[index - 1];

    if (char === "'" && !inDoubleQuote && previous !== '\\') {
      inSingleQuote = !inSingleQuote;
    } else if (char === '"' && !inSingleQuote && previous !== '\\') {
      inDoubleQuote = !inDoubleQuote;
    } else if (char === '#' && !inSingleQuote && !inDoubleQuote) {
      return value.slice(0, index).trim();
    }
  }

  return value.trim();
}

function parseEnvValue(rawValue) {
  const value = stripInlineComment(rawValue);
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'");
  }
  return value;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = parseEnvValue(rawValue);
  }
}

loadEnvFile(path.join(rootDir, '.env'));
loadEnvFile(path.join(rootDir, '.env.local'));

if (!fs.existsSync(serverPath)) {
  throw new Error('Standalone server not found. Run npm run build before npm start.');
}

await import(pathToFileURL(serverPath).href);
