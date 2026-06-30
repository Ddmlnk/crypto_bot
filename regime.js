// ============================================
// REGIME — визначення режиму ринку
// Напрямок (UP/DOWN) × Характер (TRENDING/RANGING) → macro (UP/DOWN/FLAT)
// ============================================

const HTF_MS = {
  "4h": 4 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let sma = 0;
  for (let i = 0; i < period; i++) sma += values[i];
  out[period - 1] = sma / period;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

function aggregateOHLC(candles1h, htfMs) {
  const buckets = new Map();
  for (const c of candles1h) {
    const start = Math.floor(c.openTime / htfMs) * htfMs;
    let b = buckets.get(start);
    if (!b) {
      b = {
        openTime: start,
        closeTime: start + htfMs,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      };
      buckets.set(start, b);
    } else {
      if (c.high > b.high) b.high = c.high;
      if (c.low < b.low) b.low = c.low;
      b.close = c.close;
    }
  }
  return [...buckets.values()].sort((a, b) => a.openTime - b.openTime);
}

// --- ADX за Wilder ---
function computeADX(htfCandles, period = 14) {
  const n = htfCandles.length;
  const adx = new Array(n).fill(null);
  if (n < period * 2) return adx;

  const tr = new Array(n).fill(0);
  const plusDM = new Array(n).fill(0);
  const minusDM = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const h = htfCandles[i].high,
      l = htfCandles[i].low;
    const ph = htfCandles[i - 1].high,
      pl = htfCandles[i - 1].low;
    const pc = htfCandles[i - 1].close;

    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));

    const up = h - ph;
    const down = pl - l;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
  }

  let atr = 0,
    sPlus = 0,
    sMinus = 0;
  for (let i = 1; i <= period; i++) {
    atr += tr[i];
    sPlus += plusDM[i];
    sMinus += minusDM[i];
  }

  const dx = new Array(n).fill(null);
  for (let i = period + 1; i < n; i++) {
    atr = atr - atr / period + tr[i];
    sPlus = sPlus - sPlus / period + plusDM[i];
    sMinus = sMinus - sMinus / period + minusDM[i];

    const plusDI = atr === 0 ? 0 : (sPlus / atr) * 100;
    const minusDI = atr === 0 ? 0 : (sMinus / atr) * 100;
    const sum = plusDI + minusDI;
    dx[i] = sum === 0 ? 0 : (Math.abs(plusDI - minusDI) / sum) * 100;
  }

  let firstIdx = period * 2;
  let adxVal = 0,
    count = 0;
  for (let i = period + 1; i <= firstIdx; i++) {
    if (dx[i] != null) {
      adxVal += dx[i];
      count++;
    }
  }
  if (count > 0) {
    adxVal /= count;
    adx[firstIdx] = adxVal;
    for (let i = firstIdx + 1; i < n; i++) {
      if (dx[i] != null) {
        adxVal = (adxVal * (period - 1) + dx[i]) / period;
        adx[i] = adxVal;
      }
    }
  }
  return adx;
}

// --- зведення двох вимірів у макрорежим UP / DOWN / FLAT ---
function toMacro(trend, character) {
  if (character === "RANGING") return "FLAT"; // боковик завжди FLAT
  if (trend === "UP") return "UP";
  if (trend === "DOWN") return "DOWN";
  return "FLAT"; // MIXED / NEUTRAL вважаємо боковиком
}

function computeRegimeSeries(candles1h, cfg) {
  const htfMs = HTF_MS[cfg.htf] || HTF_MS["4h"];
  const htf = aggregateOHLC(candles1h, htfMs);

  const closes = htf.map((c) => c.close);
  const fast = ema(closes, cfg.fastPeriod);
  const slow = ema(closes, cfg.slowPeriod);
  const adx = computeADX(htf, cfg.adxPeriod || 14);

  const htfRegime = htf.map((c, i) => {
    let trend = "NEUTRAL";
    if (fast[i] != null && slow[i] != null) {
      trend = fast[i] > slow[i] ? "UP" : "DOWN";
    }
    let character = "UNKNOWN";
    if (adx[i] != null) {
      if (adx[i] >= (cfg.adxTrend || 25)) character = "TRENDING";
      else if (adx[i] <= (cfg.adxRange || 20)) character = "RANGING";
      else character = "MIXED";
    }
    const macro = toMacro(trend, character);
    return { closeTime: c.closeTime, trend, character, adx: adx[i], macro };
  });

  const out = new Array(candles1h.length).fill(null);
  let j = -1;
  for (let i = 0; i < candles1h.length; i++) {
    const t = candles1h[i].openTime;
    while (j + 1 < htfRegime.length && htfRegime[j + 1].closeTime <= t) j++;
    out[i] =
      j >= 0
        ? htfRegime[j]
        : {
            trend: "NEUTRAL",
            character: "UNKNOWN",
            adx: null,
            macro: "UNKNOWN",
          };
  }
  return out;
}

module.exports = { computeRegimeSeries };
