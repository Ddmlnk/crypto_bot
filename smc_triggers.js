// ============================================
// SMC TRIGGERS — liquidity sweep reversal (long-only)
// Формалізована версія: sweep мінімуму + повернення вгору
// ============================================

const config = require("./config");

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

// найнижчий low серед window свічок ПЕРЕД індексом end (не включаючи end)
function recentSwingLow(candles, end, window) {
  let lo = Infinity;
  let loIdx = -1;
  const start = Math.max(0, end - window);
  for (let i = start; i < end; i++) {
    if (candles[i].low < lo) {
      lo = candles[i].low;
      loIdx = i;
    }
  }
  return { lo, loIdx };
}

// ============================================
// ТРИГЕР: Liquidity Sweep Long
// 1) свічка i-1 проколює недавній swing low (low < рівня)
// 2) але закривається НАЗАД вище рівня (фальшивий пробій)
// 3) свічка i — бичача, підтверджує повернення вгору
// ============================================
function liquiditySweepLong(candles, i) {
  const p = config.smcParams;
  if (i < p.lookback + 5) return null;

  const sweepBar = candles[i - 1]; // свічка, що знімала ліквідність
  const confirmBar = candles[i]; // підтвердження

  // swing low шукаємо ДО sweep-свічки
  const { lo, loIdx } = recentSwingLow(candles, i - 1, p.lookback);
  if (loIdx < 0 || lo === Infinity) return null;

  // 1) sweep-свічка проколола рівень (з невеликим запасом, щоб був реальний прокол)
  const pierced = sweepBar.low < lo * (1 - p.sweepDepth);
  if (!pierced) return null;

  // 2) але закрилась назад вище рівня (фальшивий пробій, не справжній пробій вниз)
  const closedBack = sweepBar.close > lo;
  if (!closedBack) return null;

  // 3) підтвердна свічка бичача й закривається вище закриття sweep-свічки
  const confirmed =
    confirmBar.close > confirmBar.open && confirmBar.close > sweepBar.close;
  if (!confirmed) return null;

  // вхід по close підтвердної, стоп під проколеним мінімумом
  const entry = confirmBar.close;
  const stop = sweepBar.low * 0.998;
  if (stop >= entry) return null;

  // відсікаємо надто широкі стопи (інакше R надто дорогий)
  const stopPct = (entry - stop) / entry;
  if (stopPct > p.maxStopPct) return null;

  return buildSignal("LONG", "LiquiditySweepLong", entry, stop);
}

const SMC_TRIGGERS = [liquiditySweepLong];

function checkSmcTriggers(candles, i) {
  const signals = [];
  for (const fn of SMC_TRIGGERS) {
    const s = fn(candles, i);
    if (s) signals.push(s);
  }
  return signals;
}

module.exports = { checkSmcTriggers };
