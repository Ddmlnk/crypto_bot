// ============================================
// Розрахунок технічних індикаторів
// Використовуємо бібліотеку technicalindicators
// ============================================

const { EMA, RSI } = require("technicalindicators");

/**
 * Розрахувати EMA (Exponential Moving Average)
 * @param {number[]} closes - масив цін закриття
 * @param {number} period - період (50, 200)
 * @returns {number[]} - значення EMA
 */
function calculateEMA(closes, period) {
  return EMA.calculate({ values: closes, period });
}

/**
 * Розрахувати RSI
 * @param {number[]} closes - масив цін закриття
 * @param {number} period - період (зазвичай 14)
 * @returns {number[]} - значення RSI
 */
function calculateRSI(closes, period = 14) {
  return RSI.calculate({ values: closes, period });
}

/**
 * Розрахувати VWAP (Volume Weighted Average Price)
 * Скидається на початку кожної доби (UTC)
 * @param {Array} candles - масив свічок
 * @returns {number} - поточне значення VWAP
 */
function calculateVWAP(candles) {
  // Знайти початок поточного дня (UTC)
  const now = new Date();
  const todayUTC = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );

  // Беремо тільки свічки сьогоднішнього дня
  const todayCandles = candles.filter((c) => c.openTime >= todayUTC);

  if (todayCandles.length === 0) {
    return null;
  }

  let cumulativeTPV = 0; // сума (typical_price × volume)
  let cumulativeVolume = 0;

  for (const candle of todayCandles) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    cumulativeTPV += typicalPrice * candle.volume;
    cumulativeVolume += candle.volume;
  }

  if (cumulativeVolume === 0) return null;

  return cumulativeTPV / cumulativeVolume;
}

/**
 * Повний аналіз свічок: рахуємо всі індикатори
 * @param {Array} candles - масив свічок
 * @returns {Object} - обʼєкт з усіма індикаторами
 */
function analyze(candles) {
  if (!candles || candles.length < 200) {
    return null;
  }

  const closes = candles.map((c) => c.close);

  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);
  const rsi = calculateRSI(closes, 14);
  const vwap = calculateVWAP(candles);

  // Беремо останнє значення кожного індикатора
  const lastCandle = candles[candles.length - 1];
  const lastPrice = lastCandle.close;
  const lastEma50 = ema50[ema50.length - 1];
  const lastEma200 = ema200[ema200.length - 1];
  const lastRsi = rsi[rsi.length - 1];

  // Визначаємо стан тренду
  let trend = "flat";
  if (lastPrice > lastEma50 && lastEma50 > lastEma200) {
    trend = "bullish";
  } else if (lastPrice < lastEma50 && lastEma50 < lastEma200) {
    trend = "bearish";
  }

  // Визначаємо стан RSI
  let rsiState = "neutral";
  if (lastRsi >= 70) rsiState = "overbought";
  else if (lastRsi <= 30) rsiState = "oversold";

  return {
    price: lastPrice,
    ema50: lastEma50,
    ema200: lastEma200,
    rsi: lastRsi,
    vwap: vwap,
    trend,
    rsiState,
    // Зміни у відсотках відносно EMA та VWAP
    priceVsEma50: ((lastPrice - lastEma50) / lastEma50) * 100,
    priceVsEma200: ((lastPrice - lastEma200) / lastEma200) * 100,
    priceVsVwap: vwap ? ((lastPrice - vwap) / vwap) * 100 : null,
  };
}

module.exports = {
  calculateEMA,
  calculateRSI,
  calculateVWAP,
  analyze,
};
