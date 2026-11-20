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
      const result = connection.prepare(sql).run(...params);
      return { ...result, lastInsertRowId: result.lastInsertRowid };
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
  assert.equal(fixture.connection.prepare('PRAGMA user_version').get().user_version, 3);
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
  fixture.connection.exec('PRAGMA user_version=4');
  await assert.rejects(() => fixture.load().initDatabase(), /newer version/);
  assert.equal(fixture.connection.prepare('PRAGMA user_version').get().user_version, 4);
  assert.deepEqual(fixture.connection.prepare('SELECT * FROM trades').all(), before);
  fixture.connection.close();
});

const coach = loadModule('utils/coach.ts');
const coachNow = new Date(2026, 10, 4, 14, 0, 0).getTime();
const coachSession = { id: 71, status: 'active', start_time: new Date(coachNow - 120 * 60000).toISOString(), end_time: null, duration: null };
function coachTrade(id, minutesAgo, pnl = -10, extra = {}) {
  const timestamp = new Date(coachNow - minutesAgo * 60000).toISOString();
  return { id, timestamp, session_id: 71, isDemo: 0, pnl, emotion: 'Calm', tradeDate: utilities.localDateKey(new Date(timestamp)), ...extra };
}

test('coaching thresholds include exact boundaries and work with unsorted trades', () => {
  const trades = [30, 20, 10, 5, 0].map((ago, i) => coachTrade(i + 1, ago));
  const signals = coach.sessionSignals([...trades].reverse(), coachSession, [], undefined, coachNow, true);
  assert.deepEqual(signals.map(s => s.kind), ['frequency', 'losses', 'duration']);
  assert.match(signals.find(s => s.kind === 'losses').text, /5 consecutive/);
  const below = coach.sessionSignals(trades.slice(0, 2), { ...coachSession, start_time: new Date(coachNow - 119.99 * 60000).toISOString() }, [], undefined, coachNow, true);
  assert.deepEqual(below, []);
});

test('frequency uses a sliding window rather than a session-wide count', () => {
  const trades = [100, 80, 60, 40, 20].map((ago, i) => coachTrade(i, ago, 1));
  assert.equal(coach.sessionSignals(trades, coachSession, [], undefined, coachNow).some(s => s.kind === 'frequency'), false);
  const burst = [90, 89, 88, 87, 86].map((ago, i) => coachTrade(i, ago, 1));
  assert.equal(coach.sessionSignals(burst, coachSession, [], undefined, coachNow).some(s => s.kind === 'frequency'), true);
  assert.equal(coach.sessionSignals(burst, coachSession, [], undefined, coachNow, true).some(s => s.kind === 'frequency'), false);
});

test('breakeven and wins reset loss streaks; active coaching uses the current streak', () => {
  const rows = [coachTrade(1, 20), coachTrade(2, 15), coachTrade(3, 10), coachTrade(4, 5, 0)];
  assert.equal(coach.sessionSignals(rows, coachSession, [], undefined, coachNow).some(s => s.kind === 'losses'), true);
  assert.equal(coach.sessionSignals(rows, coachSession, [], undefined, coachNow, true).some(s => s.kind === 'losses'), false);
  rows[2].pnl = 1;
  assert.equal(coach.sessionSignals(rows, coachSession, [], undefined, coachNow).some(s => s.kind === 'losses'), false);
});

test('demo, unknown times, unrelated sessions and future trades cannot trigger behavior signals', () => {
  const rows = Array.from({ length: 10 }, (_, i) => coachTrade(i, 0, -1, { isDemo: 1 }));
  rows.push(...Array.from({ length: 10 }, (_, i) => coachTrade(i + 10, 0, -1, { timestamp: null })));
  rows.push(...Array.from({ length: 10 }, (_, i) => coachTrade(i + 20, -10, -1)));
  rows.push(...Array.from({ length: 10 }, (_, i) => coachTrade(i + 30, 0, -1, { session_id: 99 })));
  assert.deepEqual(coach.sessionSignals(rows, { ...coachSession, start_time: new Date(coachNow - 60000).toISOString() }, [], undefined, coachNow), []);
});

