// ============================================
// ПОМІСЯЧНИЙ ЗВІТ — режим ринку + P&L з фільтром і без
// ============================================

function monthKey(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Режим ринку за місяць: медіанна % зміна по монетах
// candlesBySymbol: { BTCUSDT: [{openTime, close, ...}], ... }
function computeMonthlyRegime(candlesBySymbol) {
  const perMonth = {}; // month -> [changePct по монетах]
  for (const sym of Object.keys(candlesBySymbol)) {
    const byMonth = {};
    for (const c of candlesBySymbol[sym]) {
      const m = monthKey(c.openTime);
      (byMonth[m] ||= []).push(c);
    }
    for (const m of Object.keys(byMonth)) {
      const arr = byMonth[m];
      const chg =
        ((arr[arr.length - 1].close - arr[0].close) / arr[0].close) * 100;
      (perMonth[m] ||= []).push(chg);
    }
  }
  const out = {};
  for (const m of Object.keys(perMonth)) {
    const vals = perMonth[m].slice().sort((a, b) => a - b);
    const med = vals[Math.floor(vals.length / 2)];
    let regime = "FLAT";
    if (med > 5) regime = "UP";
    else if (med < -5) regime = "DOWN";
    out[m] = { changePct: +med.toFixed(1), regime };
  }
  return out;
}

function agg(trades) {
  if (!trades.length) return null;
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

function byKey(trades, key) {
  const g = {};
  for (const t of trades) (g[t[key]] ||= []).push(t);
  const out = {};
  for (const k of Object.keys(g)) out[k] = agg(g[k]);
  return out;
}

function buildMonthlyReport(allTrades, regimeByMonth) {
  const byMonth = {};
  for (const t of allTrades) (byMonth[monthKey(t.entryTime)] ||= []).push(t);

  const months = Object.keys(byMonth).sort();
  return months.map((m) => {
    const all = byMonth[m];
    const passed = all.filter((t) => t.passedTrend);
    return {
      month: m,
      regime: regimeByMonth[m] || { regime: "?", changePct: 0 },
      noFilter: {
        total: agg(all),
        triggers: byKey(all, "signal"),
        symbols: byKey(all, "symbol"),
      },
      withFilter: { total: agg(passed), triggers: byKey(passed, "signal") },
    };
  });
}

function fmt(a) {
  return a
    ? `P&L $${a.pnl} | угод ${a.n} | WR ${a.wr}% | PF ${a.pf}`
    : "немає угод";
}

function printMonthlyReport(report) {
  console.log("\n");
  console.log("═".repeat(55));
  console.log("📅 ПОМІСЯЧНИЙ ЗВІТ");
  console.log("═".repeat(55));

  for (const r of report) {
    const reg = r.regime;
    const emoji =
      reg.regime === "UP" ? "🟢" : reg.regime === "DOWN" ? "🔴" : "⚪";
    const sign = reg.changePct > 0 ? "+" : "";
    console.log(
      `\n${emoji} ${r.month}  | режим: ${reg.regime} (${sign}${reg.changePct}%)`,
    );
    console.log("─".repeat(55));
    console.log(`  БЕЗ фільтра:  ${fmt(r.noFilter.total)}`);
    console.log(`  З фільтром:   ${fmt(r.withFilter.total)}`);

    const trigs = new Set([
      ...Object.keys(r.noFilter.triggers),
      ...Object.keys(r.withFilter.triggers),
    ]);
    for (const tr of trigs) {
      const a = r.noFilter.triggers[tr];
      const b = r.withFilter.triggers[tr];
      console.log(`    ${tr}:`);
      console.log(`        без: ${a ? `WR ${a.wr}% (${a.n}) $${a.pnl}` : "—"}`);
      console.log(`        філ: ${b ? `WR ${b.wr}% (${b.n}) $${b.pnl}` : "—"}`);
    }
  }

  // підсумок року
  console.log("\n");
  console.log("═".repeat(55));
  console.log("📊 РІК ЗАГАЛОМ (по місяцях)");
  console.log("═".repeat(55));
  const nf = report.map((r) => r.noFilter.total).filter(Boolean);
  const wf = report.map((r) => r.withFilter.total).filter(Boolean);
  const sumPnl = (arr) => +arr.reduce((s, a) => s + a.pnl, 0).toFixed(2);
  const profitable = (arr) => arr.filter((a) => a.pnl > 0).length;
  console.log(
    `  БЕЗ фільтра: P&L $${sumPnl(nf)} | прибуткових міс ${profitable(nf)}/${nf.length}`,
  );
  console.log(
    `  З фільтром:  P&L $${sumPnl(wf)} | прибуткових міс ${profitable(wf)}/${wf.length}`,
  );

  // ключова таблиця: P&L по режимах ринку
  console.log("\n  🧭 P&L за режимами ринку (з фільтром):");
  const byRegime = { UP: [], DOWN: [], FLAT: [] };
  for (const r of report) {
    if (r.withFilter.total && byRegime[r.regime.regime]) {
      byRegime[r.regime.regime].push(r.withFilter.total);
    }
  }
  for (const reg of ["UP", "DOWN", "FLAT"]) {
    const arr = byRegime[reg];
    if (!arr.length) {
      console.log(`    ${reg}: немає місяців`);
      continue;
    }
    console.log(`    ${reg}: P&L $${sumPnl(arr)} | місяців ${arr.length}`);
  }
}

module.exports = {
  buildMonthlyReport,
  printMonthlyReport,
  computeMonthlyRegime,
  monthKey,
};
