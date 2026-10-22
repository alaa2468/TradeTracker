const assert = require('node:assert/strict');
const { test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');

// Execute the application modules against a real in-memory SQLite database.
// Only the Expo native boundary is replaced; schema, SQL, and transactions run unchanged.
function loadModule(file, sqlite, cache = new Map(), environment = {}) {
  const resolved = path.resolve(file);
  if (cache.has(resolved)) return cache.get(resolved);
  const module = { exports: {} };
  cache.set(resolved, module.exports);
  const code = ts.transpileModule(fs.readFileSync(resolved, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const localRequire = (name) => {
    if (name === 'expo-sqlite') return sqlite;
    if (name.startsWith('.')) return loadModule(path.resolve(path.dirname(resolved), name + '.ts'), sqlite, cache, environment);
    return require(name);
  };
  new Function('require', 'module', 'exports', 'globalThis', code)(localRequire, module, module.exports, environment);
  return module.exports;
}

function databaseFixture() {
  const connection = new DatabaseSync(':memory:');
  let failInsert = false;
  let failSql = '';
  let opens = 0;
  const adapter = {
    execAsync: async (sql) => {
      if (failSql && sql.includes(failSql)) throw new Error('Simulated migration failure');
      connection.exec(sql);
    },
    getFirstAsync: async (sql, params = []) => connection.prepare(sql).get(...params),
    getAllAsync: async (sql, params = []) => connection.prepare(sql).all(...params),
    runAsync: async (sql, params) => {
      if (failInsert && sql.trim().startsWith('INSERT')) throw new Error('Simulated disk failure');
      return connection.prepare(sql).run(...params);
    },
    withTransactionAsync: async (action) => {
      connection.exec('BEGIN');
      try { await action(); connection.exec('COMMIT'); }
      catch (error) { connection.exec('ROLLBACK'); throw error; }
    },
  };
  const sqlite = { openDatabaseAsync: async () => { opens++; return adapter; } };
  return {
    load: () => loadModule('db/database.ts', sqlite),
    reload: environment => loadModule('db/database.ts', sqlite, new Map(), environment),
    connection,
    fail: (enabled = true) => { failInsert = enabled; },
    failSql: sql => { failSql = sql; },
    opens: () => opens,
  };
}

const utilities = loadModule('utils/trades.ts');
const statistics = loadModule('utils/statistics.ts');

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

test('trade date/time input rejects impossible dates and preserves local time', () => {
  for (const input of ['2026-02-31 10:00', '2026-01-01 25:00', '10/22/2026', '2026-13-01 10:00', '']) {
    assert.equal(statistics.parseLocalDateTime(input), undefined);
  }
  const date = new Date(2026, 9, 22, 12, 15, 30);
  assert.equal(statistics.parseLocalDateTime('2026-10-22 12:15:30'), date.toISOString());
  assert.equal(statistics.localDateTime(date), '2026-10-22 12:15:30');
});

test('statistics handle wins, losses, breakeven and an empty journal consistently', () => {
  assert.deepEqual(statistics.summarize([{ pnl: 120 }, { pnl: -30 }, { pnl: 0 }]),
    { pnl: 90, count: 3, wins: 1, losses: 1, breakeven: 1, winRate: 1 / 3 * 100, average: 30 });
  assert.deepEqual(statistics.summarize([]),
    { pnl: 0, count: 0, wins: 0, losses: 0, breakeven: 0, winRate: 0, average: 0 });
});

test('7-day and 30-day filters use inclusive local calendar dates and exclude future days', () => {
  const now = new Date(2026, 9, 22, 12);
  const rows = ['2026-09-22', '2026-09-23', '2026-10-15', '2026-10-16', '2026-10-22', '2026-10-23'].map(tradeDate => ({ tradeDate }));
  assert.deepEqual(statistics.filterTrades(rows, 'WEEK', now).map(t => t.tradeDate), ['2026-10-16', '2026-10-22']);
  assert.equal(statistics.filterTrades(rows, 'MONTH', now).length, 4);
  assert.equal(statistics.filterTrades(rows, 'ALL', now).length, 6);
});

test('trading duration clips sessions at calendar boundaries and includes active elapsed time', () => {
  const now = new Date(2026, 9, 22, 12);
  const ended = { start_time: new Date(2026, 9, 15, 23).toISOString(), end_time: new Date(2026, 9, 16, 1).toISOString(), duration: 7200, status: 'completed' };
  const active = { start_time: new Date(2026, 9, 22, 10).toISOString(), end_time: null, duration: null, status: 'active' };
  const outside = { start_time: new Date(2026, 8, 1).toISOString(), end_time: new Date(2026, 8, 2).toISOString(), duration: 86400, status: 'completed' };
  assert.equal(statistics.tradingSeconds([ended, active, outside], 'WEEK', now), 3 * 3600);
  assert.equal(statistics.tradingSeconds([ended, active], 'ALL', now), 4 * 3600);
  assert.equal(statistics.sessionSeconds(ended, now.getTime()), 7200);
  assert.equal(statistics.sessionSeconds(active, now.getTime()), 7200);
  assert.equal(statistics.sessionSeconds(active, Date.parse(active.start_time) - 1000), 0);
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
  assert.equal((await db.getAllTrades()).length, 30);
  fixture.connection.close();
});

test('refreshing demo trades preserves real journal entries and prevents duplicates', async () => {
  const fixture = databaseFixture();
  const db = fixture.load();
  await db.initDatabase();
  const trade = { ...(await db.getAllTrades())[0], isDemo: 0, pnl: -60, notes: "User's entry" };
  await db.startSession();
  await db.insertTrade(trade);
  await db.resetToDemoTrades();
  await db.resetToDemoTrades();
  assert.equal((await db.getAllTrades()).length, 31);
  assert.equal((await db.getAllTrades()).filter((row) => row.isDemo === 0)[0].notes, "User's entry");
  await assert.rejects(() => db.insertTrade({ ...trade, pnl: Infinity }), /finite/);
  await assert.rejects(() => db.insertTrade({ ...trade, entryPrice: 0 }), /positive/);
  await assert.rejects(() => db.insertTrade({ ...trade, durationMinutes: 1.5 }), /whole/);
  fixture.connection.close();
});

test('deleting every trade remains empty across a fresh app initialization', async () => {
  const fixture = databaseFixture();
  const db = fixture.load();
  await db.initDatabase();
  for (const row of await db.getAllTrades()) await db.deleteTradeById(row.id);
  const reopened = fixture.load();
  await reopened.initDatabase();
  assert.equal((await reopened.getAllTrades()).length, 0);
  fixture.connection.close();
});

test('failed demo replacement rolls back deletion of existing data', async () => {
  const fixture = databaseFixture();
  const db = fixture.load();
  await db.initDatabase();
  const before = JSON.stringify(await db.getAllTrades());
  fixture.fail();
  await assert.rejects(() => db.resetToDemoTrades(), /disk failure/);
  assert.equal(JSON.stringify(await db.getAllTrades()), before);
  fixture.connection.close();
});

test('legacy databases retain their journal without an additional seed', async () => {
  const fixture = databaseFixture();
  const db = fixture.load();
  await db.initDatabase();
  fixture.connection.exec('PRAGMA user_version = 0');
  const reopened = fixture.load();
  await reopened.initDatabase();
  assert.equal((await reopened.getAllTrades()).length, 30);
  assert.equal(fixture.connection.prepare('PRAGMA user_version').get().user_version, 2);
  fixture.connection.close();
});


test('concurrent writes and reads are serialized around demo replacement', async () => {
  const fixture = databaseFixture();
  const db = fixture.load();
  await db.initDatabase();
  const trade = { ...(await db.getAllTrades())[0], isDemo: 0, notes: 'Concurrent entry' };
  await db.startSession();
  const [, , , rows] = await Promise.all([
    db.resetToDemoTrades(), db.insertTrade(trade), db.resetToDemoTrades(), db.getAllTrades(),
  ]);
  assert.equal(rows.length, 31);
  assert.equal(rows.filter(row => row.isDemo === 0)[0].notes, 'Concurrent entry');
  fixture.connection.close();
});

test('only one manually started session is allowed, including concurrent starts', async () => {
  const fixture = databaseFixture();
  const db = fixture.load();
  const results = await Promise.allSettled([db.startSession(), db.startSession()]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const [session] = await db.getSessions();
  assert.equal(session.status, 'active');
  assert.equal(session.end_time, null);
  assert.throws(() => fixture.connection.prepare("INSERT INTO sessions(start_time,status) VALUES (?, 'active')").run(new Date().toISOString()), /UNIQUE/);
  const reopened = fixture.load();
  assert.equal((await reopened.getSessions())[0].status, 'active');
  // Reopening or reading never ends the session. Only this explicit call does.
  await reopened.endSession(session.id);
  const ended = (await reopened.getSessions())[0];
  assert.equal(ended.status, 'completed');
  assert.equal(ended.duration, (Date.parse(ended.end_time) - Date.parse(ended.start_time)) / 1000);
  await assert.rejects(() => reopened.endSession(session.id), /already ended/);
  await reopened.startSession();
  assert.equal((await reopened.getSessions()).length, 2);
  fixture.connection.close();
});

test('new trades require an active session and edits keep the original association', async () => {
  const fixture = databaseFixture();
  const db = fixture.load();
  const trade = { ...(await db.getAllTrades())[0], isDemo: 0, timestamp: undefined, pnl: 12.5 };
  await assert.rejects(() => db.insertTrade(trade), /Start a personal session/);
  await db.startSession();
  const [session] = await db.getSessions();
  await db.insertTrade(trade);
  const saved = (await db.getAllTrades()).find(row => row.isDemo === 0);
  assert.equal(saved.session_id, session.id);
  assert.ok(saved.timestamp);
  await db.endSession(session.id);
  await db.startSession();
  await db.updateTrade(saved.id, { ...saved, pnl: -7, notes: 'Edited' });
  const updated = (await db.getAllTrades()).find(row => row.id === saved.id);
  assert.equal(updated.session_id, session.id);
  assert.equal(updated.pnl, -7);
  assert.equal(updated.notes, 'Edited');
  await assert.rejects(() => db.updateTrade(saved.id, { ...saved, timestamp: '2000-01-01T00:00:00.000Z' }), /within/);
  await db.deleteTradeById(saved.id);
  assert.equal((await db.getAllTrades()).filter(row => row.session_id === session.id).length, 0);
  assert.equal((await db.getSessions()).length, 2);
  fixture.connection.close();
});

test('version-one migration preserves every original field and leaves unknown session/time null', async () => {
  const fixture = databaseFixture();
  fixture.connection.exec(`CREATE TABLE trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT, instrument TEXT NOT NULL, direction TEXT NOT NULL,
    entryPrice REAL NOT NULL, exitPrice REAL NOT NULL, positionSize REAL NOT NULL, pnl REAL NOT NULL,
    session TEXT NOT NULL, strategy TEXT NOT NULL, emotion TEXT NOT NULL, durationMinutes INTEGER NOT NULL,
    tradeDate TEXT NOT NULL, notes TEXT, isDemo INTEGER DEFAULT 0);
    INSERT INTO trades VALUES (41, 'EUR/USD','SELL',1.2,1.1,2,-31.75,'Tokyo','Breakout','Calm',43,'2026-01-01','Keep me',0);
    PRAGMA user_version=1;`);
  const before = fixture.connection.prepare('SELECT * FROM trades').get();
  const db = fixture.load();
  const [saved] = await db.getAllTrades();
  const { session_id, timestamp, ...original } = saved;
  assert.deepEqual(original, { ...before });
  assert.equal(session_id, null);
  assert.equal(timestamp, null);
  assert.equal((await db.getSessions()).length, 0);
  await db.updateTrade(41, { ...saved, pnl: 0 });
  assert.equal((await db.getAllTrades())[0].timestamp, null);
  assert.throws(() => fixture.connection.prepare('UPDATE trades SET session_id=999 WHERE id=41').run(), /FOREIGN KEY/);
  fixture.connection.close();
});

test('a failed async write does not stop subsequent database operations', async () => {
  const fixture = databaseFixture();
  const db = fixture.load();
  await db.initDatabase();
  fixture.fail();
  await assert.rejects(db.resetToDemoTrades(), /disk failure/);
  fixture.fail(false);
  await db.resetToDemoTrades();
  assert.equal((await db.getAllTrades()).length, 30);
  fixture.connection.close();
});


test('Fast Refresh shares initialization and the operation queue across module evaluations', async () => {
  const fixture = databaseFixture();
  const environment = {};
  const first = fixture.reload(environment);
  const initializing = first.initDatabase();
  const refreshed = fixture.reload(environment);
  await Promise.all([initializing, refreshed.initDatabase()]);
  assert.equal(fixture.opens(), 1);
  await first.startSession();
  const trade = { ...(await first.getAllTrades())[0], isDemo: 0, timestamp: undefined };
  const [, , rows] = await Promise.all([first.resetToDemoTrades(), refreshed.insertTrade(trade), first.getAllTrades()]);
  assert.equal(rows.length, 31);
  fixture.connection.close();
});

test('an interrupted version-one migration rolls back schema changes and can be retried without data loss', async () => {
  const fixture = databaseFixture();
  fixture.connection.exec(`CREATE TABLE trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT, instrument TEXT NOT NULL, direction TEXT NOT NULL,
    entryPrice REAL NOT NULL, exitPrice REAL NOT NULL, positionSize REAL NOT NULL, pnl REAL NOT NULL,
    session TEXT NOT NULL, strategy TEXT NOT NULL, emotion TEXT NOT NULL, durationMinutes INTEGER NOT NULL,
    tradeDate TEXT NOT NULL, notes TEXT, isDemo INTEGER DEFAULT 0);
    INSERT INTO trades VALUES (41,'EUR/USD','SELL',1.2,1.1,2,-31.75,'Tokyo','Breakout','Calm',43,'2026-01-01','Keep me',0);
    PRAGMA user_version=1;`);
  const before = fixture.connection.prepare('SELECT * FROM trades').get();
  fixture.failSql('ADD COLUMN timestamp');
  const db = fixture.load();
  await assert.rejects(() => db.initDatabase(), /migration failure/);
  assert.deepEqual(fixture.connection.prepare('SELECT * FROM trades').get(), before);
  assert.equal(fixture.connection.prepare('PRAGMA user_version').get().user_version, 1);
  assert.equal(fixture.connection.prepare('PRAGMA table_info(trades)').all().some(column => column.name === 'session_id'), false);
  fixture.failSql('');
  await db.initDatabase();
  const [saved] = await db.getAllTrades();
  assert.equal(saved.id, 41);
  assert.equal(saved.notes, 'Keep me');
  assert.equal(saved.session_id, null);
  assert.equal((await db.getAllTrades()).length, 1);
  fixture.connection.close();
});

test('a database from a newer app version is never silently downgraded', async () => {
  const fixture = databaseFixture();
  const db = fixture.load();
  await db.initDatabase();
  const before = fixture.connection.prepare('SELECT * FROM trades').all();
  fixture.connection.exec('PRAGMA user_version=3');
  await assert.rejects(() => fixture.load().initDatabase(), /newer version/);
  assert.equal(fixture.connection.prepare('PRAGMA user_version').get().user_version, 3);
  assert.deepEqual(fixture.connection.prepare('SELECT * FROM trades').all(), before);
  fixture.connection.close();
});
