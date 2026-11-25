// scripts/migrate/migrate-run.mjs
// Uptimyzas Kitchen -> Chopdesk: the REAL move.
//
// Without --commit it only CHECKS (reads, writes nothing).
// With --commit it writes everything into a new business "Uptimyzas Kitchen",
// verifies the totals, and removes everything it wrote if anything is wrong.
//
// Usage (from the chopdesk folder):
//   node scripts/migrate/migrate-run.mjs <backup folder> --old-env <old .env.local> --secrets <secrets file> [--also-owner "First Last"] [--commit]
//
// The secrets file lives OUTSIDE the project and holds one line:
//   SUPABASE_SERVICE_ROLE_KEY=...
// The Chopdesk address is read from .env.local in the folder you run this from.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { argv, exit, cwd } from 'node:process';
import { createClient } from '@supabase/supabase-js';

// ---------- arguments ----------
const args = argv.slice(2);
let dirArg = null, oldEnvArg = null, secretsArg = null, commit = false;
const alsoOwner = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--commit') commit = true;
  else if (a === '--old-env') oldEnvArg = args[++i];
  else if (a === '--secrets') secretsArg = args[++i];
  else if (a === '--also-owner') alsoOwner.push(String(args[++i] || '').trim().toLowerCase().replace(/\s+/g, ' '));
  else if (!dirArg) dirArg = a;
}
if (!dirArg || !oldEnvArg || !secretsArg) {
  console.error('Usage: node scripts/migrate/migrate-run.mjs <backup folder> --old-env <old .env.local> --secrets <secrets file> [--also-owner "First Last"] [--commit]');
  exit(1);
}
const dir = resolve(dirArg);
const here = dirname(fileURLToPath(import.meta.url));

const stop = (msg, code = 1) => { console.error('\nSTOPPED: ' + msg); exit(code); };
const line = (s = '') => console.log(s);

