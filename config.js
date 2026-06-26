// ============================================
// Конфігурація бота
// Тут зберігаються всі налаштування які можна
// легко змінювати без чіпання основного коду
// ============================================

module.exports = {
  // Розширений список — 10 монет
  symbols: [
    // Топ-капа
    "BTCUSDT",
    "ETHUSDT",
    "SOLUSDT",
    "BNBUSDT",
    // L1/L2 альти
    "AVAXUSDT",
    "LINKUSDT",
    "ADAUSDT",
    // Мемкоїни (для порівняння)
    "DOGEUSDT",
    "XRPUSDT",
    "TRXUSDT",
  ],
  // ...решта config як є
  timeframe: "1h",
  candlesLimit: 250,
  indicators: {
    emaFast: 50,
    emaSlow: 200,
    rsiPeriod: 14,
  },
  risk: {
    deposit: 100,
    margin: 30,
    leverage: 3,
    maxRiskUsd: 3,
  },
  checkIntervalMinutes: 15,
};