test('reported stress and frustration prompt reflection without inferring emotion from losses', () => {
  const checkIn = { session_id: 71, phase: 'before', mood: 'Calm', stress: 4, recorded_at: coachSession.start_time, notes: '' };
  assert.ok(coach.sessionSignals([], coachSession, [checkIn], undefined, coachNow).some(s => s.kind === 'emotion'));
  assert.ok(coach.sessionSignals([coachTrade(1, 0, 1, { emotion: 'Frustrated' })], coachSession, [], undefined, coachNow, true).some(s => s.kind === 'emotion'));
  assert.equal(coach.sessionSignals([coachTrade(1, 60, 1, { emotion: 'Stressed' })], coachSession, [], undefined, coachNow, true).some(s => s.kind === 'emotion'), false);
  assert.equal(coach.sessionSignals([coachTrade(1, 0)], coachSession, [], undefined, coachNow).some(s => s.kind === 'emotion'), false);
});

test('weekly insights use seven local dates, exclude demos/future days, and compare previous dates', () => {
  const date = new Date(coachNow);
  const key = offset => utilities.localDateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset));
  const rows = [0, -6, -7, -13, -14, 1].map((offset, i) => coachTrade(i, 0, 1, { timestamp: null, session_id: null, tradeDate: key(offset) }));
  rows.push(coachTrade(99, 0, 1, { isDemo: 1 }));
  const result = coach.weeklyInsights(rows, [], [], undefined, date);
  assert.equal(result.startKey, key(-6));
  assert.match(result.lines[0], /2 personal trades/);
  assert.match(result.lines[1], /\+0 trades.*\(2\)/);
  assert.ok(result.lines.some(line => /2 trades lack/.test(line)));
  assert.ok(result.lines.some(line => /Missing feelings are left unknown/.test(line)));
});

test('weekly stress pairs and personalized discipline goals follow the recorded evidence', () => {
  const session = { ...coachSession, status: 'completed', end_time: new Date(coachNow).toISOString(), duration: 7200 };
  const checkIns = [{ session_id: 71, phase: 'before', mood: 'Calm', stress: 1, recorded_at: session.start_time },
    { session_id: 71, phase: 'after', mood: 'Stressed', stress: 4, recorded_at: session.end_time }];
  const rows = [20, 15, 10, 5, 0].map((ago, i) => coachTrade(i, ago));
  const result = coach.weeklyInsights(rows, [session], checkIns, undefined, new Date(coachNow));
  assert.ok(result.lines.some(line => /\+3.0 points/.test(line)));
  assert.ok(result.lines.some(line => /Calm → Stressed/.test(line)));
  assert.match(result.goal, /Before each entry/);
  // Removing the burst and long duration changes the suggested habit.
  const empty = coach.weeklyInsights([], [], [], undefined, new Date(coachNow));
  assert.match(empty.goal, /before and after check-in/);
});

test('version-two coaching migration preserves every trade and session and retries safely', async () => {
  const fixture = databaseFixture();
  const old = fixture.load();
  await old.initDatabase();
  await old.startSession();
  const trades = fixture.connection.prepare('SELECT * FROM trades').all();
  const sessions = fixture.connection.prepare('SELECT * FROM sessions').all();
  fixture.connection.exec('DROP TABLE session_check_ins; DROP TABLE coach_preferences; DROP TABLE coach_session_state; PRAGMA user_version=2');
  fixture.failSql('CREATE TABLE IF NOT EXISTS session_check_ins');
  const next = fixture.load();
  await assert.rejects(next.initDatabase(), /migration failure/);
  assert.equal(fixture.connection.prepare('PRAGMA user_version').get().user_version, 2);
  assert.deepEqual(fixture.connection.prepare('SELECT * FROM trades').all(), trades);
  fixture.failSql('');
  await next.initDatabase();
  assert.equal(fixture.connection.prepare('PRAGMA user_version').get().user_version, 3);
  assert.deepEqual(fixture.connection.prepare('SELECT * FROM trades').all(), trades);
  assert.deepEqual(fixture.connection.prepare('SELECT * FROM sessions').all(), sessions);
  assert.deepEqual(await next.getCheckIns(), []);
  fixture.connection.close();
});

test('pre-session check-in and session start are atomic, validated, persistent, and optional', async () => {
  const fixture = databaseFixture();
  const db = fixture.load();
  await db.initDatabase();
  const input = { mood: 'Calm', stress: 2, notes: ' Follow my plan ' };
  await assert.rejects(db.startSession({ ...input, stress: 0 }), /Choose a mood/);
  fixture.failSql('');
  // Fail only the check-in insert, after the session insert has succeeded.
  fixture.connection.exec(`CREATE TRIGGER fail_check_in BEFORE INSERT ON session_check_ins BEGIN SELECT RAISE(ABORT, 'check-in disk failure'); END;`);
  await assert.rejects(db.startSession(input), /check-in disk failure/);
  assert.equal((await db.getSessions()).length, 0);
  fixture.connection.exec('DROP TRIGGER fail_check_in');
  await db.startSession(input);
  const [saved] = await fixture.load().getCheckIns();
  const [session] = await db.getSessions();
  assert.equal(saved.session_id, session.id);
  assert.equal(saved.phase, 'before');
  assert.equal(saved.notes, 'Follow my plan');
  assert.equal(saved.recorded_at, session.start_time);
  await assert.rejects(db.startSession(input), /already active/);
  await db.endSession(session.id);
  await db.startSession();
  assert.equal((await db.getCheckIns()).length, 1);
  fixture.connection.close();
});

