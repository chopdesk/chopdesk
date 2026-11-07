// scripts/migrate/migrate.mjs
// Uptimyzas Kitchen -> Chopdesk migration. Current mode: DRY RUN ONLY.
// Reads the JSON backup folder, checks every rule Chopdesk enforces, prints a report.
// It connects to NO database and changes NOTHING (it only writes dry-run-report.json
// into the backup folder).
// Usage: node scripts/migrate/migrate.mjs <backup folder>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { argv, exit } from 'node:process';

const dirArg = argv[2];
if (!dirArg) {
  console.error('Usage: node scripts/migrate/migrate.mjs <backup folder>');
  exit(1);
}
const dir = resolve(dirArg);

const NAMES = [
  'users', 'menu_items', 'shifts', 'shift_assignments', 'shift_stock', 'shift_close',
  'orders', 'expenses', 'settings', 'chat_messages', 'audit_logs', 'login_attempts',
];
const T = {};
let manifest;
try {
  manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  for (const n of NAMES) {
    const f = join(dir, n + '.json');
    if (!existsSync(f)) throw new Error('missing file ' + n + '.json');
    T[n] = JSON.parse(readFileSync(f, 'utf8'));
  }
} catch (e) {
  console.error('PROBLEM: cannot read the backup folder: ' + e.message);
  exit(1);
}

const blockers = [];
const warnings = [];
const notes = [];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
const kobo = (v) => Math.round(num(v) * 100);
const money = (k) => (k / 100).toFixed(2);
const countWhere = (rows, fn) => rows.reduce((n, r) => (fn(r) ? n + 1 : n), 0);
const add = (list, cond, msg) => { if (cond) list.push(msg); };
const keyOf = (r, a, b) => r[a] + '|' + r[b];

// ---- backup integrity ----
for (const n of NAMES) {
  const m = manifest.tables && manifest.tables[n];
  add(blockers, !m || m.status !== 'ok' || m.rows !== T[n].length, 'backup file ' + n + '.json does not match its manifest entry');
}

// ---- people ----
const active = T.users.filter((u) => u.status === 'active');
const left = T.users.filter((u) => u.status !== 'active');
const activeIds = new Set(active.map((u) => u.id));
const emails = new Map();
for (const u of active) {
  const who = (String(u.first_name) + ' ' + String(u.surname)).trim() || String(u.id);
  add(blockers, !UUID.test(String(u.id)), 'user ' + who + ': id is not a uuid');
  add(blockers, typeof u.email !== 'string' || !u.email.includes('@'), 'user ' + who + ': email missing or invalid');
  add(blockers, !/^\$2[aby]\$\d\d\$.{53}$/.test(String(u.password_hash || '')), 'user ' + who + ': password hash is not bcrypt');
  add(blockers, u.role !== 'admin' && u.role !== 'staff', 'user ' + who + ': unknown role "' + u.role + '"');
  add(blockers, typeof u.first_name !== 'string' || typeof u.surname !== 'string', 'user ' + who + ': first name or surname missing');
  const e = String(u.email).toLowerCase();
  emails.set(e, (emails.get(e) || 0) + 1);
}
for (const [e, n] of emails) add(blockers, n > 1, n + ' active users share one email (' + e.replace(/^.*@/, '*@') + ')');
const owners = countWhere(active, (u) => u.role === 'admin');
add(blockers, owners < 1, 'no active admin, so the business would have no owner');
const notLower = countWhere(active, (u) => typeof u.email === 'string' && u.email !== u.email.toLowerCase());
add(notes, notLower > 0, notLower + ' email(s) will be lowercased');