function readEnv(file) {
  const out = {};
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) { stop('cannot read ' + file + ' (' + e.code + ')'); }
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.replace(/^\uFEFF/, '').trim();
    if (!l || l.startsWith('#')) continue;
    const i = l.indexOf('=');
    if (i < 1) continue;
    out[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

// ---------- 1. the dry run must be clean ----------
line(commit ? 'REAL RUN (--commit)' : 'CHECK ONLY - nothing is written (add --commit for the real move)');
line('Step 1/6  Checking the backup with the dry run...');
const dry = spawnSync(process.execPath, [join(here, 'migrate.mjs'), dir], { encoding: 'utf8' });
if (dry.status !== 0) {
  console.log(dry.stdout);
  stop('the dry run is not clean. Fix what it lists, take a fresh backup, then try again.');
}
const report = JSON.parse(readFileSync(join(dir, 'dry-run-report.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
const NAMES = ['users', 'menu_items', 'shifts', 'shift_assignments', 'shift_stock', 'shift_close', 'orders', 'expenses', 'settings'];
const T = {};
for (const n of NAMES) T[n] = JSON.parse(readFileSync(join(dir, n + '.json'), 'utf8'));
line('          dry run clean.');
// same rule as the dry run: open shifts (and their rows) are left out
{
  const openIds = new Set(T.shifts.filter((s) => !s.closed_at).map((s) => s.id));
  for (const n of ['shift_assignments', 'shift_stock', 'shift_close', 'orders', 'expenses']) T[n] = T[n].filter((r) => !openIds.has(r.shift_id));
  T.shifts = T.shifts.filter((s) => s.closed_at);
}

// ---------- 2. connect to both databases ----------
line('Step 2/6  Connecting...');
const newEnv = readEnv(resolve(cwd(), '.env.local'));
const secrets = readEnv(resolve(secretsArg));
const oldEnv = readEnv(resolve(oldEnvArg));
const newUrl = newEnv.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = secrets.SUPABASE_SERVICE_ROLE_KEY;
if (!newUrl) stop('NEXT_PUBLIC_SUPABASE_URL not found in .env.local of this folder. Run this from C:\\Users\\olayi\\chopdesk.');
if (!serviceKey) stop('SUPABASE_SERVICE_ROLE_KEY not found in the secrets file.');
if (new URL(newUrl).host === manifest.source_host) stop('this folder points at the OLD database, not Chopdesk. Nothing was touched.');
if (new URL(oldEnv.NEXT_PUBLIC_SUPABASE_URL || 'http://x').host !== manifest.source_host) stop('the old .env.local does not match the backup source.');

const target = createClient(newUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const old = createClient(oldEnv.NEXT_PUBLIC_SUPABASE_URL, oldEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY);
{
  const t = await target.from('organizations').select('id', { count: 'exact', head: true });
  if (t.error) stop('cannot reach Chopdesk with that service key: ' + t.error.message);
}

// ---------- 3. what happened in the old app since the backup (information only) ----------
// The move reads ONLY the backup files, so activity in the old app cannot affect it.
async function oldChanges() {
  const notes = [];
  for (const n of NAMES) {
    const r = await old.from(n).select('*', { count: 'exact', head: true });
    if (r.error) { notes.push(n + ': could not check (' + r.error.message + ')'); continue; }
    if (r.count !== manifest.tables[n].rows) notes.push(n + ': ' + (r.count - manifest.tables[n].rows) + ' new row(s) since the backup');
  }
  const open = await old.from('shifts').select('id', { count: 'exact', head: true }).is('closed_at', null);
  if (!open.error && open.count > 0) notes.push(open.count + ' shift(s) open in the old app right now');
  return notes;
}
line('Step 3/6  Looking at the old app (information only, it cannot affect the move)...');
{
  const p = await oldChanges();
  if (p.length) { for (const x of p) line('          ~ ' + x); line('          These are NOT moved. Only the backup is moved.'); }
  else line('          no activity since the backup.');
}

// ---------- 4. prepare the rows ----------
const ORG_NAME = 'Uptimyzas Kitchen';
const ORG_SLUG = 'uptimyzas-kitchen';
const clean = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');
const pick = (r, fields) => { const o = {}; for (const f of fields) if (r[f] !== undefined) o[f] = r[f]; return o; };

const people = T.users.filter((u) => u.status === 'active').map((u) => {
  const first = clean(u.first_name), sur = clean(u.surname);
  const full = (first + ' ' + sur).trim().toLowerCase();
  return { old: u, id: u.id, email: String(u.email).trim().toLowerCase(), hash: u.password_hash, first, sur,
    phone: u.phone ?? null, owner: u.role === 'admin' || alsoOwner.includes(full), created_at: u.created_at };
});
for (const n of alsoOwner) if (!people.some((p) => (p.first + ' ' + p.sur).toLowerCase() === n)) stop('--also-owner "' + n + '" matches nobody in the backup.');

// existing Chopdesk accounts (e.g. you signed up while testing)
const existing = new Map();
for (let page = 1; ; page++) {
  const r = await target.auth.admin.listUsers({ page, perPage: 1000 });
  if (r.error) stop('cannot list Chopdesk accounts: ' + r.error.message);
  for (const u of r.data.users) existing.set(String(u.email || '').toLowerCase(), u.id);
  if (r.data.users.length < 1000) break;
}
const idMap = new Map();      // old user id -> id used in Chopdesk
const toCreate = [];
const reused = [];
for (const p of people) {
  if (existing.has(p.email)) { idMap.set(p.id, existing.get(p.email)); reused.push(p); }
  else { idMap.set(p.id, p.id); toCreate.push(p); }
}
const idOfUser = (id) => idMap.get(id) ?? id;
const slugTaken = await target.from('organizations').select('id').eq('slug', ORG_SLUG);
if (slugTaken.error) stop('cannot check Chopdesk: ' + slugTaken.error.message);
if (slugTaken.data.length) stop('a business with the slug "' + ORG_SLUG + '" already exists in Chopdesk. A previous run may have left it. Tell Claude.');
const idClash = people.filter((p) => !existing.has(p.email)).length && (await (async () => {
  for (const p of toCreate) { const r = await target.auth.admin.getUserById(p.id); if (r.data && r.data.user) return p; }
  return null;
})());
if (idClash) stop('an account with the same id as ' + idClash.first + ' already exists under another email. Tell Claude.');

// shift_close: keep the earliest copy of each (shift, item)
const groups = new Map();
for (const r of T.shift_close) { const k = r.shift_id + '|' + r.item_id; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
const closeKept = [...groups.values()].map((rows) => {
  rows.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || String(a.id).localeCompare(String(b.id)));
  return rows[0];
});

const OWNER_ORDER = (a, b) => Date.parse(a.created_at || 0) - Date.parse(b.created_at || 0);
line('Step 4/6  Ready to write:');
line('          new accounts   ' + toCreate.length + (toCreate.length ? '  (' + toCreate.map((p) => p.first).join(', ') + ')' : ''));
line('          already in Chopdesk (reused, their Chopdesk password is kept)  ' + reused.length + (reused.length ? '  (' + reused.map((p) => p.first + ' ' + p.sur).join(', ') + ')' : ''));
line('          owners         ' + people.filter((p) => p.owner).map((p) => p.first + ' ' + p.sur).join(', '));
line('          orders ' + T.orders.length + ', shifts ' + T.shifts.length + ', stock ' + T.shift_stock.length + ', close ' + closeKept.length + ', expenses ' + T.expenses.length);

if (!commit) {
  line('');
  line('RESULT: CHECK PASSED. Nothing was written. Run again with --commit to do the real move.');
  exit(0);
}

// ---------- 5. write, with undo on any failure ----------
const created = { org: null, users: [] };
async function undo() {
  line('Undoing what was written...');
  if (created.org) {
    const r = await target.from('organizations').delete().eq('id', created.org);
    if (r.error) line('  ! could not delete the business: ' + r.error.message);
  }
  for (const id of created.users) {
    const r = await target.auth.admin.deleteUser(id);
    if (r.error) line('  ! could not delete account ' + id + ': ' + r.error.message);
  }
  line('Undo finished. Chopdesk is back to how it was. The old app is untouched.');
}
async function insertAll(table, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const r = await target.from(table).insert(rows.slice(i, i + 500));
    if (r.error) throw new Error(table + ': ' + r.error.message);
  }
  line('          ' + table.padEnd(18) + String(rows.length).padStart(6));
}

async function write() {
  line('Step 5/6  Writing...');
  const org = await target.from('organizations').insert({ name: ORG_NAME, slug: ORG_SLUG }).select('id').single();
  if (org.error) throw new Error('organizations: ' + org.error.message);
  const orgId = org.data.id;
  created.org = orgId;

  const loc = await target.from('locations').insert({ org_id: orgId, name: 'Main', is_default: true }).select('id').single();
  if (loc.error) throw new Error('locations: ' + loc.error.message);
  const locId = loc.data.id;

  for (const p of toCreate) {
    const r = await target.auth.admin.createUser({
      id: p.id, email: p.email, password_hash: p.hash, email_confirm: true,
      user_metadata: { first_name: p.first, surname: p.sur },
    });
    if (r.error) throw new Error('account for ' + p.first + ': ' + r.error.message);
    created.users.push(r.data.user.id);
    if (r.data.user.id !== p.id) throw new Error('account for ' + p.first + ' got a different id than the old app');
  }
  line('          ' + 'auth accounts'.padEnd(18) + String(toCreate.length).padStart(6));

  const profiles = toCreate.map((p) => ({ id: p.id, first_name: p.first, surname: p.sur, phone: p.phone }));
  if (profiles.length) {
    const r = await target.from('profiles').upsert(profiles, { onConflict: 'id' });
    if (r.error) throw new Error('profiles: ' + r.error.message);
  }
  line('          ' + 'profiles'.padEnd(18) + String(profiles.length).padStart(6));

  await insertAll('memberships', [...people].sort(OWNER_ORDER).map((p) => ({
    org_id: orgId, user_id: idOfUser(p.id), role: p.owner ? 'owner' : 'staff', status: 'active',
    ...(p.created_at ? { created_at: p.created_at } : {}),
  })));
  await insertAll('menu_items', T.menu_items.map((r) => ({ org_id: orgId, ...pick(r, ['id', 'name', 'category', 'price', 'unit', 'available', 'created_at']) })));
  await insertAll('shifts', T.shifts.map((r) => ({
    org_id: orgId, location_id: locId, ...pick(r, ['id', 'opened_at', 'closed_at']),
    opened_by: idOfUser(r.opened_by), closed_by: r.closed_by ? idOfUser(r.closed_by) : null,
  })));
  await insertAll('shift_assignments', T.shift_assignments.map((r) => ({
    org_id: orgId, ...pick(r, ['id', 'shift_id', 'joined_at']), user_id: idOfUser(r.user_id),
  })));
  await insertAll('shift_stock', T.shift_stock.map((r) => ({
    org_id: orgId, ...pick(r, ['id', 'shift_id', 'item_id', 'item_name', 'unit', 'opening_qty', 'added_qty', 'quantity', 'created_at']),
  })));
  await insertAll('shift_close', closeKept.map((r) => ({
    org_id: orgId, ...pick(r, ['id', 'shift_id', 'item_id', 'opening_qty', 'sold_qty', 'actual_remaining', 'variance', 'created_at']),
  })));
  await insertAll('orders', T.orders.map((r) => ({
    org_id: orgId, ...pick(r, ['id', 'shift_id', 'items_json', 'subtotal', 'total', 'payment_method', 'cash_amount', 'transfer_amount', 'change_given', 'created_at']),
    staff_id: idOfUser(r.staff_id),
  })));
  await insertAll('expenses', T.expenses.map((r) => ({
    org_id: orgId, ...pick(r, ['id', 'shift_id', 'description', 'amount', 'payment_method', 'created_at']), staff_id: idOfUser(r.staff_id),
  })));
  const settings = T.settings.map((r) => ({ org_id: orgId, ...pick(r, ['key', 'value', 'updated_at']) }));
  for (const [k, v] of [['stock_threshold_high', '30'], ['stock_threshold_low', '10']]) {
    if (!settings.some((s) => s.key === k)) settings.push({ org_id: orgId, key: k, value: v });
  }
  await insertAll('settings', settings);
  return orgId;
}

// ---------- 6. verify against the control totals ----------
async function fetchAll(table, cols, orgId) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const r = await target.from(table).select(cols).eq('org_id', orgId).order('id', { ascending: true }).range(from, from + 999);
    if (r.error) throw new Error('verify ' + table + ': ' + r.error.message);
    rows.push(...r.data);
    if (r.data.length < 1000) break;
  }
  return rows;
}
const k = (v) => Math.round(Number(v) * 100);
const money = (x) => (x / 100).toFixed(2);
async function verify(orgId) {
  line('Step 6/6  Verifying...');
  const bad = [];
  const want = report.plan;
  const tables = { menu_items: 'id', shifts: 'id', shift_assignments: 'id', shift_stock: 'id', shift_close: 'id', settings: 'id', memberships: 'id' };
  const wantCount = { menu_items: want.menu_items, shifts: want.shifts, shift_assignments: want.shift_assignments, shift_stock: want.shift_stock, shift_close: want.shift_close, settings: Math.max(want.settings, 0), memberships: want.memberships };
  for (const t of Object.keys(tables)) {
    const r = await target.from(t).select('id', { count: 'exact', head: true }).eq('org_id', orgId);
    if (r.error) throw new Error('verify ' + t + ': ' + r.error.message);
    const ok = t === 'settings' ? r.count >= wantCount[t] : r.count === wantCount[t];
    if (!ok) bad.push(t + ': ' + r.count + ' rows, expected ' + wantCount[t]);
  }
  const orders = await fetchAll('orders', 'id,total,cash_amount,transfer_amount,payment_method,created_at', orgId);
  const exp = await fetchAll('expenses', 'id,amount', orgId);
  let rev = 0, cash = 0, tr = 0, first = Infinity, last = -Infinity;
  const methods = {};
  for (const o of orders) {
    rev += k(o.total); cash += k(o.cash_amount); tr += k(o.transfer_amount);
    const t = Date.parse(o.created_at); if (t < first) first = t; if (t > last) last = t;
    methods[o.payment_method] = (methods[o.payment_method] || 0) + 1;
  }
  const expTotal = exp.reduce((s, e) => s + k(e.amount), 0);
  const w = report.totals;
  const cmp = (name, got, exp2) => { const ok = String(got) === String(exp2); line('          ' + (ok ? 'ok  ' : 'BAD ') + name.padEnd(14) + String(got).padStart(14) + (ok ? '' : '   expected ' + exp2)); if (!ok) bad.push(name + ': ' + got + ' vs ' + exp2); };
  cmp('orders', orders.length, w.orders);
  cmp('revenue_ngn', money(rev), w.revenue_ngn);
  cmp('cash_ngn', money(cash), w.cash_ngn);
  cmp('transfer_ngn', money(tr), w.transfer_ngn);
  cmp('expenses_ngn', money(expTotal), w.expenses_ngn);
  cmp('expenses', exp.length, want.expenses);
  cmp('first_order', new Date(first).toISOString(), w.first_order);
  cmp('last_order', new Date(last).toISOString(), w.last_order);
  const wantMethods = {};
  for (const o of T.orders) wantMethods[o.payment_method] = (wantMethods[o.payment_method] || 0) + 1;
  cmp('methods', JSON.stringify(Object.entries(methods).sort()), JSON.stringify(Object.entries(wantMethods).sort()));
  // every person can log in to the new business
  const m = await target.from('memberships').select('user_id,role,status').eq('org_id', orgId);
  if (m.error) throw new Error('verify memberships: ' + m.error.message);
  if (m.data.some((x) => x.status !== 'active')) bad.push('a membership is not active');
  if (!m.data.some((x) => x.role === 'owner')) bad.push('no owner');
  return bad;
}

let orgId = null;
try {
  orgId = await write();
  const bad = await verify(orgId);
  if (bad.length) throw new Error('totals do not match:\n  - ' + bad.join('\n  - '));
} catch (e) {
  console.error('\nFAILED: ' + e.message);
  await undo();
  exit(4);
}

// ---------- done: leave files behind ----------
writeFileSync(join(dir, 'migration-result.json'), JSON.stringify({
  done_at: new Date().toISOString(), org_id: orgId, org_slug: ORG_SLUG, reused_existing_accounts: reused.map((p) => p.email),
  created_accounts: toCreate.map((p) => p.email),
}, null, 2), 'utf8');
// fallback, only if someone cannot log in with their old password: run in the Supabase SQL editor
const sqlQ = (s) => "'" + String(s).replace(/'/g, "''") + "'";
writeFileSync(join(dir, 'restore-passwords.sql'),
  '-- ONLY if a migrated person cannot log in with their old password. Keep private: it holds password hashes.\n' +
  toCreate.map((p) => 'update auth.users set encrypted_password = ' + sqlQ(p.hash) + ', updated_at = now() where id = ' + sqlQ(p.id) + ';').join('\n') + '\n', 'utf8');

const after = await oldChanges();
line('');
line('RESULT: MOVE COMPLETE. All totals match. Files saved in the backup folder: migration-result.json, restore-passwords.sql');
if (after.length) {
  line('');
  line('LEFT OUT (not in Chopdesk yet, because it happened after the backup or was still open):');
  for (const a of after) line('  ~ ' + a);
  line('Do not delete anything in the old app. Tell Claude: the leftovers can be added later.');
}
line('Next: log in to Chopdesk with your OLD email and password and check Order History.');
exit(0);
