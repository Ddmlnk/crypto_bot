// ============================================
// Crypto Bot — моніторинг + журнал + автоперевірка результату
// ============================================

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");
const cron = require("node-cron");

const config = require("./config");
const { getCandlesHistory } = require("./binance");
const { checkTriggers } = require("./triggers");
const { checkTriggersV2 } = require("./triggers_v2");
const { computeRegimeSeries } = require("./regime");

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

if (!TOKEN || !CHAT_ID) {
  console.error("❌ Не задано TELEGRAM_TOKEN або CHAT_ID в .env");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: false });

const CANDLES_NEEDED = 400;
const DIGEST_HOUR = 8;

// --- файли ---
const DIR = "forward-test";
const JOURNAL = path.join(DIR, "signals.csv");
const STATE = path.join(DIR, "open_signals.json"); // відкриті сигнали (переживають перезапуск)

const sentForCandle = new Set();
let openSignals = []; // { id, symbol, name, type, entry, stop, tp1, tp2, openedAt }

// --- ініціалізація файлів ---
function ensureFiles() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  if (!fs.existsSync(JOURNAL)) {
    fs.writeFileSync(
      JOURNAL,
      "id,OpenedAt,Symbol,Trigger,Type,Macro,Entry,Stop,TP1,TP2,Status,ClosedAt,ExitPrice,Result\n",
    );
  }
  if (fs.existsSync(STATE)) {
    try {
      openSignals = JSON.parse(fs.readFileSync(STATE, "utf8"));
    } catch {
      openSignals = [];
    }
  }
}

function saveState() {
  fs.writeFileSync(STATE, JSON.stringify(openSignals, null, 2));
}

function appendJournal(row) {
  fs.appendFileSync(JOURNAL, row + "\n");
}

// перезаписати рядок журналу зі статусом OPEN на закритий (за id)
function closeJournalRow(sig, status, exitPrice, result) {
  const lines = fs.readFileSync(JOURNAL, "utf8").split("\n");
  const out = lines.map((line) => {
    if (!line.startsWith(sig.id + ",")) return line;
    const cols = line.split(",");
    cols[10] = status; // Status
    cols[11] = new Date().toISOString(); // ClosedAt
    cols[12] = exitPrice.toFixed(4); // ExitPrice
    cols[13] = result; // Result (R)
    return cols.join(",");
  });
  fs.writeFileSync(JOURNAL, out.join("\n"));
}

function passesRouting(signalName, regime) {
  const rule = config.triggerRouting[signalName];
  if (!rule || !regime) return false;
  const macro = regime.macro || "UNKNOWN";
  return Array.isArray(rule.macro) && rule.macro.includes(macro);
}

function formatSignal(symbol, sig, macro) {
  const coin = symbol.replace("USDT", "");
  const typeIcon = sig.type === "LONG" ? "📈" : "📉";
  return (
    `🚨 *${sig.type} SIGNAL — ${coin}* ${typeIcon}\n\n` +
    `*Тригер:* ${sig.name}\n*Режим:* ${macro}\n\n` +
    `📋 Вхід: $${sig.entry.toFixed(2)}\n` +
    `Стоп: $${sig.stop.toFixed(2)}\n` +
    `TP1: $${sig.tp1.toFixed(2)}\nTP2: $${sig.tp2.toFixed(2)}\n\n` +
    `⚠️ Сигнал, не команда. Forward-журнал.`
  );
}

async function getRegimeFor(symbol) {
  const candles = await getCandlesHistory(
    symbol,
    config.timeframe,
    CANDLES_NEEDED,
  );
  if (!candles || candles.length < 250) return null;
  const i = candles.length - 2;
  const regimeSeries = computeRegimeSeries(candles, config.regime);
  return {
    candles,
    i,
    regime: regimeSeries[i],
    price: candles[i].close,
    macro: regimeSeries[i] ? regimeSeries[i].macro : "UNKNOWN",
  };
}

