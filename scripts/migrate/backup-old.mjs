// scripts/migrate/backup-old.mjs
// Read-only backup of the old Uptimyzas Kitchen database to JSON files.
// Usage: node scripts/migrate/backup-old.mjs <path to the OLD project's .env.local>
// Writes to a new folder next to the project: ..\uptimyzas-backup-<date-time>
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { argv, cwd, exit } from 'node:process';
import { createClient } from '@supabase/supabase-js';

const envPath = argv[2];
if (!envPath) {
  console.error('Usage: node scripts/migrate/backup-old.mjs <path to old .env.local>');
  exit(1);
}

function readEnv(file) {
  const out = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = readEnv(resolve(envPath));
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('PROBLEM: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY not found in that file.');
  exit(1);
}

const supabase = createClient(url, key);
const TABLES = [
  'users', 'menu_items', 'shifts', 'shift_assignments', 'shift_stock', 'shift_close',
  'orders', 'expenses', 'settings', 'chat_messages', 'audit_logs', 'login_attempts',
];
const PAGE = 1000;

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = resolve(cwd(), '..', 'uptimyzas-backup-' + stamp);
mkdirSync(join(outDir, 'chat-media'), { recursive: true });

const manifest = { created_at: new Date().toISOString(), source_host: new URL(url).host, tables: {}, chat_media: {} };
let problems = 0;
let chatRows = [];

for (const table of TABLES) {
  const head = await supabase.from(table).select('*', { count: 'exact', head: true });
  if (head.error) {
    manifest.tables[table] = { status: 'ERROR', message: head.error.message };
    console.log('PROBLEM  ' + table + ': ' + head.error.message);
    problems++;
    continue;
  }
  const expected = head.count ?? 0;
  const rows = [];
  let failed = null;
  for (let from = 0; from < expected; from += PAGE) {
    const page = await supabase.from(table).select('*').order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (page.error) { failed = page.error.message; break; }
    rows.push(...page.data);
  }
  if (failed) {
    manifest.tables[table] = { status: 'ERROR', message: failed };
    console.log('PROBLEM  ' + table + ': ' + failed);
    problems++;
    continue;
  }
  writeFileSync(join(outDir, table + '.json'), JSON.stringify(rows, null, 2), 'utf8');
  const same = rows.length === expected;
  manifest.tables[table] = { status: same ? 'ok' : 'CHANGED_DURING_BACKUP', rows: rows.length, counted_before: expected };
  console.log((same ? 'ok       ' : 'CHANGED  ') + table.padEnd(18) + String(rows.length).padStart(6) + ' rows');
  if (!same) problems++;
  if (table === 'chat_messages') chatRows = rows;
}

// chat photos / voice notes live in storage; keep a copy of the files too
let mediaOk = 0;
let mediaFailed = 0;
for (const row of chatRows) {
  for (const link of [row.image_url, row.voice_url]) {
    if (!link) continue;
    try {
      const res = await globalThis.fetch(link);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const name = decodeURIComponent(new URL(link).pathname.split('/').pop()).replace(/[^A-Za-z0-9._-]/g, '_');
      writeFileSync(join(outDir, 'chat-media', name), Buffer.from(await res.arrayBuffer()));
      mediaOk++;
    } catch (e) {
      mediaFailed++;
      manifest.chat_media[link] = 'FAILED: ' + e.message;
      console.log('PROBLEM  chat file not saved: ' + link + ' (' + e.message + ')');
    }
  }
}
console.log('chat files saved: ' + mediaOk + ', failed: ' + mediaFailed);
if (mediaFailed > 0) problems++;

writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
console.log('');
console.log('Backup folder: ' + outDir);
console.log('NOTE: users.json contains password hashes. Keep it on this PC. Do not upload or commit it.');
console.log(problems === 0 ? 'RESULT: backup complete, no problems.' : 'RESULT: ' + problems + ' problem(s) above.');
exit(problems === 0 ? 0 : 2);