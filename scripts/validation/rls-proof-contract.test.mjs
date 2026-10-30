import test from 'node:test';
import assert from 'node:assert/strict';
import { SOURCE_TABLES, assertDisposableTarget, assertIsolationCounts } from './rls-proof-contract.mjs';
const safe = () => Object.fromEntries(SOURCE_TABLES.map(t => [t, { own: 1, foreign: 0 }]));
test('disposable database with explicit confirmation and no CRM tables is allowed', () =>
  assert.equal(assertDisposableTarget('sultan_rls_disposable_test01','I_CONFIRM_DISPOSABLE_ONLY',[]),true));
for (const name of ['postgres','production','luzione','sultan_rls_disposable_','sultan_rls_disposable_X']) {
  test(`refuses database name ${name}`, () => assert.throws(() => assertDisposableTarget(name,'I_CONFIRM_DISPOSABLE_ONLY',[]), /CONFIRMATION_REQUIRED/));
}
test('refuses missing confirmation', () => assert.throws(() => assertDisposableTarget('sultan_rls_disposable_test01','YES',[]), /CONFIRMATION_REQUIRED/));
for (const table of SOURCE_TABLES) {
  test(`refuses preexisting ${table}`, () => assert.throws(() => assertDisposableTarget('sultan_rls_disposable_test01','I_CONFIRM_DISPOSABLE_ONLY',[table]), /NOT_EMPTY/));
}
test('accepts complete two-tenant RLS proof', () => assert.equal(assertIsolationCounts(safe(),'luzione'),true));
for (const table of SOURCE_TABLES) {
  test(`rejects cross-tenant visibility in ${table}`, () => {const c=safe();c[table].foreign=1;assert.throws(()=>assertIsolationCounts(c,'luzione'),/ISOLATION_FAILED/)});
  test(`rejects missing own record in ${table}`, () => {const c=safe();c[table].own=0;assert.throws(()=>assertIsolationCounts(c,'luzione'),/ISOLATION_FAILED/)});
}
test('rejects missing source coverage', () => {const c=safe();delete c.crm_leads;assert.throws(()=>assertIsolationCounts(c,'luzione'),/ISOLATION_FAILED/)});
