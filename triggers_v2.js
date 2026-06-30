// ============================================
// TRIGGERS V2 — нові тригери під режимну маршрутизацію
// EMA-ретест / Breakout / Range-відбій
// ============================================

const config = require("./config");

// --- допоміжне: проста EMA на масиві свічок (1H) ---
function emaSeries(candles, period, field = "close") {
  const out = new Array(candles.length).fill(null);
  if (candles.length < period) return out;
  let sma = 0;
  for (let i = 0; i < period; i++) sma += candles[i][field];
  out[period - 1] = sma / period;
  const k = 2 / (period + 1);
  for (let i = period; i < candles.length; i++) {
    out[i] = candles[i][field] * k + out[i - 1] * (1 - k);
  }
  return out;
}

// --- позиція/ризик (та сама логіка, що в твоєму triggers.js) ---
function calcPosition(entry, stop) {
  const { margin, leverage } = config.risk;
  const positionSize = margin * leverage;
  const stopDistance = Math.abs(entry - stop) / entry;
  return { positionSize, riskUsd: positionSize * stopDistance };
}

function buildSignal(type, name, entry, stop, candles, i) {
  const dist = Math.abs(entry - stop);
  const tp1 = type === "LONG" ? entry + dist * 2 : entry - dist * 2;
  const tp2 = type === "LONG" ? entry + dist * 3 : entry - dist * 3;
  const position = calcPosition(entry, stop);
  if (position.riskUsd > config.risk.maxRiskUsd) return null;
  return { type, name, entry, stop, tp1, tp2, position };
}

// Кеш EMA по символу, щоб не рахувати на кожній свічці
let _emaCache = { key: null, ema20: null, ema50: null };
function getEMAs(candles, symbol) {
  if (_emaCache.key !== symbol) {
    _emaCache = {
      key: symbol,
      ema20: emaSeries(candles, 20),
      ema50: emaSeries(candles, 50),
    };
  }
  return _emaCache;
}

// ============================================
// ТРИГЕР: EMA-ретест у тренді
// Логіка: ціна в аптренді відкотилась до EMA20 і відбилась вгору (бичача свічка)
// ============================================
function emaRetestLong(candles, i, symbol) {
  if (i < 55) return null;
  const { ema20 } = getEMAs(candles, symbol);
  if (ema20[i] == null || ema20[i - 1] == null) return null;

  const c = candles[i],
    prev = candles[i - 1];
  // ціна торкнулась EMA20 знизу-вгору: low попередньої/поточної біля EMA, close вище EMA
  const touched = prev.low <= ema20[i - 1] * 1.005 || c.low <= ema20[i] * 1.005;
  const bullish = c.close > c.open && c.close > ema20[i];
  if (!touched || !bullish) return null;

  const entry = c.close;
  const stop = Math.min(c.low, prev.low) * 0.998;
  if (stop >= entry) return null;
  return buildSignal("LONG", "EmaRetestLong", entry, stop, candles, i);
}

function emaRetestShort(candles, i, symbol) {
  if (i < 55) return null;
  const { ema20 } = getEMAs(candles, symbol);
  if (ema20[i] == null || ema20[i - 1] == null) return null;

  const c = candles[i],
    prev = candles[i - 1];
  const touched =
    prev.high >= ema20[i - 1] * 0.995 || c.high >= ema20[i] * 0.995;
  const bearish = c.close < c.open && c.close < ema20[i];
  if (!touched || !bearish) return null;

  const entry = c.close;
  const stop = Math.max(c.high, prev.high) * 1.002;
  if (stop <= entry) return null;
  return buildSignal("SHORT", "EmaRetestShort", entry, stop, candles, i);
}

// ============================================
// ТРИГЕР: Breakout — пробій локального екстремуму
// Логіка: close пробиває max/min останніх N свічок
// ============================================
function breakoutLong(candles, i) {
  if (i < 25) return null;
  const N = 20;
  const window = candles.slice(i - N, i);
  const hh = Math.max(...window.map((x) => x.high));
  const c = candles[i];
  if (c.close <= hh) return null; // має пробити
  if (c.close <= c.open) return null; // бичача свічка

  const entry = c.close;
  const stop = Math.min(...window.slice(-5).map((x) => x.low)) * 0.998;
  if (stop >= entry) return null;
  return buildSignal("LONG", "BreakoutLong", entry, stop, candles, i);
}

function breakoutShort(candles, i) {
  if (i < 25) return null;
  const N = 20;
  const window = candles.slice(i - N, i);
  const ll = Math.min(...window.map((x) => x.low));
  const c = candles[i];
  if (c.close >= ll) return null;
  if (c.close >= c.open) return null;

  const entry = c.close;
  const stop = Math.max(...window.slice(-5).map((x) => x.high)) * 1.002;
  if (stop <= entry) return null;
  return buildSignal("SHORT", "BreakoutShort", entry, stop, candles, i);
}

// ============================================
// ТРИГЕР: Range-відбій від меж боковика
// Логіка: визначаємо діапазон останніх N свічок; вхід від краю до середини
// ============================================
function rangeLong(candles, i) {
  if (i < 35) return null;
  const N = 30;
  const window = candles.slice(i - N, i);
  const hi = Math.max(...window.map((x) => x.high));
  const lo = Math.min(...window.map((x) => x.low));
  const range = hi - lo;
  if (range <= 0) return null;

  const c = candles[i];
  // ціна біля низу діапазону (нижні 25%) і відбивається вгору
  const nearLow = c.low <= lo + range * 0.25;
  const bullish = c.close > c.open;
  if (!nearLow || !bullish) return null;

  const entry = c.close;
  const stop = lo * 0.997; // стоп під низом діапазону
  if (stop >= entry) return null;
  return buildSignal("LONG", "RangeLong", entry, stop, candles, i);
}

function rangeShort(candles, i) {
  if (i < 35) return null;
  const N = 30;
  const window = candles.slice(i - N, i);
  const hi = Math.max(...window.map((x) => x.high));
  const lo = Math.min(...window.map((x) => x.low));
  const range = hi - lo;
  if (range <= 0) return null;

  const c = candles[i];
  const nearHigh = c.high >= hi - range * 0.25;
  const bearish = c.close < c.open;
  if (!nearHigh || !bearish) return null;

  const entry = c.close;
  const stop = hi * 1.003;
  if (stop <= entry) return null;
  return buildSignal("SHORT", "RangeShort", entry, stop, candles, i);
}

const V2_TRIGGERS = [
  emaRetestLong,
  emaRetestShort,
  breakoutLong,
  breakoutShort,
  rangeLong,
  rangeShort,
];

function checkTriggersV2(candles, i, symbol) {
  const signals = [];
  for (const fn of V2_TRIGGERS) {
    const s = fn(candles, i, symbol);
    if (s) signals.push(s);
  }
  return signals;
}

module.exports = { checkTriggersV2 };
