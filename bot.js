// ============================================
// Crypto Trading Bot - MVP v0.3
// Автоматичний моніторинг ринку + тригери
// ============================================

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const cron = require("node-cron");

const config = require("./config");
const { getCandles } = require("./binance");
const { analyze } = require("./indicators");
const { checkTriggers } = require("./triggers");

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

if (!TOKEN || !CHAT_ID) {
  console.error("❌ Помилка: не задано TELEGRAM_TOKEN або CHAT_ID в .env");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: false });

// ============================================
// Зберігаємо стан, щоб не спамити однаковими
// сигналами кожні 15 хвилин
// ============================================
const recentSignals = new Map();
const SIGNAL_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 години

function isSignalRecent(symbol, signalName) {
  const key = `${symbol}_${signalName}`;
  const lastTime = recentSignals.get(key);
  if (!lastTime) return false;
  return Date.now() - lastTime < SIGNAL_COOLDOWN_MS;
}

function markSignalSent(symbol, signalName) {
  const key = `${symbol}_${signalName}`;
  recentSignals.set(key, Date.now());
}

// ============================================
// Форматування
// ============================================

function fmt(num, decimals = 2) {
  if (num === null || num === undefined) return "N/A";
  return num.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function trendIcon(trend) {
  if (trend === "bullish") return "📈";
  if (trend === "bearish") return "📉";
  return "➡️";
}

/**
 * Форматує повідомлення про сигнал
 */
function formatSignal(symbol, signal) {
  const coin = symbol.replace("USDT", "");
  const typeIcon = signal.type === "LONG" ? "📈" : "📉";

  return (
    `🚨 *${signal.type} SIGNAL — ${coin}* ${typeIcon}\n\n` +
    `*Сетап:* ${signal.name}\n` +
    `*Причина:* ${signal.reason}\n\n` +
    `📋 *План угоди:*\n` +
    `Вхід: $${fmt(signal.entry, 2)}\n` +
    `Стоп: $${fmt(signal.stop, 2)} (${fmt(signal.position.stopDistancePercent, 2)}%)\n` +
    `TP1: $${fmt(signal.tp1, 2)} (R:R ${signal.rr1.toFixed(2)})\n` +
    `TP2: $${fmt(signal.tp2, 2)} (R:R ${signal.rr2.toFixed(2)})\n\n` +
    `💰 *Параметри позиції:*\n` +
    `Маржа: $${config.risk.margin} × ${config.risk.leverage}× = $${config.risk.margin * config.risk.leverage}\n` +
    `Розмір: ${fmt(signal.position.coinsAmount, 4)} ${coin}\n` +
    `Ризик: $${fmt(signal.position.riskUsd, 2)}\n\n` +
    `⚠️ *Це не команда — це сигнал.* Перевір контекст і прийми рішення сам.`
  );
}

// ============================================
// Головна логіка
// ============================================

async function checkMarket() {
  console.log(`\n🔍 Перевірка ринку (${new Date().toLocaleTimeString()})`);

  let totalSignals = 0;

  for (const symbol of config.symbols) {
    const candles = await getCandles(
      symbol,
      config.timeframe,
      config.candlesLimit,
    );
    if (!candles) continue;

    const data = analyze(candles);
    if (!data) continue;

    const coin = symbol.replace("USDT", "");
    console.log(
      `  ${coin}: $${data.price.toFixed(2)} | RSI ${data.rsi.toFixed(1)} | ${data.trend} ${trendIcon(data.trend)}`,
    );

    // Перевіряємо тригери
    const signals = checkTriggers(symbol, data);

    for (const signal of signals) {
      // Чи не відправляли цей сигнал нещодавно?
      if (isSignalRecent(symbol, signal.name)) {
        console.log(
          `    ⏭ ${signal.name} — пропускаємо (нещодавно надсилали)`,
        );
        continue;
      }

      // Шлемо сигнал
      const message = formatSignal(symbol, signal);
      try {
        await bot.sendMessage(CHAT_ID, message, { parse_mode: "Markdown" });
        markSignalSent(symbol, signal.name);
        totalSignals++;
        console.log(`    🚨 СИГНАЛ: ${signal.type} ${signal.name}`);
      } catch (error) {
        console.error(`    ❌ Помилка відправки:`, error.message);
      }
    }
  }

  if (totalSignals === 0) {
    console.log("  💤 Сигналів немає, чекаємо...");
  } else {
    console.log(`✅ Відправлено сигналів: ${totalSignals}`);
  }
}

// ============================================
// Запуск
// ============================================

async function start() {
  console.log("🤖 Crypto Bot стартує...");
  console.log(`📊 Монети: ${config.symbols.join(", ")}`);
  console.log(`⏰ Таймфрейм: ${config.timeframe}`);
  console.log(`🔁 Перевірка кожні ${config.checkIntervalMinutes} хв\n`);

  // Перше повідомлення в Telegram
  await bot.sendMessage(
    CHAT_ID,
    `🤖 *Crypto Bot запущено!*\n\n` +
      `Монети: ${config.symbols.map((s) => s.replace("USDT", "")).join(", ")}\n` +
      `Таймфрейм: ${config.timeframe}\n` +
      `Перевірка: кожні ${config.checkIntervalMinutes} хв\n\n` +
      `Тепер я буду стежити за ринком 24/7 і писати, коли побачу сетап. 📊`,
    { parse_mode: "Markdown" },
  );

  // Перевіряємо одразу при старті
  await checkMarket();

  // Налаштовуємо cron — перевірка кожні X хвилин
  const cronExpression = `*/${config.checkIntervalMinutes} * * * *`;
  cron.schedule(cronExpression, checkMarket);

  console.log(`\n✅ Бот працює. Натисни Ctrl+C щоб зупинити.\n`);
}

start();
