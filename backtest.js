// ============================================
// BACKTEST — Price Action стратегія
// ============================================

const fs = require("fs");
const path = require("path");

const config = require("./config");
const { getCandlesHistory } = require("./binance");
const { checkTriggers } = require("./triggers");

const BACKTEST_CONFIG = {
  candlesCount: 4320, // 180 днів на 1H
  positionSize: 90,
  maxRiskUsd: 3,
  feePercent: 0.04,
  slippagePercent: 0.05,
};
// Групи монет для категоризованого аналізу
const SYMBOL_GROUPS = {
  "Топ-капа": ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"],
  "L1/L2 альти": ["AVAXUSDT", "LINKUSDT", "ADAUSDT"],
  "Мемкоїни/XRP": ["DOGEUSDT", "XRPUSDT", "TRXUSDT"],
};

function getSymbolGroup(symbol) {
  for (const [group, symbols] of Object.entries(SYMBOL_GROUPS)) {
    if (symbols.includes(symbol)) return group;
  }
  return "Інші";
}
/**
 * Симуляція угоди — йдемо вперед поки не стоп або TP
 */
function simulateTrade(signal, candles, startIndex) {
  const { type, entry, stop, tp1, tp2 } = signal;
  const { feePercent, slippagePercent, positionSize } = BACKTEST_CONFIG;

  const slip = slippagePercent / 100;
  const realEntry = type === "LONG" ? entry * (1 + slip) : entry * (1 - slip);

  let exitPrice = null;
  let exitReason = null;
  let exitBarIndex = null;

  for (let i = startIndex + 1; i < candles.length; i++) {
    const bar = candles[i];

    if (type === "LONG") {
      if (bar.low <= stop) {
        exitPrice = stop * (1 - slip);
        exitReason = "STOP";
        exitBarIndex = i;
        break;
      }
      if (bar.high >= tp2) {
        exitPrice = tp2;
        exitReason = "TP2";
        exitBarIndex = i;
        break;
      }
      if (bar.high >= tp1) {
        exitPrice = tp1;
        exitReason = "TP1";
        exitBarIndex = i;
        break;
      }
    } else {
      if (bar.high >= stop) {
        exitPrice = stop * (1 + slip);
        exitReason = "STOP";
        exitBarIndex = i;
        break;
      }
      if (bar.low <= tp2) {
        exitPrice = tp2;
        exitReason = "TP2";
        exitBarIndex = i;
        break;
      }
      if (bar.low <= tp1) {
        exitPrice = tp1;
        exitReason = "TP1";
        exitBarIndex = i;
        break;
      }
    }
  }

  if (!exitPrice) return null;

  const priceChange =
    type === "LONG"
      ? (exitPrice - realEntry) / realEntry
      : (realEntry - exitPrice) / realEntry;

  const totalFees = (feePercent / 100) * 2;
  const netPriceChange = priceChange - totalFees;

  return {
    signal: signal.name,
    type,
    entry: realEntry,
    exit: exitPrice,
    stop,
    tp1,
    tp2,
    exitReason,
    pnlUsd: positionSize * netPriceChange,
    pnlPercent: netPriceChange * 100,
    barsHeld: exitBarIndex - startIndex,
    entryTime: candles[startIndex].openTime,
    exitTime: candles[exitBarIndex].openTime,
    exitBarIndex,
  };
}

async function backtest(symbol) {
  console.log(`\n🧪 BACKTEST: ${symbol}`);
  console.log("━".repeat(50));

  const candles = await getCandlesHistory(
    symbol,
    config.timeframe,
    BACKTEST_CONFIG.candlesCount,
  );
  if (candles.length < 100) {
    console.log(`  ❌ Недостатньо даних`);
    return [];
  }
  console.log(`  ✅ Завантажено ${candles.length} свічок`);

  const trades = [];
  let openTradeUntilBar = -1;

  // Починаємо з 50-ї свічки щоб мати історію для аналізу
  for (let i = 50; i < candles.length - 1; i++) {
    if (i < openTradeUntilBar) continue;

    const signals = checkTriggers(candles, i);
    if (signals.length === 0) continue;

    // Беремо перший сигнал якщо їх кілька (можна було б обирати кращий R:R)
    const signal = signals[0];
    const trade = simulateTrade(signal, candles, i);
    if (!trade) continue;

    trades.push({ ...trade, symbol });
    openTradeUntilBar = trade.exitBarIndex;
  }

  console.log(`  📊 Знайдено угод: ${trades.length}`);
  return trades;
}

