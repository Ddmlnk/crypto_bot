// ============================================
// PRICE ACTION ТРИГЕРИ
// Без індикаторів, тільки структура ринку
// ============================================

const config = require("./config");
const pa = require("./price_action");

function calculatePosition(entry, stop) {
  const { margin, leverage } = config.risk;
  const positionSize = margin * leverage;
  const stopDistance = Math.abs(entry - stop) / entry;
  const riskUsd = positionSize * stopDistance;
  const coinsAmount = positionSize / entry;

  return {
    positionSize,
    stopDistancePercent: stopDistance * 100,
    riskUsd,
    coinsAmount,
  };
}

function calculateRR(entry, stop, target) {
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  return reward / risk;
}

/**
 * ТРИГЕР 1: Bullish Pin Bar біля Swing Low
 *
 * Логіка:
 * - Знайти останній swing low (підтримка)
 * - Поточна свічка — bullish pin bar
 * - Pin bar торкнувся swing low (відмова від пробою)
 * - Загальна структура: bullish або ranging (не контртренд)
 */
function bullishPinBarAtSupport(candles, currentIndex) {
  if (currentIndex < 10) return null;

  const currentCandle = candles[currentIndex];

  // Перевіряємо що це pin bar
  if (!pa.isBullishPinBar(currentCandle)) return null;

  // Знаходимо swing low в недавньому минулому
  const swingLowIdx = pa.findRecentSwingLow(candles, currentIndex - 1, 5, 30);
  if (swingLowIdx === null) return null;

  const swingLowLevel = candles[swingLowIdx].low;

  // Pin bar має торкнутись рівня swing low (з допуском)
  if (!pa.touchedLevel(currentCandle, swingLowLevel, 0.5)) return null;

  // HTF фільтр: загальна структура НЕ ведмежа
  const structure = pa.getMarketStructure(candles.slice(0, currentIndex + 1));
  if (structure === "bearish") return null;

  // Формуємо план
  const entry = currentCandle.close;
  const stop = currentCandle.low * 0.998; // трохи нижче мінімуму pin bar
  const stopDistance = entry - stop;
  const tp1 = entry + stopDistance * 2; // 2R
  const tp2 = entry + stopDistance * 3; // 3R

  const position = calculatePosition(entry, stop);
  if (position.riskUsd > config.risk.maxRiskUsd) return null;

  return {
    type: "LONG",
    name: "PinBarAtSupport",
    entry,
    stop,
    tp1,
    tp2,
    rr1: calculateRR(entry, stop, tp1),
    rr2: calculateRR(entry, stop, tp2),
    position,
    reason: `Bullish pin bar біля swing low ${swingLowLevel.toFixed(2)}, структура: ${structure}`,
  };
}

/**
 * ТРИГЕР 2: Bearish Pin Bar біля Swing High
 */
function bearishPinBarAtResistance(candles, currentIndex) {
  if (currentIndex < 10) return null;

  const currentCandle = candles[currentIndex];

  if (!pa.isBearishPinBar(currentCandle)) return null;

  const swingHighIdx = pa.findRecentSwingHigh(candles, currentIndex - 1, 5, 30);
  if (swingHighIdx === null) return null;

  const swingHighLevel = candles[swingHighIdx].high;

  if (!pa.touchedLevel(currentCandle, swingHighLevel, 0.5)) return null;

  const structure = pa.getMarketStructure(candles.slice(0, currentIndex + 1));
  if (structure === "bullish") return null;

  const entry = currentCandle.close;
  const stop = currentCandle.high * 1.002;
  const stopDistance = stop - entry;
  const tp1 = entry - stopDistance * 2;
  const tp2 = entry - stopDistance * 3;

  const position = calculatePosition(entry, stop);
  if (position.riskUsd > config.risk.maxRiskUsd) return null;

  return {
    type: "SHORT",
    name: "PinBarAtResistance",
    entry,
    stop,
    tp1,
    tp2,
    rr1: calculateRR(entry, stop, tp1),
    rr2: calculateRR(entry, stop, tp2),
    position,
    reason: `Bearish pin bar біля swing high ${swingHighLevel.toFixed(2)}, структура: ${structure}`,
  };
}

/**
 * ТРИГЕР 3 (V2): Bullish Engulfing на корекції в підтвердженому аптренді
 *
 * Покращена версія з трьома фільтрами:
 * 1. Engulfing має бути СИЛЬНИМ (тіло >= 1.3× середнього)
 * 2. Корекція має бути ЗНАЧУЩОЮ (>= 3% від попереднього high)
 * 3. Структура підтверджена через swing-точки (HH + HL)
 */
