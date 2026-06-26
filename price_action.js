// ============================================
// PRICE ACTION — утиліти для аналізу руху ціни
// ============================================

function isSwingHigh(candles, index, lookback = 5) {
  if (index < lookback || index >= candles.length - lookback) return false;
  const high = candles[index].high;
  for (let i = 1; i <= lookback; i++) {
    if (candles[index - i].high >= high) return false;
    if (candles[index + i].high >= high) return false;
  }
  return true;
}

function isSwingLow(candles, index, lookback = 5) {
  if (index < lookback || index >= candles.length - lookback) return false;
  const low = candles[index].low;
  for (let i = 1; i <= lookback; i++) {
    if (candles[index - i].low <= low) return false;
    if (candles[index + i].low <= low) return false;
  }
  return true;
}

function findRecentSwingHigh(
  candles,
  currentIndex,
  lookback = 5,
  maxBars = 50,
) {
  const start = Math.max(lookback, currentIndex - maxBars);
  for (let i = currentIndex - lookback; i >= start; i--) {
    if (isSwingHigh(candles, i, lookback)) return i;
  }
  return null;
}

function findRecentSwingLow(candles, currentIndex, lookback = 5, maxBars = 50) {
  const start = Math.max(lookback, currentIndex - maxBars);
  for (let i = currentIndex - lookback; i >= start; i--) {
    if (isSwingLow(candles, i, lookback)) return i;
  }
  return null;
}

function isBullishPinBar(candle) {
  const { open, high, low, close } = candle;
  const body = Math.abs(close - open);
  const totalRange = high - low;
  if (body === 0 || totalRange === 0) return false;

  const lowerWick = Math.min(open, close) - low;
  const upperWick = high - Math.max(open, close);

  if (body > totalRange * 0.35) return false;
  if (lowerWick < totalRange * 0.6) return false;
  if (upperWick > body) return false;

  const closePosition = (close - low) / totalRange;
  if (closePosition < 0.6) return false;

  return true;
}

function isBearishPinBar(candle) {
  const { open, high, low, close } = candle;
  const body = Math.abs(close - open);
  const totalRange = high - low;
  if (body === 0 || totalRange === 0) return false;

  const lowerWick = Math.min(open, close) - low;
  const upperWick = high - Math.max(open, close);

  if (body > totalRange * 0.35) return false;
  if (upperWick < totalRange * 0.6) return false;
  if (lowerWick > body) return false;

  const closePosition = (close - low) / totalRange;
  if (closePosition > 0.4) return false;

  return true;
}

function isBullishEngulfing(prevCandle, currentCandle) {
  if (prevCandle.close >= prevCandle.open) return false;
  if (currentCandle.close <= currentCandle.open) return false;
  if (currentCandle.open > prevCandle.close) return false;
  if (currentCandle.close < prevCandle.open) return false;
  return true;
}

function isBearishEngulfing(prevCandle, currentCandle) {
  if (prevCandle.close <= prevCandle.open) return false;
  if (currentCandle.close >= currentCandle.open) return false;
  if (currentCandle.open < prevCandle.close) return false;
  if (currentCandle.close > prevCandle.open) return false;
  return true;
}

function getMarketStructure(candles, lookback = 50) {
  if (candles.length < lookback) return "ranging";

  const recent = candles.slice(-lookback);
  const firstHalf = recent.slice(0, Math.floor(lookback / 2));
  const secondHalf = recent.slice(Math.floor(lookback / 2));

  const firstHigh = Math.max(...firstHalf.map((c) => c.high));
  const firstLow = Math.min(...firstHalf.map((c) => c.low));
  const secondHigh = Math.max(...secondHalf.map((c) => c.high));
  const secondLow = Math.min(...secondHalf.map((c) => c.low));

  if (secondHigh > firstHigh && secondLow > firstLow) return "bullish";
  if (secondHigh < firstHigh && secondLow < firstLow) return "bearish";
  return "ranging";
}

function touchedLevel(candle, level, tolerancePercent = 0.3) {
  const tolerance = level * (tolerancePercent / 100);
  return candle.low <= level + tolerance && candle.high >= level - tolerance;
}
/**
 * Розмір тіла свічки
 */
function bodySize(candle) {
  return Math.abs(candle.close - candle.open);
}

/**
 * Середній розмір тіла свічок за період
 */
function averageBodySize(candles, lookback = 20) {
  if (candles.length < lookback) return 0;
  const recent = candles.slice(-lookback);
  const sum = recent.reduce((s, c) => s + bodySize(c), 0);
  return sum / lookback;
}

/**
 * Перевірити чи це СИЛЬНИЙ bullish engulfing
 * (звичайний + тіло не менше N× середнього)
 */
