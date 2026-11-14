import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const dir = 'tests';
const files = readdirSync(dir)
  .filter(f => f.endsWith('.test.mjs'))
  .sort()
  .map(f => join(dir, f));

if (!files.length) {
  console.error(`Nenhum teste encontrado em ${dir}/`);
  process.exit(1);
}

const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