function bullishEngulfingPullback(candles, currentIndex) {
  if (currentIndex < 30) return null;

  const current = candles[currentIndex];
  const prev = candles[currentIndex - 1];

  // ФІЛЬТР 1: Сильний engulfing
  const recentCandles = candles.slice(currentIndex - 20, currentIndex);
  const avgBody = pa.averageBodySize(recentCandles, 20);
  if (!pa.isStrongBullishEngulfing(prev, current, avgBody, 1.3)) return null;

  // Червоні свічки перед engulfing (корекція)
  let redCount = 0;
  for (let i = currentIndex - 1; i >= Math.max(0, currentIndex - 5); i--) {
    if (candles[i].close < candles[i].open) redCount++;
    else break;
  }
  if (redCount < 2) return null;

  // ФІЛЬТР 2: Глибина корекції >= 3%
  const pullbackDepth = pa.measurePullbackDepth(candles, currentIndex, 5);
  if (pullbackDepth < 0.03) return null;

  // ФІЛЬТР 3: Підтверджена бичача структура
  if (!pa.isConfirmedBullishStructure(candles, currentIndex, 5)) return null;

  // Формуємо план
  const entry = current.close;
  const stop = current.low * 0.998;
  const stopDistance = entry - stop;
  const tp1 = entry + stopDistance * 2;
  const tp2 = entry + stopDistance * 3;

  const position = calculatePosition(entry, stop);
  if (position.riskUsd > config.risk.maxRiskUsd) return null;

  return {
    type: "LONG",
    name: "EngulfingPullback",
    entry,
    stop,
    tp1,
    tp2,
    rr1: calculateRR(entry, stop, tp1),
    rr2: calculateRR(entry, stop, tp2),
    position,
    reason: `Сильний engulfing, корекція ${(pullbackDepth * 100).toFixed(1)}%, підтверджена HH/HL структура`,
  };
}

/**
 * ТРИГЕР 4 (V2): Bearish Engulfing на відскоку в підтвердженому даунтренді
 */
function bearishEngulfingRally(candles, currentIndex) {
  if (currentIndex < 30) return null;

  const current = candles[currentIndex];
  const prev = candles[currentIndex - 1];

  // ФІЛЬТР 1: Сильний engulfing
  const recentCandles = candles.slice(currentIndex - 20, currentIndex);
  const avgBody = pa.averageBodySize(recentCandles, 20);
  if (!pa.isStrongBearishEngulfing(prev, current, avgBody, 1.3)) return null;

  // Зелені свічки перед engulfing (відскок)
  let greenCount = 0;
  for (let i = currentIndex - 1; i >= Math.max(0, currentIndex - 5); i--) {
    if (candles[i].close > candles[i].open) greenCount++;
    else break;
  }
  if (greenCount < 2) return null;

  // ФІЛЬТР 2: Глибина відскоку >= 3%
  const rallyDepth = pa.measureRallyDepth(candles, currentIndex, 5);
  if (rallyDepth < 0.03) return null;

  // ФІЛЬТР 3: Підтверджена ведмежа структура
  if (!pa.isConfirmedBearishStructure(candles, currentIndex, 5)) return null;

  // План
  const entry = current.close;
  const stop = current.high * 1.002;
  const stopDistance = stop - entry;
  const tp1 = entry - stopDistance * 2;
  const tp2 = entry - stopDistance * 3;

  const position = calculatePosition(entry, stop);
  if (position.riskUsd > config.risk.maxRiskUsd) return null;

  return {
    type: "SHORT",
    name: "EngulfingRally",
    entry,
    stop,
    tp1,
    tp2,
    rr1: calculateRR(entry, stop, tp1),
    rr2: calculateRR(entry, stop, tp2),
    position,
    reason: `Сильний engulfing, відскок ${(rallyDepth * 100).toFixed(1)}%, підтверджена LH/LL структура`,
  };
}

const ALL_TRIGGERS = [
  // bearishPinBarAtResistance,  // вимкнено — WR 33%, P&L -$27 на 10 монетах
  bullishEngulfingPullback,
  bearishEngulfingRally,
];

/**
 * Перевірити всі тригери на конкретній свічці
 * @param {Array} candles - всі свічки до поточної
 * @param {number} currentIndex - індекс перевіряємої свічки
 */
function checkTriggers(candles, currentIndex) {
  const signals = [];
  for (const triggerFn of ALL_TRIGGERS) {
    const signal = triggerFn(candles, currentIndex);
    if (signal) signals.push(signal);
  }
  return signals;
}

module.exports = {
  checkTriggers,
  calculatePosition,
  calculateRR,
};
