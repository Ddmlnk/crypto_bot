// ============================================
// Тригери — правила входу в угоди
// Тут визначаємо коли бот шле сигнал
// ============================================

const config = require("./config");

/**
 * Розрахунок розміру позиції та ризику
 * @param {number} entry - ціна входу
 * @param {number} stop - ціна стопа
 * @returns {Object} - розрахунки позиції
 */
function calculatePosition(entry, stop) {
  const { margin, leverage } = config.risk;
  const positionSize = margin * leverage; // $90 при $30×3
  const stopDistance = Math.abs(entry - stop) / entry; // у відсотках (0.02 = 2%)
  const riskUsd = positionSize * stopDistance;
  const coinsAmount = positionSize / entry;

  return {
    positionSize,
    stopDistancePercent: stopDistance * 100,
    riskUsd,
    coinsAmount,
  };
}

/**
 * Розрахунок R:R
 */
function calculateRR(entry, stop, target) {
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  return reward / risk;
}

// ============================================
// СПИСОК ТРИГЕРІВ
// Кожен тригер — це функція, яка перевіряє умову
// і повертає сигнал, якщо умова виконана
// ============================================

/**
 * ТРИГЕР 1: Лонг на відскік від EMA 200 в бичачому тренді
 *
 * Умови:
 * - EMA 50 > EMA 200 (бичача структура)
 * - Ціна торкнулась EMA 200 знизу або трохи нижче
 * - RSI < 50 (перепроданість на тренді)
 *
 * Логіка: купуємо корекцію в висхідному тренді
 */
function bullishPullbackToEma200(symbol, data) {
  const { price, ema50, ema200, rsi, trend } = data;

  // Умова 1: загальний тренд бичачий
  if (ema50 < ema200) return null;

  // Умова 2: ціна біля EMA 200 (в межах 1.5%)
  const distanceToEma200 = Math.abs(price - ema200) / ema200;
  if (distanceToEma200 > 0.015) return null;

  // Умова 3: RSI у зоні перепроданості тренду
  if (rsi > 50) return null;

  // Формуємо план угоди
  const entry = price;
  const stop = ema200 * 0.98; // -2% від EMA 200
  const tp1 = entry * 1.025; // +2.5%
  const tp2 = entry * 1.05; // +5%

  const position = calculatePosition(entry, stop);

  // Перевіряємо чи ризик не перевищує дозволений
  if (position.riskUsd > config.risk.maxRiskUsd) {
    return null;
  }

  return {
    type: "LONG",
    name: "Відскік від EMA 200",
    entry,
    stop,
    tp1,
    tp2,
    rr1: calculateRR(entry, stop, tp1),
    rr2: calculateRR(entry, stop, tp2),
    position,
    reason:
      "Бичачий тренд (EMA50 > EMA200), ціна на EMA200, RSI у перепроданості",
  };
}

/**
 * ТРИГЕР 2: Шорт від EMA 200 в ведмежому тренді
 */
function bearishRallyToEma200(symbol, data) {
  const { price, ema50, ema200, rsi } = data;

  // Тренд ведмежий
  if (ema50 > ema200) return null;

  // Ціна підійшла до EMA 200 знизу
  const distanceToEma200 = Math.abs(price - ema200) / ema200;
  if (distanceToEma200 > 0.015) return null;

  // RSI вище 50 (відскік)
  if (rsi < 50) return null;

  const entry = price;
  const stop = ema200 * 1.02; // +2% від EMA 200
  const tp1 = entry * 0.975; // -2.5%
  const tp2 = entry * 0.95; // -5%

  const position = calculatePosition(entry, stop);
  if (position.riskUsd > config.risk.maxRiskUsd) return null;

  return {
    type: "SHORT",
    name: "Відскік до EMA 200",
    entry,
    stop,
    tp1,
    tp2,
    rr1: calculateRR(entry, stop, tp1),
    rr2: calculateRR(entry, stop, tp2),
    position,
    reason: "Ведмежий тренд (EMA50 < EMA200), ціна на EMA200, RSI у відскоку",
  };
}

/**
 * ТРИГЕР 3: Перепроданість RSI (контртрендовий лонг)
 *
 * Умови:
 * - RSI < 30 (сильна перепроданість)
 * - Ціна нижче VWAP
 *
 * Логіка: ловимо локальне дно
 */
function oversoldBounce(symbol, data) {
  const { price, rsi, vwap } = data;

  if (rsi > 30) return null;
  if (!vwap || price > vwap) return null;

  const entry = price;
  const stop = entry * 0.98; // -2%
  const tp1 = entry * 1.025;
  const tp2 = vwap; // ціль — повернення до VWAP

  const position = calculatePosition(entry, stop);
  if (position.riskUsd > config.risk.maxRiskUsd) return null;

  return {
    type: "LONG",
    name: "Відскік від перепроданості",
    entry,
    stop,
    tp1,
    tp2,
    rr1: calculateRR(entry, stop, tp1),
    rr2: calculateRR(entry, stop, tp2),
    position,
    reason: `RSI ${rsi.toFixed(1)} (перепроданість), ціна нижче VWAP`,
  };
}

/**
 * Список всіх активних тригерів
 */
const ALL_TRIGGERS = [
  bullishPullbackToEma200,
  bearishRallyToEma200,
  oversoldBounce,
];

/**
 * Перевірити всі тригери для монети
 * Повертає масив активних сигналів
 */
function checkTriggers(symbol, data) {
  const signals = [];

  for (const triggerFn of ALL_TRIGGERS) {
    const signal = triggerFn(symbol, data);
    if (signal) {
      signals.push(signal);
    }
  }

  return signals;
}

module.exports = {
  checkTriggers,
  calculatePosition,
  calculateRR,
};