/// ── АВТОПЕРЕВІРКА відкритих сигналів на 5m (точний порядок торкань) ──
async function checkOpenSignals() {
  if (openSignals.length === 0) return;
  console.log(
    `  🔎 Перевіряю ${openSignals.length} відкритих сигналів (5m)...`,
  );

  const stillOpen = [];

  for (const sig of openSignals) {
    // тягнемо 5m-свічки ВІД моменту входу до зараз (з пагінацією)
    const candles5m = await get5mSince(sig.symbol, sig.openedAtMs);

    if (!candles5m || candles5m.length === 0) {
      stillOpen.push(sig); // не змогли перевірити — лишаємо відкритим
      continue;
    }

    let closed = null;
    for (const c of candles5m) {
      if (c.openTime <= sig.openedAtMs) continue; // тільки після входу

      if (sig.type === "LONG") {
        // песимістично лише в межах ОДНІЄЇ 5m: якщо зачепило і стоп, і TP — STOP
        if (c.low <= sig.stop) {
          closed = { status: "STOP", price: sig.stop, r: -1 };
          break;
        }
        if (c.high >= sig.tp2) {
          closed = { status: "TP2", price: sig.tp2, r: 3 };
          break;
        }
        if (c.high >= sig.tp1) {
          closed = { status: "TP1", price: sig.tp1, r: 2 };
          break;
        }
      } else {
        if (c.high >= sig.stop) {
          closed = { status: "STOP", price: sig.stop, r: -1 };
          break;
        }
        if (c.low <= sig.tp2) {
          closed = { status: "TP2", price: sig.tp2, r: 3 };
          break;
        }
        if (c.low <= sig.tp1) {
          closed = { status: "TP1", price: sig.tp1, r: 2 };
          break;
        }
      }
    }

    if (closed) {
      closeJournalRow(sig, closed.status, closed.price, closed.r);
      const coin = sig.symbol.replace("USDT", "");
      const icon = closed.status === "STOP" ? "🔴" : "🟢";
      try {
        await bot.sendMessage(
          CHAT_ID,
          `${icon} *${coin} — ${closed.status}*\n\n` +
            `Тригер: ${sig.name} (${sig.type})\n` +
            `Вхід: $${sig.entry.toFixed(2)} → Вихід: $${closed.price.toFixed(2)}\n` +
            `Результат: ${closed.r > 0 ? "+" : ""}${closed.r}R`,
          { parse_mode: "Markdown" },
        );
      } catch (e) {
        console.error("  ❌ Telegram:", e.message);
      }
      console.log(
        `    ${icon} ${coin} ${sig.name} → ${closed.status} (${closed.r}R)`,
      );
    } else {
      stillOpen.push(sig); // ще відкритий
    }
  }

  openSignals = stillOpen;
  saveState();
}

// тягне 5m-свічки від startMs до зараз, з пагінацією (макс ~5 запитів = ~17 діб)
async function get5mSince(symbol, startMs) {
  const BINANCE = "https://api.binance.com/api/v3";
  const all = [];
  let from = startMs;
  const now = Date.now();
  let guard = 0;

  while (from < now && guard < 5) {
    guard++;
    const url = `${BINANCE}/klines?symbol=${symbol}&interval=5m&startTime=${from}&limit=1000`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) break;
      const data = await resp.json();
      if (!data.length) break;

      for (const c of data) {
        all.push({
          openTime: c[0],
          open: parseFloat(c[1]),
          high: parseFloat(c[2]),
          low: parseFloat(c[3]),
          close: parseFloat(c[4]),
        });
      }
      // наступна пачка — від часу останньої свічки + 1мс
      from = data[data.length - 1][0] + 1;
      if (data.length < 1000) break; // дійшли до кінця
      await new Promise((r) => setTimeout(r, 150)); // пауза між запитами
    } catch (e) {
      console.error(`  ❌ 5m fetch ${symbol}:`, e.message);
      break;
    }
  }
  return all;
}