function calculateStats(trades) {
  if (trades.length === 0) return { count: 0 };

  const wins = trades.filter((t) => t.pnlUsd > 0);
  const losses = trades.filter((t) => t.pnlUsd <= 0);

  const totalPnl = trades.reduce((s, t) => s + t.pnlUsd, 0);
  const grossWin = wins.reduce((s, t) => s + t.pnlUsd, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlUsd, 0));

  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;

  let peak = 0,
    equity = 0,
    maxDD = 0;
  for (const t of trades) {
    equity += t.pnlUsd;
    if (equity > peak) peak = equity;
    if (peak - equity > maxDD) maxDD = peak - equity;
  }

  const bySignal = {};
  for (const t of trades) {
    if (!bySignal[t.signal]) bySignal[t.signal] = { count: 0, wins: 0, pnl: 0 };
    bySignal[t.signal].count++;
    if (t.pnlUsd > 0) bySignal[t.signal].wins++;
    bySignal[t.signal].pnl += t.pnlUsd;
  }

  // Розподіл по причинах виходу
  const byExitReason = {};
  for (const t of trades) {
    byExitReason[t.exitReason] = (byExitReason[t.exitReason] || 0) + 1;
  }

  return {
    count: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: (wins.length / trades.length) * 100,
    totalPnl,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : Infinity,
    avgWin,
    avgLoss,
    avgRR: avgLoss > 0 ? avgWin / avgLoss : Infinity,
    maxDD,
    bySignal,
    byExitReason,
  };
}

function printReport(symbol, trades, stats) {
  console.log(`\n📈 РЕЗУЛЬТАТИ ${symbol}`);
  console.log("━".repeat(50));

  if (stats.count === 0) {
    console.log("  Немає угод");
    return;
  }

  const pnlIcon = stats.totalPnl >= 0 ? "🟢" : "🔴";
  console.log(`  ${pnlIcon} Total P&L: $${stats.totalPnl.toFixed(2)}`);
  console.log(
    `  📊 Угод: ${stats.count} (${stats.wins} W / ${stats.losses} L)`,
  );
  console.log(`  ✅ Win Rate: ${stats.winRate.toFixed(1)}%`);
  console.log(`  📈 Profit Factor: ${stats.profitFactor.toFixed(2)}`);
  console.log(`  💰 Avg Win: $${stats.avgWin.toFixed(2)}`);
  console.log(`  💸 Avg Loss: -$${stats.avgLoss.toFixed(2)}`);
  console.log(`  ⚖️  Avg R:R: ${stats.avgRR.toFixed(2)}`);
  console.log(`  📉 Max Drawdown: -$${stats.maxDD.toFixed(2)}`);

  console.log(`\n  🎯 По тригерах:`);
  for (const [name, data] of Object.entries(stats.bySignal)) {
    const wr = (data.wins / data.count) * 100;
    const icon = data.pnl >= 0 ? "🟢" : "🔴";
    console.log(
      `    ${icon} ${name}: ${data.count} угод, WR ${wr.toFixed(0)}%, P&L $${data.pnl.toFixed(2)}`,
    );
  }

  if (stats.byExitReason) {
    console.log(`\n  🚪 Виходи:`);
    for (const [reason, count] of Object.entries(stats.byExitReason)) {
      const pct = ((count / stats.count) * 100).toFixed(0);
      console.log(`    ${reason}: ${count} (${pct}%)`);
    }
  }
}

