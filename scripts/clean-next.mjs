import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const targets = ['.next', '.next-dev'];

for (const target of targets) {
  const absolutePath = resolve(process.cwd(), target);
  if (!existsSync(absolutePath)) continue;
  rmSync(absolutePath, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 250,
  });
  process.stdout.write(`Removed ${target}\n`);
}
