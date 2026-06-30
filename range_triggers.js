// ============================================
// RANGE TRIGGERS — для боковика (FLAT)
// 1) RSI mean-reversion: вхід проти краю, ціль — середина
// 2) Range breakout: вхід на пробої меж боковика
// ============================================

const config = require("./config");

// --- RSI (Wilder) на масиві 1H-свічок ---
function rsiSeries(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  if (candles.length < period + 1) return out;

  let gain = 0,
    loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = candles[i].close - candles[i - 1].close;
    if (ch >= 0) gain += ch;
    else loss -= ch;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < candles.length; i++) {
    const ch = candles[i].close - candles[i - 1].close;
    const g = ch >= 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function calcPosition(entry, stop) {
  const { margin, leverage } = config.risk;
  const positionSize = margin * leverage;
  const stopDistance = Math.abs(entry - stop) / entry;
  return { positionSize, riskUsd: positionSize * stopDistance };
}

function buildSignal(type, name, entry, stop) {
  const dist = Math.abs(entry - stop);
  const tp1 = type === "LONG" ? entry + dist * 2 : entry - dist * 2;
  const tp2 = type === "LONG" ? entry + dist * 3 : entry - dist * 3;
  const position = calcPosition(entry, stop);
  if (position.riskUsd > config.risk.maxRiskUsd) return null;
  return { type, name, entry, stop, tp1, tp2, position };
}

// кеш RSI по символу
let _rsiCache = { key: null, rsi: null };
function getRSI(candles, symbol) {
  if (_rsiCache.key !== symbol) {
    _rsiCache = {
      key: symbol,
      rsi: rsiSeries(candles, config.rangeParams.rsiPeriod),
    };
  }
  return _rsiCache.rsi;
}

// ============================================
// ТРИГЕР 1: RSI mean-reversion
// Перепроданість -> лонг (повернення вгору), перекупленість -> шорт
// ============================================
function rsiReversionLong(candles, i, symbol) {
  if (i < config.rangeParams.rsiPeriod + 2) return null;
  const rsi = getRSI(candles, symbol);
  if (rsi[i] == null || rsi[i - 1] == null) return null;

  const { rsiLow } = config.rangeParams;
  const c = candles[i],
    prev = candles[i - 1];

  // RSI був нижче порога й починає розвертатись вгору + бичача свічка
  const oversold = rsi[i - 1] < rsiLow;
  const turningUp = rsi[i] > rsi[i - 1];
  const bullish = c.close > c.open;
  if (!oversold || !turningUp || !bullish) return null;

  const entry = c.close;
  const stop = Math.min(c.low, prev.low) * 0.997;
  if (stop >= entry) return null;
  return buildSignal("LONG", "RsiReversionLong", entry, stop);
}

function rsiReversionShort(candles, i, symbol) {
  if (i < config.rangeParams.rsiPeriod + 2) return null;
  const rsi = getRSI(candles, symbol);
  if (rsi[i] == null || rsi[i - 1] == null) return null;

  const { rsiHigh } = config.rangeParams;
  const c = candles[i],
    prev = candles[i - 1];

  const overbought = rsi[i - 1] > rsiHigh;
  const turningDown = rsi[i] < rsi[i - 1];
  const bearish = c.close < c.open;
  if (!overbought || !turningDown || !bearish) return null;

  const entry = c.close;
  const stop = Math.max(c.high, prev.high) * 1.003;
  if (stop <= entry) return null;
  return buildSignal("SHORT", "RsiReversionShort", entry, stop);
}

// ============================================
// ТРИГЕР 2: Range breakout
// Пробій верху/низу діапазону останніх N свічок (кінець боковика)
// ============================================
function rangeBreakoutLong(candles, i) {
  const N = config.rangeParams.breakoutWindow;
  if (i < N + 2) return null;
  const window = candles.slice(i - N, i);
  const hh = Math.max(...window.map((x) => x.high));
  const c = candles[i];

  // close пробиває верх діапазону на буфер
  if (c.close <= hh * (1 + config.rangeParams.breakoutBuffer)) return null;
  if (c.close <= c.open) return null;

  const entry = c.close;
  const stop = Math.min(...window.slice(-5).map((x) => x.low)) * 0.998;
  if (stop >= entry) return null;
  return buildSignal("LONG", "RangeBreakoutLong", entry, stop);
}

function rangeBreakoutShort(candles, i) {
  const N = config.rangeParams.breakoutWindow;
  if (i < N + 2) return null;
  const window = candles.slice(i - N, i);
  const ll = Math.min(...window.map((x) => x.low));
  const c = candles[i];

  if (c.close >= ll * (1 - config.rangeParams.breakoutBuffer)) return null;
  if (c.close >= c.open) return null;

  const entry = c.close;
  const stop = Math.max(...window.slice(-5).map((x) => x.high)) * 1.002;
  if (stop <= entry) return null;
  return buildSignal("SHORT", "RangeBreakoutShort", entry, stop);
}

const RANGE_TRIGGERS = [
  rsiReversionLong,
  rsiReversionShort,
  rangeBreakoutLong,
  rangeBreakoutShort,
];

function checkRangeTriggers(candles, i, symbol) {
  const signals = [];
  for (const fn of RANGE_TRIGGERS) {
    const s = fn(candles, i, symbol);
    if (s) signals.push(s);
  }
  return signals;
}

module.exports = { checkRangeTriggers };