// ── ПОШУК НОВИХ СИГНАЛІВ ──
async function checkSymbol(symbol) {
  const info = await getRegimeFor(symbol);
  if (!info) return 0;
  const { candles, i, regime, macro, price } = info;

  const candleKey = `${symbol}_${candles[i].openTime}`;
  if (sentForCandle.has(candleKey)) return 0;
  sentForCandle.add(candleKey);

  const coin = symbol.replace("USDT", "");
  console.log(`  ${coin}: $${price.toFixed(2)} | ${macro}`);

  const raw = [
    ...checkTriggers(candles, i),
    ...checkTriggersV2(candles, i, symbol),
  ];
  const signals = raw.filter((s) => passesRouting(s.name, regime));

  let sent = 0;
  for (const sig of signals) {
    const id = `${symbol}_${sig.name}_${candles[i].openTime}`;
    // не дублюємо вже відкритий
    if (openSignals.some((o) => o.id === id)) continue;

    const record = {
      id,
      symbol,
      name: sig.name,
      type: sig.type,
      entry: sig.entry,
      stop: sig.stop,
      tp1: sig.tp1,
      tp2: sig.tp2,
      openedAtMs: candles[i].openTime,
    };
    openSignals.push(record);
    saveState();

    appendJournal(
      [
        id,
        new Date().toISOString(),
        symbol,
        sig.name,
        sig.type,
        macro,
        sig.entry.toFixed(4),
        sig.stop.toFixed(4),
        sig.tp1.toFixed(4),
        sig.tp2.toFixed(4),
        "OPEN",
        "",
        "",
        "",
      ].join(","),
    );

    try {
      await bot.sendMessage(CHAT_ID, formatSignal(symbol, sig, macro), {
        parse_mode: "Markdown",
      });
      console.log(`    🚨 ${sig.type} ${sig.name} @ $${sig.entry.toFixed(2)}`);
      sent++;
    } catch (e) {
      console.error("    ❌ Telegram:", e.message);
    }
  }
  return sent;
}

async function checkMarket() {
  console.log(`\n🔍 Перевірка (${new Date().toLocaleTimeString()})`);
  await checkOpenSignals(); // спершу перевіряємо відкриті
  let total = 0;
  for (const symbol of config.symbols) total += await checkSymbol(symbol);
  if (total === 0) console.log("  💤 Нових сигналів немає");
  if (sentForCandle.size > 2000) sentForCandle.clear();
}

async function dailyDigest() {
  const icon = { UP: "🟢", DOWN: "🔴", FLAT: "⚪", UNKNOWN: "❔" };
  const lines = [];
  const counts = { UP: 0, DOWN: 0, FLAT: 0 };
  for (const symbol of config.symbols) {
    const info = await getRegimeFor(symbol);
    const coin = symbol.replace("USDT", "");
    if (!info) {
      lines.push(`❔ ${coin}: н/д`);
      continue;
    }
    counts[info.macro] = (counts[info.macro] || 0) + 1;
    lines.push(
      `${icon[info.macro] || "❔"} *${coin}* — ${info.macro} ($${info.price.toFixed(2)})`,
    );
  }
  const msg =
    `📅 *Ранковий огляд*\n${new Date().toLocaleDateString("uk-UA")}\n\n` +
    lines.join("\n") +
    `\n\n🟢 UP: ${counts.UP}  🔴 DOWN: ${counts.DOWN}  ⚪ FLAT: ${counts.FLAT}\n\n` +
    `Відкритих сигналів у журналі: ${openSignals.length}`;
  try {
    await bot.sendMessage(CHAT_ID, msg, { parse_mode: "Markdown" });
  } catch (e) {
    console.error("❌ Telegram:", e.message);
  }
}

async function start() {
  ensureFiles();
  console.log("🤖 Crypto Bot стартує (1H, журнал + автоперевірка)");
  console.log(
    `📁 Журнал: ${JOURNAL} | відкритих при старті: ${openSignals.length}`,
  );

  const active = Object.entries(config.triggerRouting)
    .filter(([, r]) => r.macro && r.macro.length)
    .map(([n, r]) => `${n}(${r.macro.join("/")})`);

  await bot.sendMessage(
    CHAT_ID,
    `🤖 *Бот запущено*\nМонети: ${config.symbols.map((s) => s.replace("USDT", "")).join(", ")}\n` +
      `1H | Режим 4H | Дайджест о ${DIGEST_HOUR}:00\n\n` +
      `Активні:\n${active.map((a) => "• " + a).join("\n")}\n\n` +
      `Веду журнал сигналів і перевіряю результат (STOP/TP1/TP2).`,
    { parse_mode: "Markdown" },
  );

  await checkMarket();
  cron.schedule("2 * * * *", checkMarket);
  cron.schedule(`0 ${DIGEST_HOUR} * * *`, dailyDigest);

  console.log("\n✅ Бот працює. Ctrl+C щоб зупинити.\n");
}

start();