function saveTradesCSV(trades, filename) {
  if (trades.length === 0) return;

  const headers = [
    "Symbol",
    "Signal",
    "Type",
    "EntryTime",
    "ExitTime",
    "Entry",
    "Exit",
    "Stop",
    "TP1",
    "TP2",
    "ExitReason",
    "PnL_USD",
    "PnL_Percent",
    "BarsHeld",
  ];

  const rows = trades.map((t) => [
    t.symbol,
    t.signal,
    t.type,
    new Date(t.entryTime).toISOString(),
    new Date(t.exitTime).toISOString(),
    t.entry.toFixed(2),
    t.exit.toFixed(2),
    t.stop.toFixed(2),
    t.tp1.toFixed(2),
    t.tp2.toFixed(2),
    t.exitReason,
    t.pnlUsd.toFixed(2),
    t.pnlPercent.toFixed(2),
    t.barsHeld,
  ]);

  const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
  fs.writeFileSync(filename, csv);
  console.log(`\n💾 Збережено: ${filename}`);
}

async function runFullBacktest() {
  console.log("🧪 PRICE ACTION BACKTEST");
  console.log("═".repeat(50));
  console.log(`Таймфрейм: ${config.timeframe}`);
  console.log(`Період: ${BACKTEST_CONFIG.candlesCount} свічок`);
  console.log(`Монети: ${config.symbols.join(", ")}`);
  console.log(`Розмір позиції: $${BACKTEST_CONFIG.positionSize}`);
  console.log(`Макс ризик: $${BACKTEST_CONFIG.maxRiskUsd}`);
  console.log("═".repeat(50));

  const allTrades = [];

  for (const symbol of config.symbols) {
    const trades = await backtest(symbol);
    if (trades.length > 0) {
      const stats = calculateStats(trades);
      printReport(symbol, trades, stats);
      allTrades.push(...trades);
    }
  }

  console.log("\n");
  console.log("═".repeat(50));
  console.log("🎯 ЗАГАЛЬНІ РЕЗУЛЬТАТИ");
  console.log("═".repeat(50));

  // ============================================
  // СТАТИСТИКА ПО ГРУПАХ
  // ============================================
  console.log("\n");
  console.log("═".repeat(50));
  console.log("📊 ПО ГРУПАХ МОНЕТ");
  console.log("═".repeat(50));

  for (const [groupName, groupSymbols] of Object.entries(SYMBOL_GROUPS)) {
    const groupTrades = allTrades.filter((t) =>
      groupSymbols.includes(t.symbol),
    );
    if (groupTrades.length === 0) continue;

    console.log(`\n🔹 ${groupName}`);
    console.log("━".repeat(50));

    const stats = calculateStats(groupTrades);
    const pnlIcon = stats.totalPnl >= 0 ? "🟢" : "🔴";
    console.log(
      `  ${pnlIcon} P&L: $${stats.totalPnl.toFixed(2)} | Угод: ${stats.count} | WR: ${stats.winRate.toFixed(1)}% | PF: ${stats.profitFactor.toFixed(2)}`,
    );

    // По кожній монеті всередині групи
    const bySymbol = {};
    for (const t of groupTrades) {
      if (!bySymbol[t.symbol]) bySymbol[t.symbol] = { trades: [] };
      bySymbol[t.symbol].trades.push(t);
    }
    for (const [sym, data] of Object.entries(bySymbol)) {
      const sStats = calculateStats(data.trades);
      const icon = sStats.totalPnl >= 0 ? "🟢" : "🔴";
      console.log(
        `    ${icon} ${sym}: $${sStats.totalPnl.toFixed(2)} (${sStats.count} угод, WR ${sStats.winRate.toFixed(0)}%)`,
      );
    }
  }
  const totalStats = calculateStats(allTrades);
  printReport("ALL", allTrades, totalStats);

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const csvPath = path.join("backtest-results", `pa_trades_${timestamp}.csv`);
  saveTradesCSV(allTrades, csvPath);

  console.log("\n✅ Бектест завершено!\n");
}

runFullBacktest();