// ---- references ----
const shiftIds = new Set(T.shifts.map((s) => s.id));
const menuIds = new Set(T.menu_items.map((m) => m.id));
function refs(label, rows, field, idSet, allowNull) {
  const bad = countWhere(rows, (r) => (r[field] === null || r[field] === undefined ? !allowNull : !idSet.has(r[field])));
  add(blockers, bad > 0, bad + ' ' + label + ' point to something that is not migrating');
}
refs('orders (staff)', T.orders, 'staff_id', activeIds, false);
refs('expenses (staff)', T.expenses, 'staff_id', activeIds, false);
refs('shifts (opened_by)', T.shifts, 'opened_by', activeIds, false);
refs('shifts (closed_by)', T.shifts, 'closed_by', activeIds, true);
refs('shift_assignments (user)', T.shift_assignments, 'user_id', activeIds, false);
refs('orders (shift)', T.orders, 'shift_id', shiftIds, false);
refs('expenses (shift)', T.expenses, 'shift_id', shiftIds, false);
refs('shift_assignments (shift)', T.shift_assignments, 'shift_id', shiftIds, false);
refs('shift_stock (shift)', T.shift_stock, 'shift_id', shiftIds, false);
refs('shift_close (shift)', T.shift_close, 'shift_id', shiftIds, false);

// ---- shifts ----
const openShifts = countWhere(T.shifts, (s) => !s.closed_at);
add(blockers, openShifts > 0, openShifts + ' shift(s) still open in the old app. Close it there first, then take a fresh backup');
add(blockers, countWhere(T.shifts, (s) => Boolean(s.closed_at) !== Boolean(s.closed_by)) > 0, 'some shifts have closed_at and closed_by out of step (Chopdesk requires both or neither)');
add(blockers, countWhere(T.shifts, (s) => !s.opened_at) > 0, 'some shifts have no opened_at');
add(warnings, countWhere(T.shifts, (s) => s.closed_at && s.opened_at && Date.parse(s.closed_at) < Date.parse(s.opened_at)) > 0, 'some shifts close before they open (copied as they are)');

// ---- menu ----
add(blockers, countWhere(T.menu_items, (m) => typeof m.name !== 'string' || typeof m.category !== 'string' || typeof m.unit !== 'string' || !(num(m.price) >= 0) || typeof m.available !== 'boolean') > 0, 'some menu items have a missing field or a negative price');

// ---- stock, assignments, settings ----
const seen = new Set();
let dupStock = 0;
for (const r of T.shift_stock) { const k = keyOf(r, 'shift_id', 'item_id'); if (seen.has(k)) dupStock++; seen.add(k); }
add(blockers, dupStock > 0, dupStock + ' duplicate shift_stock rows (Chopdesk allows one per shift and item)');
add(blockers, countWhere(T.shift_stock, (r) => ![r.opening_qty, r.added_qty, r.quantity].every((v) => Number.isInteger(v) && v >= 0) || typeof r.item_name !== 'string' || typeof r.unit !== 'string') > 0, 'some shift_stock rows have negative or non-whole quantities or missing names');
const seenA = new Set();
let dupAssign = 0;
for (const r of T.shift_assignments) { const k = keyOf(r, 'shift_id', 'user_id'); if (seenA.has(k)) dupAssign++; seenA.add(k); }
add(blockers, dupAssign > 0, dupAssign + ' duplicate shift_assignments rows');
const keys = new Set();
let dupKeys = 0;
for (const r of T.settings) { if (keys.has(r.key)) dupKeys++; keys.add(r.key); }
add(blockers, dupKeys > 0 || countWhere(T.settings, (r) => typeof r.key !== 'string' || typeof r.value !== 'string') > 0, 'settings have a repeated key or a missing value');

