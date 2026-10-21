import { localDateKey } from '../utils/trades';
import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase;
let initialization: Promise<void> | undefined;

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
}

export function initDatabase(): Promise<void> {
    initialization ??= initialize().catch((error: unknown) => {
        initialization = undefined;
        throw error;
    });
    return initialization;
}

async function initialize(): Promise<void> {
    db = await SQLite.openDatabaseAsync('tradetrack.db');
    // Version the initial seed so deleting the last trade keeps the journal empty.
    db.withTransactionSync(() => {
        db.execSync(`
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

        const version = db.getFirstSync<{ user_version: number }>('PRAGMA user_version');
        if (version?.user_version === 0) {
            const count = db.getFirstSync<{ count: number }>('SELECT COUNT(*) as count FROM trades');
            if (count?.count === 0) seedDemoTrades();
            db.execSync('PRAGMA user_version = 1');
        }
    });
}

function seedDemoTrades(): void {
    const instruments = ['XAU/USD', 'EUR/USD', 'GBP/USD', 'USD/JPY', 'BTC/USD'];
    const sessions = ['London', 'New York', 'Tokyo', 'Sydney', 'London/NY Overlap'];
    const strategies = ['Breakout', 'Trend Following', 'Support/Resistance', 'Scalping', 'Mean Reversion'];
    const emotions = ['Calm', 'Confident', 'Stressed', 'Frustrated', 'Nervous', 'Excited'];

    const demoData: Omit<Trade, 'id'>[] = [];

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
        db.runSync(
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

export function getAllTrades(): Trade[] {
    return db.getAllSync<Trade>('SELECT * FROM trades ORDER BY tradeDate DESC, id DESC');
}

export function insertTrade(trade: Omit<Trade, 'id'>): void {
    if (!Number.isFinite(trade.pnl)) throw new Error('Profit or loss must be finite.');
    if (![trade.entryPrice, trade.exitPrice, trade.positionSize].every((value) => Number.isFinite(value) && value > 0)) {
        throw new Error('Prices and position size must be positive finite numbers.');
    }
    if (!Number.isInteger(trade.durationMinutes) || trade.durationMinutes < 0) {
        throw new Error('Duration must be a non-negative whole number of minutes.');
    }
    db.runSync(
        `INSERT INTO trades (instrument, direction, entryPrice, exitPrice, positionSize, pnl, session, strategy, emotion, durationMinutes, tradeDate, notes, isDemo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            trade.tradeDate,
            trade.notes,
            trade.isDemo,
        ]
    );
}

export function deleteTradeById(id: number): void {
    db.runSync('DELETE FROM trades WHERE id = ?', [id]);
}

export function resetToDemoTrades(): void {
    db.withTransactionSync(() => {
        db.runSync('DELETE FROM trades WHERE isDemo = ?', [1]);
        seedDemoTrades();
    });
}