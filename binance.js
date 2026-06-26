// ============================================
// Робота з Binance Public API
// Без ключів - публічні дані доступні всім
// ============================================

// Базовий URL Binance Spot API
const BINANCE_API = "https://api.binance.com/api/v3";

/**
 * Отримати свічки (klines) з Binance
 * @param {string} symbol - наприклад 'BTCUSDT'
 * @param {string} interval - таймфрейм '15m', '1h', '4h', '1d'
 * @param {number} limit - кількість свічок (макс 1000)
 * @returns {Promise<Array>} - масив свічок
 */
async function getCandles(symbol, interval, limit = 250) {
  const url = `${BINANCE_API}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Binance API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();

    // Binance повертає масив масивів. Перетворюємо в зручні обʼєкти:
    // [
    //   openTime, open, high, low, close, volume,
    //   closeTime, quoteVolume, trades, ...
    // ]
    const candles = data.map((c) => ({
      openTime: c[0],
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[5]),
      closeTime: c[6],
    }));

    return candles;
  } catch (error) {
    console.error(`❌ Помилка отримання свічок для ${symbol}:`, error.message);
    return null;
  }
}

/**
 * Отримати поточну ціну для пари
 * @param {string} symbol - наприклад 'BTCUSDT'
 * @returns {Promise<number|null>}
 */
async function getCurrentPrice(symbol) {
  const url = `${BINANCE_API}/ticker/price?symbol=${symbol}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    return parseFloat(data.price);
  } catch (error) {
    console.error(`❌ Помилка отримання ціни для ${symbol}:`, error.message);
    return null;
  }
}

module.exports = {
  getCandles,
  getCurrentPrice,
};
