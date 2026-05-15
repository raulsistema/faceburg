import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const serverPath = path.join(rootDir, '.next', 'standalone', 'server.js');
const standaloneDir = path.dirname(serverPath);

function readTextIfExists(filePath) {
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8').trim();
}

function copyDirIfExists(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) return;
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });
}

function syncStandaloneAssets() {
  const sourceBuildIdPath = path.join(rootDir, '.next', 'BUILD_ID');
  const markerPath = path.join(standaloneDir, '.faceburg-static-build-id');
  const sourceBuildId = readTextIfExists(sourceBuildIdPath);
  const copiedBuildId = readTextIfExists(markerPath);
  const sourceStaticDir = path.join(rootDir, '.next', 'static');
  const standaloneStaticDir = path.join(standaloneDir, '.next', 'static');
  const sourcePublicDir = path.join(rootDir, 'public');
  const standalonePublicDir = path.join(standaloneDir, 'public');

  if (sourceBuildId && sourceBuildId !== copiedBuildId) {
    copyDirIfExists(sourceStaticDir, standaloneStaticDir);
    fs.writeFileSync(markerPath, sourceBuildId);
  }

  if (fs.existsSync(sourcePublicDir) && !fs.existsSync(standalonePublicDir)) {
    fs.cpSync(sourcePublicDir, standalonePublicDir, { recursive: true });
  }
}

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

syncStandaloneAssets();
process.chdir(standaloneDir);
await import(pathToFileURL(serverPath).href);
