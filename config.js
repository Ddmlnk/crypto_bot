module.exports = {
  symbols: [
    "BTCUSDT",
    "ETHUSDT",
    "SOLUSDT",
    "BNBUSDT",
    "AVAXUSDT",
    "LINKUSDT",
    "ADAUSDT",
    "XRPUSDT",
  ],
  timeframe: "1h", // назад на 1H
  candlesLimit: 250,
  indicators: { emaFast: 50, emaSlow: 200, rsiPeriod: 14 },

  risk: {
    deposit: 1000,
    margin: 30,
    leverage: 3,
    maxRiskUsd: 3,
  },
  checkIntervalMinutes: 60, // 1H — перевіряємо раз на годину

  // Режим на 4H (старший за торговий 1H)
  regime: {
    htf: "4h",
    fastPeriod: 50,
    slowPeriod: 200,
    adxPeriod: 14,
    adxTrend: 25,
    adxRange: 20,
  },

  // Три відібрані тригери
  triggerRouting: {
    EmaRetestShort: { macro: ["DOWN"] }, // найкращий
    EngulfingRally: { macro: ["DOWN"] },
    BreakoutLong: { macro: ["UP", "FLAT"] },

    // решта вимкнені
    EmaRetestLong: { macro: [] },
    EngulfingPullback: { macro: [] },
    BreakoutShort: { macro: [] },
    RangeLong: { macro: [] },
    RangeShort: { macro: [] },
    RsiReversionLong: { macro: [] },
    RsiReversionShort: { macro: [] },
    RangeBreakoutLong: { macro: [] },
    RangeBreakoutShort: { macro: [] },
    LiquiditySweepLong: { macro: [] },
  },

  rangeParams: {
    rsiPeriod: 14,
    rsiLow: 30,
    rsiHigh: 70,
    breakoutWindow: 24,
    breakoutBuffer: 0.001,
  },
  smcParams: { lookback: 20, sweepDepth: 0.0005, maxStopPct: 0.04 },
};
