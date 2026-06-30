// ============================================
// ЧИСЛОВИЙ ПРОФІЛЬ ETH — вимірюємо інструмент
// (не підганяємо стратегію, а описуємо поведінку)
// ============================================

const { getCandlesHistory } = require("./binance");

const SYMBOL = "ETHUSDT";
const TF = "4h";
const COUNT = 12000; // ~5.5 років 4H

function pct(x) {
  return (x * 100).toFixed(2) + "%";
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function mean(arr) {
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function std(arr) {
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((x) => (x - m) ** 2)));
}

async function run() {
  console.log("📊 ЧИСЛОВИЙ ПРОФІЛЬ ETH (4H)");
  console.log("═".repeat(55));

  const candles = await getCandlesHistory(SYMBOL, TF, COUNT);
  if (!candles || candles.length < 500) {
    console.log("❌ Мало даних");
    return;
  }
  const first = new Date(candles[0].openTime).toISOString().slice(0, 10);
  const last = new Date(candles[candles.length - 1].openTime)
    .toISOString()
    .slice(0, 10);
  console.log(`Свічок: ${candles.length} | ${first} → ${last}\n`);

  // ── 1. ВОЛАТИЛЬНІСТЬ ──────────────────────────
  // розмах свічки (high-low)/open та тіло |close-open|/open
  const ranges = [],
    bodies = [],
    returns = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    ranges.push((c.high - c.low) / c.open);
    bodies.push(Math.abs(c.close - c.open) / c.open);
    returns.push((c.close - candles[i - 1].close) / candles[i - 1].close);
  }
  console.log("1️⃣  ВОЛАТИЛЬНІСТЬ (на одну 4H-свічку):");
  console.log(
    `   Середній розмах (H-L): ${pct(mean(ranges))} | медіана ${pct(median(ranges))}`,
  );
  console.log(
    `   Середнє тіло:          ${pct(mean(bodies))} | медіана ${pct(median(bodies))}`,
  );
  console.log(`   Std дохідності:        ${pct(std(returns))}`);
  console.log(
    `   → Орієнтир: стоп має бути ширшим за медіанний розмах, інакше шум вибиватиме.\n`,
  );

  // ── 2. МОМЕНТУМ vs РОЗВОРОТ (автокореляція) ──
  // кореляція дохідності свічки з наступною. >0 = моментум, <0 = розворот
  const r0 = returns.slice(0, -1);
  const r1 = returns.slice(1);
  const mr0 = mean(r0),
    mr1 = mean(r1);
  let cov = 0,
    v0 = 0,
    v1 = 0;
  for (let i = 0; i < r0.length; i++) {
    cov += (r0[i] - mr0) * (r1[i] - mr1);
    v0 += (r0[i] - mr0) ** 2;
    v1 += (r1[i] - mr1) ** 2;
  }
  const autocorr = cov / Math.sqrt(v0 * v1);
  console.log("2️⃣  МОМЕНТУМ vs РОЗВОРОТ (автокореляція сусідніх свічок):");
  console.log(`   Автокореляція lag-1: ${autocorr.toFixed(4)}`);
  if (autocorr > 0.03)
    console.log(
      "   → МОМЕНТУМ: рухи продовжуються → тренд/breakout підходять.",
    );
  else if (autocorr < -0.03)
    console.log("   → РОЗВОРОТ: рухи відкочуються → mean-reversion підходить.");
  else
    console.log(
      "   → НЕМАЄ: близько нуля → напрямок наступної свічки майже випадковий (важко).",
    );
  console.log("");

  // ── 3. ПОВЕДІНКА ПО ДНЯХ ТИЖНЯ ────────────────
  console.log("3️⃣  ВОЛАТИЛЬНІСТЬ ПО ДНЯХ ТИЖНЯ (середній розмах):");
  const days = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  const byDay = Array.from({ length: 7 }, () => []);
  for (let i = 1; i < candles.length; i++) {
    const d = new Date(candles[i].openTime).getUTCDay();
    byDay[d].push((candles[i].high - candles[i].low) / candles[i].open);
  }
  for (let d = 0; d < 7; d++) {
    if (byDay[d].length) console.log(`   ${days[d]}: ${pct(mean(byDay[d]))}`);
  }
  console.log("");

  // ── 4. ПОВЕДІНКА ПО ГОДИНАХ (UTC, старт 4H-свічки) ──
  console.log("4️⃣  ВОЛАТИЛЬНІСТЬ ПО ГОДИНАХ UTC (старт 4H-бару):");
  const byHour = {};
  for (let i = 1; i < candles.length; i++) {
    const h = new Date(candles[i].openTime).getUTCHours();
    (byHour[h] ||= []).push(
      (candles[i].high - candles[i].low) / candles[i].open,
    );
  }
  for (const h of Object.keys(byHour).sort((a, b) => a - b)) {
    console.log(
      `   ${String(h).padStart(2, "0")}:00 UTC → ${pct(mean(byHour[h]))} (${byHour[h].length} свічок)`,
    );
  }
  console.log("");

  // ── 5. РОЗПОДІЛ ВЕЛИЧИНИ РУХІВ ────────────────
  console.log("5️⃣  РОЗПОДІЛ РОЗМАХУ СВІЧОК (скільки дрібних vs великих):");
  const buckets = { "<1%": 0, "1-2%": 0, "2-3%": 0, "3-5%": 0, ">5%": 0 };
  for (const r of ranges) {
    const p = r * 100;
    if (p < 1) buckets["<1%"]++;
    else if (p < 2) buckets["1-2%"]++;
    else if (p < 3) buckets["2-3%"]++;
    else if (p < 5) buckets["3-5%"]++;
    else buckets[">5%"]++;
  }
  for (const [k, v] of Object.entries(buckets)) {
    console.log(`   ${k.padEnd(6)}: ${v} (${pct(v / ranges.length)})`);
  }
  console.log("");

  // ── 6. НАПРЯМОК: скільки зелених vs червоних ──
  let green = 0;
  for (const c of candles) if (c.close > c.open) green++;
  console.log("6️⃣  БАЛАНС НАПРЯМКУ:");
  console.log(
    `   Зелених свічок: ${pct(green / candles.length)} | Червоних: ${pct(1 - green / candles.length)}`,
  );

  console.log("\n" + "═".repeat(55));
  console.log(
    "Готово. Дивимось на №2 (моментум/розворот) — він каже клас стратегії.",
  );
}

run();
