#!/usr/bin/env node
'use strict';

/*
 * Builds a daily, point-in-time forward P/E history for the dashboard.
 *
 * ETF holdings come from Alpha Vantage ETF_PROFILE. Yahoo Finance's quote
 * endpoint supplies each constituent's analyst-consensus `forwardPE`, with a
 * forwardPE-only quote-page fallback. `trailingPE` is never used.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const OUTPUTS = [
  path.join(ROOT, 'forward-pe-history.json')
];
const ETF_SYMBOLS = ['SPY', 'QQQ', 'SMH', 'IGV'];
const MAX_HOLDINGS = Number.parseInt(process.env.FORWARD_PE_MAX_HOLDINGS || '200', 10);
const CONCURRENCY = 8;
const ALPHA_REQUEST_SPACING_MS = 1250;
const MIN_COVERAGE = 0.40;
const FULL_COVERAGE = 0.80;
const MAX_HISTORY_POINTS = 800;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const HOLDINGS_SOURCE = 'Alpha Vantage ETF_PROFILE';
const FORWARD_PE_SOURCE = 'Yahoo Finance quote endpoint forwardPE via cookie/crumb (analyst consensus; quote-page fallback; trailingPE excluded)';

function requestURL(url, { timeoutMs = 18000, headers = {}, allowNon200 = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/json', ...headers },
      // Yahoo currently sends enough Set-Cookie headers to exceed Node's default.
      maxHeaderSize: 128 * 1024
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return requestURL(new URL(res.headers.location, url).toString(), { timeoutMs, headers, allowNon200 }).then(resolve, reject);
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200 && !allowNon200) return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        resolve({ body, headers: res.headers, statusCode: res.statusCode });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms: ${url}`)));
    req.on('error', reject);
  });
}

async function fetchURL(url, timeoutMs = 18000) {
  return (await requestURL(url, { timeoutMs })).body;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseYahooForwardPE(html) {
  // Yahoo serializes quote data into HTML with escaped JSON, e.g.
  // forwardPE\\\":{\\\"raw\\\":16.34. The exact forwardPE key is required.
  const match = html.match(/forwardPE\\?"\s*:\s*\{\\?"raw\\?"\s*:\s*(-?\d+(?:\.\d+)?)/i);
  const value = match ? Number.parseFloat(match[1]) : null;
  return Number.isFinite(value) && value > 0 && value < 1000 ? value : null;
}

function currentNYSEDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
}

function redactSensitiveError(error, apiKey = '') {
  let message = String(error || 'Unknown source error');
  if (apiKey) message = message.split(apiKey).join('[redacted]');
  return message
    .replace(/API key\s+(?:as|is)\s+[A-Za-z0-9_-]+/gi, 'API key [redacted]')
    .replace(/([?&]apikey=)[^&\s]+/gi, '$1[redacted]');
}

async function fetchETFHoldings(symbol, apiKey) {
  const raw = await fetchURL(`https://www.alphavantage.co/query?function=ETF_PROFILE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`);
  const data = JSON.parse(raw);
  if (data.Note || data.Information || data['Error Message']) {
    const detail = String(data.Note || data.Information || data['Error Message']);
    if (/rate limit|request per second|requests per day/i.test(detail)) throw new Error(`${symbol}: Alpha Vantage rate limit; N/A recorded.`);
    throw new Error(`${symbol}: Alpha Vantage ETF_PROFILE unavailable; N/A recorded.`);
  }
  if (!Array.isArray(data.holdings) || !data.holdings.length) throw new Error(`${symbol}: ETF_PROFILE returned no holdings`);
  return data.holdings
    .map(item => ({ symbol: String(item.symbol || '').toUpperCase(), weight: Number.parseFloat(item.weight) }))
    .filter(item => /^[A-Z][A-Z0-9.-]*$/.test(item.symbol) && Number.isFinite(item.weight) && item.weight > 0)
    .sort((a, b) => b.weight - a.weight);
}

async function mapWithConcurrency(items, worker) {
  const result = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      result[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, run));
  return result;
}

async function fetchConstituentForwardPE(symbol) {
  try {
    const html = await fetchURL(`https://finance.yahoo.com/quote/${encodeURIComponent(normalizeYahooSymbol(symbol))}/`, 15000);
    return parseYahooForwardPE(html);
  } catch {
    return null;
  }
}

function normalizeYahooSymbol(symbol) {
  return String(symbol).replace(/\./g, '-');
}

function parseYahooQuoteForwardPE(payload) {
  const values = new Map();
  for (const quote of payload?.quoteResponse?.result || []) {
    const value = Number(quote?.forwardPE);
    // Do not inspect trailingPE: only Yahoo's explicit forwardPE is accepted.
    if (Number.isFinite(value) && value > 0 && value < 1000) values.set(String(quote.symbol).toUpperCase(), value);
  }
  return values;
}

async function createYahooSession() {
  let cookie = '';
  try {
    const bootstrap = await requestURL('https://fc.yahoo.com/', { timeoutMs: 12000, allowNon200: true });
    cookie = (bootstrap.headers['set-cookie'] || []).map(item => item.split(';', 1)[0]).join('; ');
  } catch {}
  const crumb = (await requestURL('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    timeoutMs: 12000,
    headers: cookie ? { Cookie: cookie } : {}
  })).body.trim();
  if (!crumb) throw new Error('Yahoo crumb unavailable');
  return { cookie, crumb };
}

function chunk(items, size) {
  const output = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}

async function fetchForwardPEBySymbol(symbols) {
  const values = new Map();
  const originalByYahooSymbol = new Map(symbols.map(symbol => [normalizeYahooSymbol(symbol).toUpperCase(), symbol]));
  try {
    const session = await createYahooSession();
    for (const symbolsBatch of chunk(symbols, 50)) {
      const params = new URLSearchParams({
        symbols: symbolsBatch.map(normalizeYahooSymbol).join(','),
        crumb: session.crumb
      });
      const response = await requestURL(`https://query1.finance.yahoo.com/v7/finance/quote?${params}`, {
        timeoutMs: 15000,
        headers: session.cookie ? { Cookie: session.cookie } : {}
      });
      const parsed = parseYahooQuoteForwardPE(JSON.parse(response.body));
      for (const [yahooSymbol, value] of parsed) {
        const original = originalByYahooSymbol.get(yahooSymbol);
        if (original) values.set(original, value);
      }
    }
  } catch {}

  // The quote endpoint is preferred because it returns batches consistently.
  // Retain a forwardPE-only HTML fallback for the few symbols it omits.
  const missing = symbols.filter(symbol => !values.has(symbol));
  const fallback = await mapWithConcurrency(missing, async symbol => [symbol, await fetchConstituentForwardPE(symbol)]);
  for (const [symbol, value] of fallback) if (Number.isFinite(value)) values.set(symbol, value);
  return values;
}

function round(value, decimals = 4) {
  return Number(value.toFixed(decimals));
}

function makeUnavailablePoint({ asOf, retrievedAt, error, totalHoldings = 0, selectedHoldings = 0, selectedWeight = 0 }) {
  return {
    value: null,
    status: 'unavailable',
    coverage: 0,
    totalHoldings,
    selectedHoldings,
    coveredHoldings: 0,
    selectedWeight: round(selectedWeight, 6),
    asOf,
    retrievedAt,
    sources: { holdings: HOLDINGS_SOURCE, constituentForwardPE: FORWARD_PE_SOURCE },
    error
  };
}

function estimateETFForwardPE(allHoldings, forwardPEBySymbol, options = {}) {
  const maxHoldings = options.maxHoldings || MAX_HOLDINGS;
  const totalWeight = allHoldings.reduce((sum, holding) => sum + holding.weight, 0);
  const holdings = allHoldings.slice(0, maxHoldings);
  const selectedWeight = holdings.reduce((sum, holding) => sum + holding.weight, 0);
  let coveredWeight = 0;
  let inversePEWeighted = 0;
  let coveredHoldings = 0;
  for (const holding of holdings) {
    const pe = forwardPEBySymbol.get(holding.symbol);
    if (!Number.isFinite(pe)) continue;
    coveredWeight += holding.weight;
    inversePEWeighted += holding.weight / pe;
    coveredHoldings += 1;
  }

  // Coverage is always measured against the full ETF portfolio, never only
  // against the truncated selected basket.
  const coverage = totalWeight > 0 ? coveredWeight / totalWeight : 0;
  const value = coverage >= MIN_COVERAGE && inversePEWeighted > 0 ? coveredWeight / inversePEWeighted : null;
  const status = value == null ? 'unavailable' : coverage < FULL_COVERAGE ? 'partial' : 'available';
  return {
    value: value == null ? null : round(value, 2),
    status,
    coverage: round(coverage),
    totalHoldings: allHoldings.length,
    selectedHoldings: holdings.length,
    coveredHoldings,
    selectedWeight: round(totalWeight > 0 ? selectedWeight / totalWeight : 0, 6),
    coveredWeight: round(totalWeight > 0 ? coveredWeight / totalWeight : 0, 6)
  };
}

function pointWithMetadata(point, { asOf, retrievedAt }) {
  return {
    ...point,
    asOf,
    retrievedAt,
    sources: { holdings: HOLDINGS_SOURCE, constituentForwardPE: FORWARD_PE_SOURCE },
    ...(point.status === 'unavailable' ? {
      error: 'Forward P/E coverage below 40%; no trailing P/E fallback was used.'
    } : {})
  };
}

function pointQuality(point) {
  if (!point || !Number.isFinite(point.coverage)) return -1;
  return point.coverage + (Number.isFinite(point.value) ? 1 : 0);
}

function readHistory() {
  for (const output of OUTPUTS) {
    try {
      const data = JSON.parse(fs.readFileSync(output, 'utf8'));
      if (Array.isArray(data.snapshots)) return data;
    } catch {}
  }
  return {
    schemaVersion: 2,
    metric: 'ETF constituent-weighted forward P/E',
    methodology: 'Weighted harmonic mean of positive constituent analyst-consensus forward P/E values. trailingPE is never used. Coverage is measured against the full reported ETF holding weight; a value is N/A below 40% coverage.',
    sources: { holdings: HOLDINGS_SOURCE, constituentForwardPE: FORWARD_PE_SOURCE },
    snapshots: []
  };
}

function writeJSONAtomic(filename, data) {
  const temp = `${filename}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(temp, filename);
}

async function main() {
  if (!Number.isInteger(MAX_HOLDINGS) || MAX_HOLDINGS < 1) throw new Error('FORWARD_PE_MAX_HOLDINGS must be a positive integer');
  const asOf = currentNYSEDate();
  const retrievedAt = new Date().toISOString();
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  const holdingsByETF = new Map();
  const errorsByETF = new Map();

  for (const [index, symbol] of ETF_SYMBOLS.entries()) {
    if (!apiKey) {
      errorsByETF.set(symbol, 'ALPHA_VANTAGE_API_KEY is not configured; N/A recorded.');
      continue;
    }
    try {
      // Alpha Vantage free tier permits one request per second.  This is
      // deliberately inside the per-ETF loop so every run gets a fair chance
      // to create all four point-in-time observations.
      if (index > 0) await delay(1100);
      holdingsByETF.set(symbol, await fetchETFHoldings(symbol, apiKey));
    } catch (error) {
      errorsByETF.set(symbol, redactSensitiveError(error.message, apiKey));
    }
    // Alpha Vantage's free endpoint permits one request per second. Keep the
    // four ETF profiles in the same daily run rather than recording avoidable
    // N/A values for later symbols.
    if (symbol !== ETF_SYMBOLS.at(-1)) await delay(ALPHA_REQUEST_SPACING_MS);
  }

  const selectedSymbols = [...new Set([...holdingsByETF.values()]
    .flatMap(holdings => holdings.slice(0, MAX_HOLDINGS).map(item => item.symbol)))];
  const forwardPEBySymbol = await fetchForwardPEBySymbol(selectedSymbols);

  const etfs = {};
  for (const symbol of ETF_SYMBOLS) {
    const holdings = holdingsByETF.get(symbol);
    if (!holdings) {
      etfs[symbol] = makeUnavailablePoint({ asOf, retrievedAt, error: errorsByETF.get(symbol) || 'Holdings unavailable; N/A recorded.' });
      continue;
    }
    etfs[symbol] = pointWithMetadata(estimateETFForwardPE(holdings, forwardPEBySymbol), { asOf, retrievedAt });
  }

  const history = readHistory();
  history.schemaVersion = 2;
  history.metric = 'ETF constituent-weighted forward P/E';
  history.methodology = 'Weighted harmonic mean of positive constituent analyst-consensus forward P/E values. trailingPE is never used. Coverage is measured against the full reported ETF holding weight; a value is N/A below 40% coverage.';
  history.sources = { holdings: HOLDINGS_SOURCE, constituentForwardPE: FORWARD_PE_SOURCE };
  history.startedAt = history.startedAt || asOf;
  history.lastUpdatedAt = retrievedAt;
  history.maxHoldingsPerETF = MAX_HOLDINGS;
  const previous = history.snapshots.find(point => point && point.date === asOf);
  const chosenEtfs = {};
  for (const symbol of ETF_SYMBOLS) {
    const oldPoint = previous?.etfs?.[symbol];
    const newPoint = etfs[symbol];
    chosenEtfs[symbol] = pointQuality(oldPoint) > pointQuality(newPoint) ? oldPoint : newPoint;
  }
  history.snapshots = history.snapshots.filter(point => point && point.date !== asOf);
  history.snapshots.push({ date: asOf, asOf, retrievedAt, etfs: chosenEtfs });
  history.snapshots.sort((a, b) => a.date.localeCompare(b.date));
  history.snapshots = history.snapshots.slice(-MAX_HISTORY_POINTS);

  for (const output of OUTPUTS) writeJSONAtomic(output, history);
  const summary = ETF_SYMBOLS.map(symbol => {
    const point = etfs[symbol];
    return `${symbol}=${point.value ?? 'N/A'} (${Math.round(point.coverage * 100)}% coverage, ${point.status})`;
  }).join(', ');
  console.log(`forward P/E snapshot saved for ${asOf}: ${summary}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`ERROR: forward P/E snapshot failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseYahooForwardPE,
  parseYahooQuoteForwardPE,
  normalizeYahooSymbol,
  currentNYSEDate,
  estimateETFForwardPE,
  makeUnavailablePoint,
  redactSensitiveError
};
