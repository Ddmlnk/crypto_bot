// ============================================
// BACKTEST — 4H, всі кандидати, TRAIN/TEST SPLIT
// ============================================

const fs = require("fs");
const path = require("path");

const config = require("./config");
const { getCandlesHistory } = require("./binance");
const { checkTriggers } = require("./triggers");
const { checkTriggersV2 } = require("./triggers_v2");
const { checkRangeTriggers } = require("./range_triggers");
const { checkSmcTriggers } = require("./smc_triggers");
const { computeRegimeSeries } = require("./regime");

const BACKTEST_CONFIG = {
  candlesCount: 12000, // ~5.5 років 4H — пагінація візьме скільки є
  positionSize: 90,
  maxRiskUsd: 3,
  feePercent: 0.04,
  slippagePercent: 0.05,
};

const SPLIT_MS = new Date(config.splitDate).getTime();

function passesRouting(signalName, regime) {
  const rule = config.triggerRouting[signalName];
  if (!rule) return false;
  if (!regime) return false;
  const macro = regime.macro || "UNKNOWN";
  return Array.isArray(rule.macro) && rule.macro.includes(macro);
}

function monthKey(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function simulateTrade(signal, candles, startIndex) {
  const { type, entry, stop, tp1, tp2 } = signal;
  const { feePercent, slippagePercent, positionSize } = BACKTEST_CONFIG;

  const slip = slippagePercent / 100;
  const realEntry = type === "LONG" ? entry * (1 + slip) : entry * (1 - slip);

  let exitPrice = null,
    exitReason = null,
    exitBarIndex = null;

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

async function backtest(symbol, regimeDist) {
  console.log(`\n🧪 BACKTEST: ${symbol}`);
  console.log("━".repeat(50));

  const candles = await getCandlesHistory(
    symbol,
    config.timeframe,
    BACKTEST_CONFIG.candlesCount,
  );
  if (!candles || candles.length < 250) {
    console.log(`  ❌ Недостатньо даних (${candles ? candles.length : 0})`);
    return { trades: [] };
  }

  const first = new Date(candles[0].openTime).toISOString().slice(0, 10);
  const last = new Date(candles[candles.length - 1].openTime)
    .toISOString()
    .slice(0, 10);
  console.log(`  ✅ ${candles.length} свічок | ${first} → ${last}`);

  const regimeSeries = computeRegimeSeries(candles, config.regime);

  // збір розподілу режимів (діагностика денних ADX-порогів)
  for (const r of regimeSeries) {
    if (!r) continue;
    regimeDist[r.macro] = (regimeDist[r.macro] || 0) + 1;
  }

  const trades = [];
  let openTradeUntilBar = -1;

  for (let i = 50; i < candles.length - 1; i++) {
    if (i < openTradeUntilBar) continue;
    const regime = regimeSeries[i];

    const rawSignals = [
      ...checkTriggers(candles, i),
      ...checkTriggersV2(candles, i, symbol),
      ...checkRangeTriggers(candles, i, symbol),
      ...checkSmcTriggers(candles, i),
    ];
    if (rawSignals.length === 0) continue;

    const signals = rawSignals.filter((s) => passesRouting(s.name, regime));
    if (signals.length === 0) continue;

    const signal = signals[0];
    const trade = simulateTrade(signal, candles, i);
    if (!trade) continue;

    trades.push({
      ...trade,
      symbol,
      macro: regime ? regime.macro : "UNKNOWN",
      phase: trade.entryTime < SPLIT_MS ? "TRAIN" : "TEST",
      month: monthKey(trade.entryTime),
    });
    openTradeUntilBar = trade.exitBarIndex;
  }

  console.log(`  📊 Угод: ${trades.length}`);
  return { trades };
}

function agg(trades) {
  if (!trades.length) return { n: 0, wr: 0, pnl: 0, pf: 0 };
  let wins = 0,
    gw = 0,
    gl = 0,
    pnl = 0;
  for (const t of trades) {
    pnl += t.pnlUsd;
    if (t.pnlUsd > 0) {
      wins++;
      gw += t.pnlUsd;
    } else gl += Math.abs(t.pnlUsd);
  }
  return {
    n: trades.length,
    wr: +((wins / trades.length) * 100).toFixed(1),
    pnl: +pnl.toFixed(2),
    pf: gl === 0 ? Infinity : +(gw / gl).toFixed(2),
  };
}

function fmt(a) {
  return `${a.n} угод | WR ${a.wr}% | P&L $${a.pnl} | PF ${a.pf}`;
}

function printSplitReport(allTrades) {
  const train = allTrades.filter((t) => t.phase === "TRAIN");
  const test = allTrades.filter((t) => t.phase === "TEST");

  console.log("\n");
  console.log("═".repeat(55));
  console.log("🔬 TRAIN / TEST SPLIT");
  console.log(`   межа: ${config.splitDate}`);
  console.log("═".repeat(55));

  console.log(`\n  📊 ЗАГАЛОМ:`);
  console.log(`    TRAIN: ${fmt(agg(train))}`);
  console.log(`    TEST:  ${fmt(agg(test))}`);

  console.log(`\n  🎯 ПО КОЖНОМУ ТРИГЕРУ (TRAIN / TEST):`);
  const names = [...new Set(allTrades.map((t) => t.signal))].sort();
  for (const name of names) {
    const tr = train.filter((t) => t.signal === name);
    const te = test.filter((t) => t.signal === name);
    console.log(`\n    ${name}:`);
    console.log(`      TRAIN: ${fmt(agg(tr))}`);
    console.log(`      TEST:  ${fmt(agg(te))}`);
  }
}

function printMacroBreakdown(allTrades) {
  console.log("\n");
  console.log("═".repeat(55));
  console.log("🧭 ПО МАКРОРЕЖИМАХ (кожен тригер × режим, TEST only)");
  console.log("═".repeat(55));
  const test = allTrades.filter((t) => t.phase === "TEST");
  const names = [...new Set(test.map((t) => t.signal))].sort();
  for (const name of names) {
    console.log(`\n  ${name}:`);
    for (const m of ["UP", "DOWN", "FLAT"]) {
      const sub = test.filter((t) => t.signal === name && t.macro === m);
      if (!sub.length) continue;
      const a = agg(sub);
      const icon = a.pnl > 0 ? "🟢" : "🔴";
      console.log(`    ${icon} ${m.padEnd(5)}: ${fmt(a)}`);
    }
  }
}

async function runFullBacktest() {
  console.log("🧪 4H BACKTEST — ВСІ КАНДИДАТИ + TRAIN/TEST");
  console.log("═".repeat(50));
  console.log(
    `ТФ: ${config.timeframe} | Режим: ${config.regime.htf} EMA${config.regime.fastPeriod}/${config.regime.slowPeriod} ADX${config.regime.adxPeriod}`,
  );
  console.log(
    `Запит свічок: ${BACKTEST_CONFIG.candlesCount} | Монет: ${config.symbols.length}`,
  );
  console.log(`Split: ${config.splitDate}`);
  console.log("═".repeat(50));

  const allTrades = [];
  const regimeDist = {};

  for (const symbol of config.symbols) {
    const { trades } = await backtest(symbol, regimeDist);
    allTrades.push(...trades);
  }

  // діагностика режимів (чи адекватні денні ADX-пороги)
  console.log("\n");
  console.log("═".repeat(55));
  console.log("🧭 РОЗПОДІЛ РЕЖИМІВ (денний ТФ) — перевірка порогів");
  console.log("═".repeat(55));
  const totalR = Object.values(regimeDist).reduce((s, c) => s + c, 0);
  for (const [m, c] of Object.entries(regimeDist)) {
    console.log(`  ${m.padEnd(8)}: ${c} (${((c / totalR) * 100).toFixed(0)}%)`);
  }

  if (allTrades.length === 0) {
    console.log("\n⚠️  Жодної угоди.");
    return;
  }

  printSplitReport(allTrades);
  printMacroBreakdown(allTrades);

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const csvPath = path.join("backtest-results", `h4_trades_${timestamp}.csv`);
  const headers = [
    "Symbol",
    "Signal",
    "Type",
    "EntryTime",
    "Macro",
    "Phase",
    "Month",
    "PnL_USD",
    "ExitReason",
    "BarsHeld",
  ];
  const rows = allTrades.map((t) => [
    t.symbol,
    t.signal,
    t.type,
    new Date(t.entryTime).toISOString(),
    t.macro,
    t.phase,
    t.month,
    t.pnlUsd.toFixed(2),
    t.exitReason,
    t.barsHeld,
  ]);
  fs.writeFileSync(
    csvPath,
    [headers, ...rows].map((r) => r.join(",")).join("\n"),
  );
  console.log(`\n💾 Збережено: ${csvPath}`);

  console.log("\n✅ Бектест завершено!\n");
}

runFullBacktest();
