// trend_filter.js
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
const HTF_MS = {
  "4h": 4 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};

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

function buildHtfTrend(htfCandles, fastP, slowP) {
  const closes = htfCandles.map((c) => c.close);
  const fast = ema(closes, fastP);
  const slow = ema(closes, slowP);
  return htfCandles.map((c, i) => {
    let dir = "NEUTRAL";
    if (fast[i] != null && slow[i] != null) {
      dir = fast[i] > slow[i] ? "UP" : "DOWN";
    }
    return { closeTime: c.closeTime, dir };
  });
}

// для кожної 1H-свічки — тренд з ОСТАННЬОЇ закритої HTF-свічки (без lookahead)
function attachTrendToCandles(candles1h, htfTrend) {
  const out = new Array(candles1h.length).fill("NEUTRAL");
  let j = -1;
  for (let i = 0; i < candles1h.length; i++) {
    const t = candles1h[i].openTime;
    while (j + 1 < htfTrend.length && htfTrend[j + 1].closeTime <= t) j++;
    if (j >= 0) out[i] = htfTrend[j].dir;
  }
  return out;
}

function computeTrendSeries(candles1h, cfg) {
  const htfMs = HTF_MS[cfg.htf];
  const htf = aggregateOHLC(candles1h, htfMs);
  const htfTrend = buildHtfTrend(htf, cfg.fastPeriod, cfg.slowPeriod);
  return attachTrendToCandles(candles1h, htfTrend);
}

// гейт по НАЗВІ патерну (signal.name)
function passesTrendFilter(signalName, trendDir, cfg) {
  if (!cfg.enabled) return true;
  if (trendDir === "NEUTRAL") return cfg.allowNeutral;
  if (signalName === "EngulfingPullback") return trendDir === "UP"; // LONG лише в аптренді
  if (signalName === "EngulfingRally") return trendDir === "DOWN"; // SHORT лише в даунтренді
  return true;
}

module.exports = { computeTrendSeries, passesTrendFilter };