// ---- shift_close: keep the earliest copy of any repeated row ----
const groups = new Map();
for (const r of T.shift_close) {
  const k = keyOf(r, 'shift_id', 'item_id');
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}
const closeKept = [];
let dupGroups = 0;
let closeDropped = 0;
let conflicting = 0;
for (const rows of groups.values()) {
  rows.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || String(a.id).localeCompare(String(b.id)));
  closeKept.push(rows[0]);
  if (rows.length > 1) {
    dupGroups++;
    closeDropped += rows.length - 1;
    const sig = new Set(rows.map((r) => [r.opening_qty, r.sold_qty, r.actual_remaining, r.variance].join('/')));
    if (sig.size > 1) conflicting++;
  }
}
add(blockers, conflicting > 0, conflicting + ' repeated shift_close item(s) have copies with different numbers - needs your decision');
add(blockers, countWhere(closeKept, (r) => ![r.opening_qty, r.sold_qty, r.actual_remaining, r.variance].every((v) => Number.isInteger(v)) || r.actual_remaining < 0) > 0, 'some shift_close rows have non-whole numbers or a negative count');
notes.push('shift_close: ' + dupGroups + ' item(s) were saved more than once (' + closeDropped + ' identical extra copies). The earliest copy of each is kept.');
add(warnings, dupGroups !== 27 || closeDropped !== 702, 'repeated shift_close rows are ' + dupGroups + ' items / ' + closeDropped + ' extra copies, but earlier analysis found 27 / 702');
const stockKeys = new Set(T.shift_stock.map((r) => keyOf(r, 'shift_id', 'item_id')));
const closeKeys = new Set(closeKept.map((r) => keyOf(r, 'shift_id', 'item_id')));
const stockNoClose = [...stockKeys].filter((k) => !closeKeys.has(k)).length;
const closeNoStock = [...closeKeys].filter((k) => !stockKeys.has(k)).length;
add(warnings, stockNoClose > 0 || closeNoStock > 0, stockNoClose + ' stock row(s) have no close row and ' + closeNoStock + ' close row(s) have no stock row');

// ---- orders ----
let itemsBad = 0;
let sumOff = 0;
let partsOff = 0;
let negOrders = 0;
const unknownMenu = new Set();
const methods = {};
let revenue = 0;
let cash = 0;
let transfer = 0;
let firstOrder = null;
let lastOrder = null;
for (const o of T.orders) {
  const items = o.items_json;
  const ok = Array.isArray(items) && items.length > 0 && items.every((i) => i && typeof i.item_id === 'string' && typeof i.name === 'string' && Number.isFinite(num(i.qty)) && Number.isFinite(num(i.unit_price)) && Number.isFinite(num(i.subtotal)));
  if (!ok) itemsBad++;
  else {
    let s = 0;
    for (const i of items) { s += kobo(i.subtotal); if (!menuIds.has(i.item_id)) unknownMenu.add(i.item_id); }
    if (s !== kobo(o.total)) sumOff++;
  }
  if (!(num(o.subtotal) >= 0) || !(num(o.total) >= 0) || !(num(o.cash_amount) >= 0) || !(num(o.transfer_amount) >= 0) || !(num(o.change_given) >= 0) || typeof o.payment_method !== 'string') negOrders++;
  if (kobo(o.cash_amount) + kobo(o.transfer_amount) !== kobo(o.total)) partsOff++;
  methods[o.payment_method] = (methods[o.payment_method] || 0) + 1;
  revenue += kobo(o.total);
  cash += kobo(o.cash_amount);
  transfer += kobo(o.transfer_amount);
  const t = Date.parse(o.created_at);
  if (firstOrder === null || t < firstOrder) firstOrder = t;
  if (lastOrder === null || t > lastOrder) lastOrder = t;
}
add(blockers, negOrders > 0, negOrders + ' orders have a negative or missing amount or payment method');
add(warnings, itemsBad > 0, itemsBad + ' orders have an item list the app cannot display (copied as they are)');
add(warnings, sumOff > 0, sumOff + ' orders where the items do not add up to the total (copied as they are)');
add(warnings, partsOff > 0, partsOff + ' orders where cash + transfer is not the total (copied as they are)');
add(notes, unknownMenu.size > 0, unknownMenu.size + ' menu item(s) in old orders no longer exist on the menu (the order history still shows them by name)');

