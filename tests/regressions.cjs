const assert = require('node:assert/strict');
const { test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');

// Execute the application modules against a real in-memory SQLite database.
// Only the Expo native boundary is replaced; schema, SQL, and transactions run unchanged.
function loadModule(file, sqlite, cache = new Map()) {
  const resolved = path.resolve(file);
  if (cache.has(resolved)) return cache.get(resolved);
  const module = { exports: {} };
  cache.set(resolved, module.exports);
  const code = ts.transpileModule(fs.readFileSync(resolved, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const localRequire = (name) => {
    if (name === 'expo-sqlite') return sqlite;
    if (name.startsWith('.')) return loadModule(path.resolve(path.dirname(resolved), name + '.ts'), sqlite, cache);
    return require(name);
  };
  new Function('require', 'module', 'exports', code)(localRequire, module, module.exports);
  return module.exports;
}

function databaseFixture() {
  const connection = new DatabaseSync(':memory:');
  let failInsert = false;
  let opens = 0;
  const adapter = {
    execSync: (sql) => connection.exec(sql),
    getFirstSync: (sql) => connection.prepare(sql).get(),
    getAllSync: (sql) => connection.prepare(sql).all(),
    runSync: (sql, params) => {
      if (failInsert && sql.trim().startsWith('INSERT')) throw new Error('Simulated disk failure');
      return connection.prepare(sql).run(...params);
    },
    withTransactionSync: (action) => {
      connection.exec('BEGIN');
      try { action(); connection.exec('COMMIT'); }
      catch (error) { connection.exec('ROLLBACK'); throw error; }
    },
  };
  const sqlite = { openDatabaseAsync: async () => { opens++; return adapter; } };
  return {
    load: () => loadModule('db/database.ts', sqlite),
    connection,
    fail: () => { failInsert = true; },
    opens: () => opens,
  };
}

const utilities = loadModule('utils/trades.ts');

test('P&L accepts signed decimals and rejects partial, blank and non-finite inputs', () => {
  for (const input of ['', ' ', '125oops', 'Infinity', 'NaN', '1e309', '0x10', '1,500']) {
    assert.equal(utilities.parsePnl(input), undefined, input);
  }
  assert.equal(utilities.parsePnl(' -75.25 '), -75.25);
  assert.equal(utilities.parsePnl('0'), 0);
  assert.equal(utilities.parsePnl('.50'), 0.5);
});

test('local trade dates preserve the device calendar day near UTC midnight', () => {
  assert.equal(utilities.localDateKey(new Date(2026, 9, 21, 0, 30)), '2026-10-21');
});

test('overlap trades contribute to both constituent session metrics', () => {
  assert.equal(utilities.belongsToSession('London/NY Overlap', 'New York'), true);
  assert.equal(utilities.belongsToSession('London/NY Overlap', 'London'), true);
  assert.equal(utilities.belongsToSession('London/NY Overlap', 'Tokyo'), false);
});

test('coach session ranking follows actual results rather than preferring London', () => {
  const trades = [{ pnl: -50, session: 'London', emotion: 'Calm' }, { pnl: 120, session: 'Tokyo', emotion: 'Calm' }];
  assert.match(utilities.coachInsight(trades, 'SESSION'), /^Tokyo: \$120.00/);
  assert.match(utilities.coachInsight(trades, 'SUMMARY'), /\$70.00/);
  assert.equal(utilities.questionKind('What is my mood performance?'), 'MOOD');
  assert.equal(utilities.questionKind('Who will win tomorrow?'), undefined);
});

test('startup is lazy and concurrent initialization seeds exactly once', async () => {
  const fixture = databaseFixture();
  const db = fixture.load();
  assert.equal(fixture.opens(), 0);
  await Promise.all([db.initDatabase(), db.initDatabase()]);
  assert.equal(fixture.opens(), 1);
  assert.equal(db.getAllTrades().length, 30);
  fixture.connection.close();
});

test('refreshing demo trades preserves real journal entries and prevents duplicates', async () => {
  const fixture = databaseFixture();
  const db = fixture.load();
  await db.initDatabase();
  const trade = { ...db.getAllTrades()[0], isDemo: 0, pnl: -60, notes: "User's entry" };
  db.insertTrade(trade);
  db.resetToDemoTrades();
  db.resetToDemoTrades();
  assert.equal(db.getAllTrades().length, 31);
  assert.equal(db.getAllTrades().filter((row) => row.isDemo === 0)[0].notes, "User's entry");
  assert.throws(() => db.insertTrade({ ...trade, pnl: Infinity }), /finite/);
  assert.throws(() => db.insertTrade({ ...trade, entryPrice: 0 }), /positive/);
  assert.throws(() => db.insertTrade({ ...trade, durationMinutes: 1.5 }), /whole/);
  fixture.connection.close();
});

test('deleting every trade remains empty across a fresh app initialization', async () => {
  const fixture = databaseFixture();
  const db = fixture.load();
  await db.initDatabase();
  for (const row of db.getAllTrades()) db.deleteTradeById(row.id);
  const reopened = fixture.load();
  await reopened.initDatabase();
  assert.equal(reopened.getAllTrades().length, 0);
  fixture.connection.close();
});

test('failed demo replacement rolls back deletion of existing data', async () => {
  const fixture = databaseFixture();
  const db = fixture.load();
  await db.initDatabase();
  const before = JSON.stringify(db.getAllTrades());
  fixture.fail();
  assert.throws(() => db.resetToDemoTrades(), /disk failure/);
  assert.equal(JSON.stringify(db.getAllTrades()), before);
  fixture.connection.close();
});

test('legacy databases retain their journal without an additional seed', async () => {
  const fixture = databaseFixture();
  const db = fixture.load();
  await db.initDatabase();
  fixture.connection.exec('PRAGMA user_version = 0');
  const reopened = fixture.load();
  await reopened.initDatabase();
  assert.equal(reopened.getAllTrades().length, 30);
  assert.equal(fixture.connection.prepare('PRAGMA user_version').get().user_version, 1);
  fixture.connection.close();
});
