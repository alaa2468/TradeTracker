import { localDateKey } from '../utils/trades';
import * as SQLite from 'expo-sqlite';

interface DatabaseRuntime {
    db?: SQLite.SQLiteDatabase;
    initialization?: Promise<void>;
    operations: Promise<unknown>;
}

// Fast Refresh can evaluate this module again while a transaction is running.
// Share the connection, initialization, and queue for this JavaScript runtime.
const appGlobal = globalThis as typeof globalThis & { __tradeTrackDatabaseV2?: DatabaseRuntime };
const runtime = appGlobal.__tradeTrackDatabaseV2 ??= { operations: Promise.resolve() };

// Keep reads and writes outside other transactions, including on web where
// exclusive transactions are unavailable. A failed operation must not block the queue.
function queued<T>(operation: () => Promise<T>): Promise<T> {
    const result = runtime.operations.then(operation);
    runtime.operations = result.catch(() => undefined);
    return result;
}

export interface Trade {
    id: number;
    instrument: string;
    direction: 'BUY' | 'SELL';
    entryPrice: number;
    exitPrice: number;
    positionSize: number;
    pnl: number;
    session: string;
    strategy: string;
    emotion: string;
    durationMinutes: number;
    tradeDate: string;
    notes: string;
    isDemo: number;
    session_id: number | null;
    timestamp: string | null;
}

export interface TradingSession {
    id: number;
    start_time: string;
    end_time: string | null;
    /** Elapsed seconds; null until the user ends this session. */
    duration: number | null;
    status: 'active' | 'completed';
}

export type TradeInput = Omit<Trade, 'id' | 'session_id' | 'timestamp'> & {
    timestamp?: string | null;
};

export function initDatabase(): Promise<void> {
    runtime.initialization ??= initialize().catch((error: unknown) => {
        runtime.initialization = undefined;
        throw error;
    });
    return runtime.initialization;
}

async function initialize(): Promise<void> {
    runtime.db = await SQLite.openDatabaseAsync('tradetrack.db');
    await runtime.db!.execAsync('PRAGMA foreign_keys = ON');
    // Version the initial seed so deleting the last trade keeps the journal empty.
    await runtime.db!.withTransactionAsync(async () => {
        await runtime.db!.execAsync(`
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instrument TEXT NOT NULL,
      direction TEXT NOT NULL,
      entryPrice REAL NOT NULL,
      exitPrice REAL NOT NULL,
      positionSize REAL NOT NULL,
      pnl REAL NOT NULL,
      session TEXT NOT NULL,
      strategy TEXT NOT NULL,
      emotion TEXT NOT NULL,
      durationMinutes INTEGER NOT NULL,
      tradeDate TEXT NOT NULL,
      notes TEXT,
      isDemo INTEGER DEFAULT 0
    );
  `);

        const version = await runtime.db!.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
        if (version && version.user_version > 2) {
            throw new Error('This database was saved by a newer version of TradeTrack. Update the app to open it safely.');
        }
        if (version?.user_version === 0) {
            const count = await runtime.db!.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM trades');
            if (count?.count === 0) await seedDemoTrades();
        }
        // Inspect columns as well as the version so interrupted/older installations
        // can migrate safely. Existing IDs, values, and demo flags stay untouched.
        await runtime.db!.execAsync(`
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                start_time TEXT NOT NULL,
                end_time TEXT,
                duration REAL,
                status TEXT NOT NULL CHECK (status IN ('active', 'completed')),
                CHECK ((status = 'active' AND end_time IS NULL AND duration IS NULL)
                    OR (status = 'completed' AND end_time IS NOT NULL AND duration >= 0))
            );
            CREATE UNIQUE INDEX IF NOT EXISTS one_active_session
                ON sessions(status) WHERE status = 'active';
        `);
        const columns = await runtime.db!.getAllAsync<{ name: string }>('PRAGMA table_info(trades)');
        if (!columns.some(column => column.name === 'session_id')) {
            await runtime.db!.execAsync('ALTER TABLE trades ADD COLUMN session_id INTEGER REFERENCES sessions(id)');
        }
        if (!columns.some(column => column.name === 'timestamp')) {
            await runtime.db!.execAsync('ALTER TABLE trades ADD COLUMN timestamp TEXT');
        }
        await runtime.db!.execAsync(`CREATE INDEX IF NOT EXISTS trades_session_id ON trades(session_id);
            PRAGMA user_version = 2;`);
    });
}

