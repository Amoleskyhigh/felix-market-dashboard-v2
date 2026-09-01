(function () {
    'use strict';
    const symbols = ['SPY', 'QQQ', 'SMH', 'IGV'];
    const colors = { SPY: '#4fc3f7', QQQ: '#ce93d8', SMH: '#ffb74d', IGV: '#81c784' };
    let charts = [];
    // 5 年 rolling proxy band（μ±1.5σ）；集中在此處，方便日後重新校準。
    const defaultBands = {
        SPY: { lower: 15.00, p25: 17.50, p75: 20.50, upper: 23.00 },
        QQQ: { lower: 20.00, p25: 23.50, p75: 28.00, upper: 32.00 },
        SMH: { lower: 18.00, p25: 27.96, p75: 34.66, upper: 40.00 },
        IGV: { lower: 14.77, p25: 33.08, p75: 53.78, upper: 81.10 }
    };
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    function render(history) {
        const snapshot = history?.snapshots?.[history.snapshots.length - 1];
        const values = snapshot?.etfs || {};
        if (!snapshot) throw new Error('沒有有效的 forward P/E 快照');
        const available = symbols.filter(s => Number.isFinite(values[s]?.value)).length;
        const status = document.getElementById('forward-pe-status');
        status.textContent = `✅ 已載入 ${snapshot.date} Trefis 快照（${available}/4 個 ETF 有可驗證值）`;
        status.className = 'forward-pe-status ' + (available === 4 ? 'success' : 'warning');
        document.getElementById('forward-pe-latest').innerHTML = symbols.map(symbol => {
            const item = values[symbol] || {};
            const value = Number.isFinite(item.value) ? `${item.value.toFixed(2)}x` : 'N/A';
            const coverage = Number.isFinite(item.coverage) ? `涵蓋 ${(item.coverage * 100).toFixed(1)}% 權重` : '無驗證涵蓋率';
            const asOf = item.asOf || snapshot.asOf || snapshot.date || '—';
            return `<div class="forward-pe-metric"><b style="color:${colors[symbol]}">${symbol}</b><strong>${value}</strong><small>${esc(item.status || 'unavailable')} · ${coverage} · 資料日 ${esc(asOf)}</small></div>`;
        }).join('');
        const source = history.sources?.provider || 'Trefis';
        const forecast = values[symbols.find(s => values[s]?.forecastPeriod)]?.forecastPeriod;
        document.getElementById('forward-pe-meta').textContent = `快照日：${snapshot.date}｜來源：${source}｜預測期間：${forecast || '各 ETF 以來源頁面標示為準'}｜每筆資料均保留 sourceUrl、涵蓋權重與計算說明`;
        const labels = (history.snapshots || []).map(s => s.date);
        const grid = document.getElementById('forward-pe-chart-grid');
        grid.innerHTML = symbols.map(symbol => `<div class="forward-pe-mini-chart"><canvas id="chart-forward-pe-${symbol.toLowerCase()}" aria-label="${symbol} forward P/E 趨勢圖"></canvas></div>`).join('');
        charts.forEach(existing => existing.destroy());
        const bands = history.valuationBands || defaultBands;
        charts = symbols.map(symbol => {
            const band = bands[symbol] || defaultBands[symbol];
            const { lower, p25, p75, upper } = band;
            const valuesForSymbol = (history.snapshots || []).map(s => Number.isFinite(s.etfs?.[symbol]?.value) ? s.etfs[symbol].value : null);
            return new Chart(document.getElementById(`chart-forward-pe-${symbol.toLowerCase()}`), {
                type: 'line',
                data: { labels, datasets: [
                    { label: '外圍範圍下限', data: labels.map(() => lower), borderColor: 'transparent', backgroundColor: 'transparent', pointRadius: 0, borderWidth: 0 },
                    { label: `外圍範圍 ${lower.toFixed(2)}–${upper.toFixed(2)}x`, data: labels.map(() => upper), borderColor: 'transparent', backgroundColor: `${colors[symbol]}14`, pointRadius: 0, borderWidth: 0, fill: { target: '-1' } },
                    { label: `P25 ${p25.toFixed(2)}x`, data: labels.map(() => p25), borderColor: `${colors[symbol]}aa`, backgroundColor: 'transparent', borderDash: [5, 4], pointRadius: 0, borderWidth: 1, fill: false },
                    { label: `P75 ${p75.toFixed(2)}x`, data: labels.map(() => p75), borderColor: `${colors[symbol]}aa`, backgroundColor: `${colors[symbol]}24`, borderDash: [5, 4], pointRadius: 0, borderWidth: 1, fill: { target: '-1' } },
                    { label: symbol, data: valuesForSymbol, borderColor: colors[symbol], backgroundColor: colors[symbol], borderWidth: 2, pointRadius: 2, tension: .2, spanGaps: false }
                ] },
                options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { position: 'top', labels: { color: '#aaa', boxWidth: 12, filter: item => item.datasetIndex >= 2 } },
                        title: { display: true, text: `${symbol} · P25–P75 ${p25.toFixed(2)}–${p75.toFixed(2)}x`, color: colors[symbol], align: 'start', font: { size: 13 } } },
                    scales: { x: { ticks: { color: '#888', maxTicksLimit: 6 }, grid: { color: '#1a2a3a' } }, y: { title: { display: true, text: 'Forward P/E (x)', color: '#888' }, ticks: { color: '#888' }, grid: { color: '#1a2a3a' }, suggestedMin: Math.max(0, lower - (upper - lower) * .08), suggestedMax: upper + (upper - lower) * .08 } } }
            });
        });
    }
    async function load() {
        try { const response = await fetch('./forward-pe-history.json?t=' + Date.now(), { cache: 'no-store' }); if (!response.ok) throw new Error(`HTTP ${response.status}`); render(await response.json()); }
        catch (error) { const status = document.getElementById('forward-pe-status'); status.textContent = '⚠️ Forward P/E 暫時無法載入：' + error.message; status.className = 'forward-pe-status error'; }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load); else load();
})();