// ---- expenses ----
let expenses = 0;
for (const e of T.expenses) expenses += kobo(e.amount);
add(blockers, countWhere(T.expenses, (e) => !(num(e.amount) >= 0) || typeof e.description !== 'string' || e.description === '' || typeof e.payment_method !== 'string') > 0, 'some expenses have a negative amount or a missing description or payment method');

// ---- the plan and the report ----
const plan = {
  organizations: 1, locations: 1, auth_users: active.length, profiles: active.length, memberships: active.length,
  menu_items: T.menu_items.length, shifts: T.shifts.length, shift_assignments: T.shift_assignments.length,
  shift_stock: T.shift_stock.length, shift_close: closeKept.length, orders: T.orders.length,
  expenses: T.expenses.length, settings: T.settings.length,
};
const totals = {
  orders: T.orders.length,
  revenue_ngn: money(revenue), cash_ngn: money(cash), transfer_ngn: money(transfer), expenses_ngn: money(expenses),
  first_order: firstOrder === null ? null : new Date(firstOrder).toISOString(),
  last_order: lastOrder === null ? null : new Date(lastOrder).toISOString(),
};
const leftBehind = {
  users_not_migrating: left.map((u) => String(u.first_name) + ' ' + String(u.surname) + ' (' + u.status + ')'),
  chat_messages: T.chat_messages.length, audit_logs: T.audit_logs.length, login_attempts: T.login_attempts.length,
  shift_close_extra_copies: closeDropped,
  user_fields_dropped: 'additional_phone, is_student, state, city, address, approved_at, declined_at',
};

const line = (s) => console.log(s);
line('DRY RUN - nothing is written anywhere');
line('Backup: ' + dir);
line('Taken:  ' + manifest.created_at + ' from ' + manifest.source_host);
line('');
line('PEOPLE who will get a login (' + active.length + '):');
for (const u of [...active].sort((a, b) => String(a.first_name).localeCompare(String(b.first_name)))) {
  line('  ' + (String(u.first_name) + ' ' + String(u.surname)).padEnd(28) + (u.role === 'admin' ? 'owner' : 'staff'));
}
line('');
line('PLAN - rows that will be written to Chopdesk:');
for (const [k, v] of Object.entries(plan)) line('  ' + k.padEnd(20) + String(v).padStart(6));
line('');
line('LEFT BEHIND:');
line('  users not migrating: ' + (leftBehind.users_not_migrating.join(', ') || 'none'));
line('  chat_messages ' + leftBehind.chat_messages + ', audit_logs ' + leftBehind.audit_logs + ', login_attempts ' + leftBehind.login_attempts + ' (all in the backup folder)');
line('  extra shift_close copies: ' + closeDropped);
line('  user fields dropped: ' + leftBehind.user_fields_dropped);
line('');
line('CONTROL TOTALS (the real run must match these in Chopdesk):');
for (const [k, v] of Object.entries(totals)) line('  ' + k.padEnd(14) + ' ' + v);
line('  order payment methods: ' + Object.entries(methods).map(([k, v]) => k + ' ' + v).join(', '));
line('');
line('BLOCKERS (' + blockers.length + ')' + (blockers.length ? ' - these must be fixed before the real run:' : ''));
for (const b of blockers) line('  X ' + b);
line('WARNINGS (' + warnings.length + ')' + (warnings.length ? ':' : ''));
for (const w of warnings) line('  ! ' + w);
line('NOTES (' + notes.length + ')' + (notes.length ? ':' : ''));
for (const n of notes) line('  - ' + n);
line('');

writeFileSync(join(dir, 'dry-run-report.json'), JSON.stringify({ made_at: new Date().toISOString(), backup_taken: manifest.created_at, plan, totals, leftBehind, blockers, warnings, notes }, null, 2), 'utf8');
line(blockers.length === 0 ? 'RESULT: DRY RUN CLEAN. Nothing was changed anywhere. Report saved as dry-run-report.json in the backup folder.' : 'RESULT: ' + blockers.length + ' BLOCKER(S). Nothing was changed anywhere.');
exit(blockers.length === 0 ? 0 : 3);