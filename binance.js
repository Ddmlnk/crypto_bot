// ============================================
// Робота з Binance Public API
// Без ключів - публічні дані доступні всім
// ============================================

const BINANCE_API = "https://api.binance.com/api/v3";

/**
 * Отримати свічки (klines) з Binance
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

/**
 * Отримати ВЕЛИКУ кількість свічок (більше 1000)
 * Binance віддає максимум 1000 за запит, тому робимо пагінацію
 */
async function getCandlesHistory(symbol, interval, totalCandles) {
  const BATCH_SIZE = 1000;
  const batches = Math.ceil(totalCandles / BATCH_SIZE);

  let allCandles = [];
  let endTime = Date.now();

  console.log(
    `  📥 Завантажую ${totalCandles} свічок ${interval} для ${symbol}...`,
  );

  for (let i = 0; i < batches; i++) {
    const limit = Math.min(BATCH_SIZE, totalCandles - allCandles.length);
    const url = `${BINANCE_API}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}&endTime=${endTime}`;

    try {
      const response = await fetch(url);
      const data = await response.json();

      if (!data.length) break;

      const batch = data.map((c) => ({
        openTime: c[0],
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
        volume: parseFloat(c[5]),
        closeTime: c[6],
      }));

      allCandles = [...batch, ...allCandles];
      endTime = batch[0].openTime - 1;

      await new Promise((r) => setTimeout(r, 200));

      process.stdout.write(
        `\r  📥 ${allCandles.length}/${totalCandles} свічок завантажено`,
      );
    } catch (error) {
      console.error(`\n  ❌ Помилка завантаження:`, error.message);
      break;
    }
  }

  console.log("");
  return allCandles.slice(-totalCandles);
}

// ============================================
// ЕКСПОРТ — тільки ОДИН раз в кінці файлу!
// ============================================
module.exports = {
  getCandles,
  getCurrentPrice,
  getCandlesHistory,
};
