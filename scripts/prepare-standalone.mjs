import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const rootDir = process.cwd();
const standaloneDir = resolve(rootDir, '.next', 'standalone');
const staticSource = resolve(rootDir, '.next', 'static');
const staticTarget = resolve(standaloneDir, '.next', 'static');
const publicSource = resolve(rootDir, 'public');
const publicTarget = resolve(standaloneDir, 'public');
const standalonePackageJson = resolve(standaloneDir, 'package.json');

function copyDirectory(source, target, label) {
  if (!existsSync(source)) return;
  mkdirSync(join(target, '..'), { recursive: true });
  rmSync(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  cpSync(source, target, { recursive: true });
  process.stdout.write(`Prepared standalone ${label}\n`);
}

if (!existsSync(standaloneDir)) {
  throw new Error('Standalone output was not found. Run next build with output: standalone first.');
}

copyDirectory(staticSource, staticTarget, 'static assets');
copyDirectory(publicSource, publicTarget, 'public assets');

if (existsSync(standalonePackageJson)) {
  const packageJson = JSON.parse(readFileSync(standalonePackageJson, 'utf8'));
  packageJson.scripts = {
    ...(packageJson.scripts || {}),
    start: 'node server.js',
  };
  writeFileSync(standalonePackageJson, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
  process.stdout.write('Prepared standalone package script\n');
}