function isStrongBullishEngulfing(
  prevCandle,
  currentCandle,
  avgBody,
  multiplier = 1.3,
) {
  if (!isBullishEngulfing(prevCandle, currentCandle)) return false;
  return bodySize(currentCandle) >= avgBody * multiplier;
}

/**
 * Перевірити чи це СИЛЬНИЙ bearish engulfing
 */
function isStrongBearishEngulfing(
  prevCandle,
  currentCandle,
  avgBody,
  multiplier = 1.3,
) {
  if (!isBearishEngulfing(prevCandle, currentCandle)) return false;
  return bodySize(currentCandle) >= avgBody * multiplier;
}

/**
 * Визначити справжню бичачу структуру через swing points
 * Шукаємо мінімум 2 послідовних HH і HL у недавньому минулому
 *
 * @returns {boolean} true якщо структура чітко бичача
 */
function isConfirmedBullishStructure(candles, currentIndex, lookback = 5) {
  // Знаходимо останні 4 swing-точки
  const swings = [];
  for (
    let i = currentIndex - lookback;
    i >= Math.max(lookback, currentIndex - 80);
    i--
  ) {
    if (isSwingHigh(candles, i, lookback)) {
      swings.push({ type: "high", price: candles[i].high, index: i });
    } else if (isSwingLow(candles, i, lookback)) {
      swings.push({ type: "low", price: candles[i].low, index: i });
    }
    if (swings.length >= 4) break;
  }

  if (swings.length < 4) return false;

  // Відсортувати по часу (старі - попереду)
  swings.reverse();

  // Беремо 2 highs і 2 lows
  const highs = swings.filter((s) => s.type === "high");
  const lows = swings.filter((s) => s.type === "low");

  if (highs.length < 2 || lows.length < 2) return false;

  // HH + HL: останній high > попередній high, останній low > попередній low
  const lastHigh = highs[highs.length - 1].price;
  const prevHigh = highs[highs.length - 2].price;
  const lastLow = lows[lows.length - 1].price;
  const prevLow = lows[lows.length - 2].price;

  return lastHigh > prevHigh && lastLow > prevLow;
}

/**
 * Те саме для ведмежої структури (LH + LL)
 */
function isConfirmedBearishStructure(candles, currentIndex, lookback = 5) {
  const swings = [];
  for (
    let i = currentIndex - lookback;
    i >= Math.max(lookback, currentIndex - 80);
    i--
  ) {
    if (isSwingHigh(candles, i, lookback)) {
      swings.push({ type: "high", price: candles[i].high, index: i });
    } else if (isSwingLow(candles, i, lookback)) {
      swings.push({ type: "low", price: candles[i].low, index: i });
    }
    if (swings.length >= 4) break;
  }

  if (swings.length < 4) return false;
  swings.reverse();

  const highs = swings.filter((s) => s.type === "high");
  const lows = swings.filter((s) => s.type === "low");

  if (highs.length < 2 || lows.length < 2) return false;

  const lastHigh = highs[highs.length - 1].price;
  const prevHigh = highs[highs.length - 2].price;
  const lastLow = lows[lows.length - 1].price;
  const prevLow = lows[lows.length - 2].price;

  return lastHigh < prevHigh && lastLow < prevLow;
}

/**
 * Виміряти глибину корекції від останнього swing high
 * @returns {number} відсоток корекції (0.05 = 5%)
 */
function measurePullbackDepth(candles, currentIndex, lookback = 5) {
  const swingHighIdx = findRecentSwingHigh(candles, currentIndex, lookback, 30);
  if (swingHighIdx === null) return 0;

  const swingHighPrice = candles[swingHighIdx].high;
  const currentLow = Math.min(
    ...candles.slice(swingHighIdx, currentIndex + 1).map((c) => c.low),
  );

  return (swingHighPrice - currentLow) / swingHighPrice;
}

/**
 * Виміряти глибину відскоку від останнього swing low (для шортів)
 */
function measureRallyDepth(candles, currentIndex, lookback = 5) {
  const swingLowIdx = findRecentSwingLow(candles, currentIndex, lookback, 30);
  if (swingLowIdx === null) return 0;

  const swingLowPrice = candles[swingLowIdx].low;
  const currentHigh = Math.max(
    ...candles.slice(swingLowIdx, currentIndex + 1).map((c) => c.high),
  );

  return (currentHigh - swingLowPrice) / swingLowPrice;
}
module.exports = {
  isSwingHigh,
  isSwingLow,
  findRecentSwingHigh,
  findRecentSwingLow,
  isBullishPinBar,
  isBearishPinBar,
  isBullishEngulfing,
  isBearishEngulfing,
  getMarketStructure,
  touchedLevel,
  // нові:
  bodySize,
  averageBodySize,
  isStrongBullishEngulfing,
  isStrongBearishEngulfing,
  isConfirmedBullishStructure,
  isConfirmedBearishStructure,
  measurePullbackDepth,
  measureRallyDepth,
};