test('post-session check-in failures do not undo session end and duplicate saves are prevented', async () => {
  const fixture = databaseFixture();
  const db = fixture.load();
  const input = { mood: 'Frustrated', stress: 5, notes: 'Time to reset' };
  await db.startSession();
  const [session] = await db.getSessions();
  await assert.rejects(db.savePostSessionCheckIn(session.id, input), /End this session/);
  await db.endSession(session.id);
  fixture.fail();
  await assert.rejects(db.savePostSessionCheckIn(session.id, input), /disk failure/);
  assert.equal((await db.getSessions())[0].status, 'completed');
  fixture.fail(false);
  const results = await Promise.allSettled([db.savePostSessionCheckIn(session.id, input), db.savePostSessionCheckIn(session.id, input)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await fixture.load().getCheckIns()).length, 1);
  fixture.connection.close();
});

test('preferences and break/dismiss state persist and demo refresh cannot change them', async () => {
  const fixture = databaseFixture();
  const db = fixture.load();
  assert.deepEqual(await db.getCoachPreferences(), coach.DEFAULT_COACH_PREFERENCES);
  await assert.rejects(db.saveCoachPreferences({ ...coach.DEFAULT_COACH_PREFERENCES, frequentTrades: 1 }), /whole number/);
  const preferences = { ...coach.DEFAULT_COACH_PREFERENCES, frequentTrades: 8 };
  await db.saveCoachPreferences(preferences);
  await db.startSession({ mood: 'Confident', stress: 1, notes: '' });
  const [session] = await db.getSessions();
  const until = new Date(Date.now() + 5 * 60000).toISOString();
  await db.saveCoachSessionState(session.id, 'losses', until);
  await db.resetToDemoTrades();
  const reopened = fixture.load();
  assert.deepEqual(await reopened.getCoachPreferences(), preferences);
  assert.equal((await reopened.getCheckIns()).length, 1);
  assert.equal((await reopened.getCoachSessionStates())[0].break_until, until);
  await db.saveCoachSessionState(session.id, 'losses', null);
  assert.equal((await db.getCoachSessionStates())[0].dismissed_key, 'losses');
  await db.endSession(session.id);
  await assert.rejects(db.saveCoachSessionState(session.id, '', null), /no longer active/);
  fixture.connection.close();
});

test('weekly session time is clipped at the local week boundary and excludes previous-week loss streaks', () => {
  const now = new Date(2026, 10, 4, 0, 30);
  const boundary = new Date(2026, 9, 29, 0, 0);
  const session = { id: 71, start_time: new Date(boundary.getTime() - 3 * 3600000).toISOString(),
    end_time: new Date(boundary.getTime() + 60 * 60000).toISOString(), status: 'completed', duration: 4 * 3600 };
  const rows = [1, 2, 3].map((id) => coachTrade(id, 0, -1, {
    timestamp: new Date(boundary.getTime() - id * 60000).toISOString(), tradeDate: utilities.localDateKey(new Date(boundary.getTime() - id * 60000)),
  }));
  const result = coach.weeklyInsights(rows, [session], [], undefined, now);
  assert.match(result.lines[2], /0 sessions met.*0 had a loss.*0 reached/);
});

test('development reload upgrades a retained version-two initializer before reading coaching tables', async () => {
  const fixture = databaseFixture();
  const environment = {};
  const db = fixture.reload(environment);
  await db.startSession();
  const before = await db.getSessions();
  fixture.connection.exec('DROP TABLE session_check_ins; DROP TABLE coach_preferences; DROP TABLE coach_session_state; PRAGMA user_version=2');
  delete environment.__tradeTrackDatabaseV2.initializationVersion;
  const updated = fixture.reload(environment);
  assert.deepEqual(await updated.getCheckIns(), []);
  assert.equal(fixture.connection.prepare('PRAGMA user_version').get().user_version, 3);
  assert.deepEqual(await updated.getSessions(), before);
  fixture.connection.close();
});