async function seedDemoTrades(): Promise<void> {
    const instruments = ['XAU/USD', 'EUR/USD', 'GBP/USD', 'USD/JPY', 'BTC/USD'];
    const sessions = ['London', 'New York', 'Tokyo', 'Sydney', 'London/NY Overlap'];
    const strategies = ['Breakout', 'Trend Following', 'Support/Resistance', 'Scalping', 'Mean Reversion'];
    const emotions = ['Calm', 'Confident', 'Stressed', 'Frustrated', 'Nervous', 'Excited'];

    const demoData: TradeInput[] = [];

    for (let i = 1; i <= 30; i++) {
        const instrument = instruments[i % instruments.length];
        const session = sessions[i % sessions.length];
        const strategy = strategies[i % strategies.length];
        const emotion = emotions[i % emotions.length];
        const direction: 'BUY' | 'SELL' = i % 2 === 0 ? 'BUY' : 'SELL';

        // Simulate realistic correlation: Calm/Confident and London/Overlap perform better
        const isNegativeEmotion = emotion === 'Stressed' || emotion === 'Frustrated' || emotion === 'Nervous';
        const isWin = isNegativeEmotion ? i % 4 === 0 : i % 3 !== 0;

        const baseAmount = instrument === 'XAU/USD' || instrument === 'BTC/USD' ? 140 : 85;
        const rawPnl = isWin
            ? Math.round((baseAmount + (i * 13) % 120) * 100) / 100
            : -Math.round((baseAmount * 0.85 + (i * 17) % 110) * 100) / 100;

        const dayOffset = 30 - i;
        const date = localDateKey(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - dayOffset));

        demoData.push({
            instrument,
            direction,
            entryPrice: instrument === 'XAU/USD' ? 2650.5 : instrument === 'BTC/USD' ? 68400 : 1.085,
            exitPrice: instrument === 'XAU/USD' ? 2662.0 : instrument === 'BTC/USD' ? 68950 : 1.089,
            positionSize: 1.0,
            pnl: rawPnl,
            session,
            strategy,
            emotion,
            durationMinutes: 15 + (i * 12) % 180,
            tradeDate: date,
            notes: isWin ? 'Followed trading plan rules.' : 'Entered too early before confirmation.',
            isDemo: 1,
        });
    }

    for (const t of demoData) {
        await runtime.db!.runAsync(
            `INSERT INTO trades (instrument, direction, entryPrice, exitPrice, positionSize, pnl, session, strategy, emotion, durationMinutes, tradeDate, notes, isDemo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                t.instrument,
                t.direction,
                t.entryPrice,
                t.exitPrice,
                t.positionSize,
                t.pnl,
                t.session,
                t.strategy,
                t.emotion,
                t.durationMinutes,
                t.tradeDate,
                t.notes,
                t.isDemo,
            ]
        );
    }
}

export async function getAllTrades(): Promise<Trade[]> {
    await initDatabase();
    return queued(() => runtime.db!.getAllAsync<Trade>('SELECT * FROM trades ORDER BY tradeDate DESC, COALESCE(timestamp, tradeDate) DESC, id DESC'));
}

function validateTrade(trade: TradeInput): void {
    if (!Number.isFinite(trade.pnl)) throw new Error('Profit or loss must be finite.');
    if (![trade.entryPrice, trade.exitPrice, trade.positionSize].every((value) => Number.isFinite(value) && value > 0)) {
        throw new Error('Prices and position size must be positive finite numbers.');
    }
    if (!Number.isInteger(trade.durationMinutes) || trade.durationMinutes < 0) {
        throw new Error('Duration must be a non-negative whole number of minutes.');
    }
    if (!trade.instrument.trim() || !trade.strategy.trim() || !['BUY', 'SELL'].includes(trade.direction)) {
        throw new Error('Instrument, direction and strategy are required.');
    }
    if (![0, 1].includes(trade.isDemo)) throw new Error('Invalid data source.');
}

export async function insertTrade(trade: TradeInput): Promise<void> {
    validateTrade(trade);
    await initDatabase();
    await queued(async () => {
        if (trade.isDemo) throw new Error('Demo examples are read-only. Switch to My trades to add a trade.');
        const active = await runtime.db!.getFirstAsync<TradingSession>("SELECT * FROM sessions WHERE status = 'active'");
        if (!active) throw new Error('Start a personal session before adding a trade.');
        const timestamp = trade.timestamp ?? new Date().toISOString();
        validateTimestamp(timestamp, active);
        await runtime.db!.runAsync(
        `INSERT INTO trades (instrument, direction, entryPrice, exitPrice, positionSize, pnl, session, strategy, emotion, durationMinutes, tradeDate, notes, isDemo, session_id, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            trade.instrument,
            trade.direction,
            trade.entryPrice,
            trade.exitPrice,
            trade.positionSize,
            trade.pnl,
            trade.session,
            trade.strategy,
            trade.emotion,
            trade.durationMinutes,
            localDateKey(new Date(timestamp)),
            trade.notes,
            trade.isDemo,
            active.id,
            timestamp,
        ]
    );
    });
}

