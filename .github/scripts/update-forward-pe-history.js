#!/usr/bin/env node
'use strict';

/*
 * Builds the canonical daily ETF forward P/E history used by both the
 * dashboard and the S&P 500 daily report.
 *
 * Trefis explicitly labels this value "Forward P/E (ETF aggregate)" and
 * exposes the calculation, analyst-consensus period, and constituent-weight
 * coverage in data attributes. We reject pages that do not contain those
 * validation attributes rather than silently treating an ordinary P/E as
 * forward P/E.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '../..');
const OUTPUTS = [path.join(ROOT, 'forward-pe-history.json')];
const ETF_SYMBOLS = ['SPY', 'QQQ', 'SMH', 'IGV'];
const MAX_HISTORY_POINTS = 800;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36';
const TREFIS_SOURCE = 'Trefis ETF aggregate Forward P/E (analyst consensus)';
const TREFIS_URL = symbol => `https://www.trefis.com/data/companies/${encodeURIComponent(symbol)}`;

// Keep the calibrated percentile bands alongside the daily observations so
// the dashboard can render them without recalculating from only a few recent
// snapshots. Recalibrate these values when the long-term source history is
// refreshed.
const VALUATION_BANDS = {
  SPY: { lower: 15.00, p25: 17.50, p75: 20.50, upper: 23.00 },
  QQQ: { lower: 20.00, p25: 23.50, p75: 28.00, upper: 32.00 },
  SMH: { lower: 18.00, p25: 27.96, p75: 34.66, upper: 40.00 },
  IGV: { lower: 14.77, p25: 33.08, p75: 53.78, upper: 81.10 }
};

function requestURL(url, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
      maxHeaderSize: 128 * 1024
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return requestURL(new URL(res.headers.location, url).toString(), timeoutMs).then(resolve, reject);
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => body += chunk);
      res.on('end', () => res.statusCode === 200
        ? resolve(body)
        : reject(new Error(`HTTP ${res.statusCode}: ${url}`)));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms: ${url}`)));
    req.on('error', reject);
  });
}

function decodeHTML(value) {
  return String(value || '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&divide;/g, '÷').replace(/&middot;/g, '·').replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*['"]([^'"]*)['"]`, 'i'));
  return match ? decodeHTML(match[1]) : '';
}

function parseNumber(text) {
  const match = String(text || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function currentNYSEDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
}

function parseTrefisForwardPE(html, symbol) {
  const labelIndex = html.search(/>\s*P\/E \(Non-GAAP\) \[2\]\s*<\/td>/i);
  if (labelIndex < 0) throw new Error(`${symbol}: Trefis P/E row not found`);
  const rowStart = html.lastIndexOf('<tr', labelIndex);
  const rowEnd = html.indexOf('</tr>', labelIndex);
  const row = rowStart >= 0 && rowEnd >= 0 ? html.slice(rowStart, rowEnd + 5) : '';
  const forwardSpan = row.match(/<span[^>]*class=['"][^'"]*hfwd-cell[^'"]*['"][^>]*>[\s\S]*?<\/span>/i);
  if (!forwardSpan || !/Forward P\/E \(ETF aggregate\)/i.test(attr(forwardSpan[0], 'data-h'))) {
    throw new Error(`${symbol}: explicit Trefis Forward P/E marker not found`);
  }
  const value = parseNumber(forwardSpan[0].replace(/<[^>]+>/g, ' '));
  if (!Number.isFinite(value) || value <= 0 || value >= 1000) throw new Error(`${symbol}: invalid forward P/E value`);

  const align = attr(forwardSpan[0], 'data-align');
  const coverageMatch = align.match(/Across\s+(\d+)\/(\d+)\s+constituents\s+\((\d+(?:\.\d+)?)%\s+of weight[^)]*\)/i);
  const coverage = coverageMatch ? Number(coverageMatch[3]) / 100 : null;
  const coveredHoldings = coverageMatch ? Number(coverageMatch[1]) : null;
  const totalHoldings = coverageMatch ? Number(coverageMatch[2]) : null;
  if (!Number.isFinite(coverage) || coverage <= 0 || coverage > 1) throw new Error(`${symbol}: Trefis coverage metadata missing`);

  const forecastMatch = align.match(/(FY1\/FY2[^·]*?)(?:\s*·|$)/i);
  const result = attr(forwardSpan[0], 'data-result');
  const calc = attr(forwardSpan[0], 'data-calc');
  const updatedMatch = html.match(/Last updated:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  const asOf = updatedMatch
    ? `${updatedMatch[3]}-${String(updatedMatch[1]).padStart(2, '0')}-${String(updatedMatch[2]).padStart(2, '0')}`
    : null;
  return {
    value: Number(value.toFixed(2)),
    status: coverage >= 0.99 ? 'available' : 'partial',
    coverage: Number(coverage.toFixed(4)),
    coveredHoldings,
    totalHoldings,
    asOf,
    forecastPeriod: forecastMatch ? forecastMatch[1].trim() : null,
    calculation: calc || null,
    result: result || null,
    sourceUrl: TREFIS_URL(symbol),
    source: TREFIS_SOURCE
  };
}

function makeUnavailablePoint({ date, retrievedAt, error, symbol }) {
  return {
    value: null, status: 'unavailable', coverage: null, coveredHoldings: null, totalHoldings: null,
    asOf: null, date, retrievedAt, sourceUrl: TREFIS_URL(symbol), source: TREFIS_SOURCE, error
  };
}

function readHistory() {
  try {
    const data = JSON.parse(fs.readFileSync(OUTPUTS[0], 'utf8'));
    if (Array.isArray(data.snapshots)) return data;
  } catch {}
  return {
    schemaVersion: 3,
    metric: 'ETF aggregate forward P/E',
    methodology: 'Trefis ETF aggregate Forward P/E: weighted forward earnings yield inverted to P/E, using analyst-consensus FY1/FY2 estimates and current ETF weights; source metadata is retained for every point.',
    sources: { provider: 'Trefis', urls: Object.fromEntries(ETF_SYMBOLS.map(s => [s, TREFIS_URL(s)])) },
    snapshots: []
  };
}

function writeJSONAtomic(filename, data) {
  const temp = `${filename}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(temp, filename);
}

async function main() {
  const retrievedDate = currentNYSEDate();
  const retrievedAt = new Date().toISOString();
  const parsed = {};
  for (const symbol of ETF_SYMBOLS) {
    try {
      const point = parseTrefisForwardPE(await requestURL(TREFIS_URL(symbol)), symbol);
      parsed[symbol] = point;
    } catch (error) {
      parsed[symbol] = makeUnavailablePoint({ date: retrievedDate, retrievedAt, error: error.message, symbol });
    }
  }

  // Use the latest source-provided market date, not the machine's calendar
  // date. This prevents a run just after midnight ET from creating a future
  // observation before the next market session has been published.
  const date = Object.values(parsed).map(point => point.asOf).filter(Boolean).sort().at(-1) || retrievedDate;
  const etfs = Object.fromEntries(Object.entries(parsed).map(([symbol, point]) => [symbol, { ...point, date, retrievedAt }]));

  const history = readHistory();
  history.schemaVersion = 3;
  history.metric = 'ETF aggregate forward P/E';
  history.methodology = 'Trefis ETF aggregate Forward P/E: weighted forward earnings yield inverted to P/E, using analyst-consensus FY1/FY2 estimates and current ETF weights; source metadata is retained for every point.';
  history.sources = { provider: 'Trefis', urls: Object.fromEntries(ETF_SYMBOLS.map(s => [s, TREFIS_URL(s)])) };
  history.startedAt = history.startedAt || date;
  history.lastUpdatedAt = retrievedAt;
  history.valuationBands = VALUATION_BANDS;
  history.snapshots = history.snapshots.filter(point => point && point.date !== date);
  history.snapshots.push({ date, asOf: date, retrievedAt, etfs });
  history.snapshots.sort((a, b) => a.date.localeCompare(b.date));
  history.snapshots = history.snapshots.slice(-MAX_HISTORY_POINTS);
  for (const output of OUTPUTS) writeJSONAtomic(output, history);
  console.log(`Trefis forward P/E snapshot saved for ${date}: ${ETF_SYMBOLS.map(s => `${s}=${etfs[s].value ?? 'N/A'} (${Math.round((etfs[s].coverage || 0) * 100)}% weight)`).join(', ')}`);
  if (ETF_SYMBOLS.some(s => etfs[s].status === 'unavailable')) process.exitCode = 1;
}

if (require.main === module) main().catch(error => { console.error(`ERROR: Trefis forward P/E snapshot failed: ${error.message}`); process.exitCode = 1; });

module.exports = { parseTrefisForwardPE, currentNYSEDate, makeUnavailablePoint, decodeHTML };