function validateTimestamp(timestamp: string, session?: TradingSession): void {
    const time = Date.parse(timestamp);
    if (!Number.isFinite(time) || time > Date.now()) throw new Error('Enter a valid date and time that is not in the future.');
    if (session && (time < Date.parse(session.start_time) || (session.end_time && time > Date.parse(session.end_time)))) {
        throw new Error('The trade time must be within its personal session.');
    }
}

export async function updateTrade(id: number, trade: TradeInput): Promise<void> {
    validateTrade(trade);
    await initDatabase();
    await queued(async () => {
        const existing = await runtime.db!.getFirstAsync<Trade>('SELECT * FROM trades WHERE id = ?', [id]);
        if (!existing) throw new Error('This trade no longer exists.');
        if (existing.isDemo || trade.isDemo) throw new Error('Demo examples are read-only.');
        const session = existing.session_id === null ? undefined
            : await runtime.db!.getFirstAsync<TradingSession>('SELECT * FROM sessions WHERE id = ?', [existing.session_id]) ?? undefined;
        // A date-only legacy trade keeps its unknown time unless explicitly supplied.
        const timestamp = trade.timestamp === undefined ? existing.timestamp : trade.timestamp;
        if (timestamp) validateTimestamp(timestamp, session);
        else if (session) throw new Error('A session trade needs a date and time.');
        await runtime.db!.runAsync(`UPDATE trades SET instrument=?, direction=?, entryPrice=?, exitPrice=?,
            positionSize=?, pnl=?, strategy=?, emotion=?, notes=?, tradeDate=?, timestamp=?, durationMinutes=? WHERE id=?`,
            [trade.instrument.trim(), trade.direction, trade.entryPrice, trade.exitPrice, trade.positionSize,
                trade.pnl, trade.strategy.trim(), trade.emotion, trade.notes,
                timestamp ? localDateKey(new Date(timestamp)) : existing.tradeDate, timestamp, trade.durationMinutes, id]);
    });
}

export async function getSessions(): Promise<TradingSession[]> {
    await initDatabase();
    return queued(() => runtime.db!.getAllAsync<TradingSession>('SELECT * FROM sessions ORDER BY start_time DESC, id DESC'));
}

export async function startSession(): Promise<void> {
    await initDatabase();
    await queued(async () => {
        const active = await runtime.db!.getFirstAsync<TradingSession>("SELECT * FROM sessions WHERE status = 'active'");
        if (active) throw new Error('A session is already active. End it before starting another.');
        await runtime.db!.runAsync("INSERT INTO sessions (start_time, status) VALUES (?, 'active')", [new Date().toISOString()]);
    });
}

export async function endSession(id: number): Promise<void> {
    await initDatabase();
    await queued(async () => {
        const session = await runtime.db!.getFirstAsync<TradingSession>("SELECT * FROM sessions WHERE id = ? AND status = 'active'", [id]);
        if (!session) throw new Error('This session is already ended or no longer exists.');
        const end = new Date();
        const duration = (end.getTime() - Date.parse(session.start_time)) / 1000;
        if (duration < 0) throw new Error('Your device clock is earlier than the session start. Correct the clock before ending it.');
        await runtime.db!.runAsync("UPDATE sessions SET end_time=?, duration=?, status='completed' WHERE id=? AND status='active'",
            [end.toISOString(), duration, id]);
    });
}

export async function deleteTradeById(id: number): Promise<void> {
    await initDatabase();
    await queued(() => runtime.db!.runAsync('DELETE FROM trades WHERE id = ?', [id]));
}

export async function resetToDemoTrades(): Promise<void> {
    await initDatabase();
    await queued(() => runtime.db!.withTransactionAsync(async () => {
        await runtime.db!.runAsync('DELETE FROM trades WHERE isDemo = ?', [1]);
        await seedDemoTrades();
    }));
}
