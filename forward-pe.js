(function () {
    'use strict';
    const symbols = ['SPY', 'QQQ', 'SMH', 'IGV'];
    const colors = { SPY: '#4fc3f7', QQQ: '#ce93d8', SMH: '#ffb74d', IGV: '#81c784' };
    let chart;
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
        const datasets = symbols.map(symbol => ({ label: symbol, data: (history.snapshots || []).map(s => Number.isFinite(s.etfs?.[symbol]?.value) ? s.etfs[symbol].value : null), borderColor: colors[symbol], backgroundColor: colors[symbol], borderWidth: 2, pointRadius: 2, tension: .2, spanGaps: false }));
        if (chart) chart.destroy();
        chart = new Chart(document.getElementById('chart-forward-pe'), { type: 'line', data: { labels, datasets }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { color: '#aaa' } } }, scales: { x: { ticks: { color: '#888', maxTicksLimit: 8 }, grid: { color: '#1a2a3a' } }, y: { title: { display: true, text: 'Forward P/E (x)', color: '#888' }, ticks: { color: '#888' }, grid: { color: '#1a2a3a' } } } } });
    }
    async function load() {
        try { const response = await fetch('./forward-pe-history.json?t=' + Date.now(), { cache: 'no-store' }); if (!response.ok) throw new Error(`HTTP ${response.status}`); render(await response.json()); }
        catch (error) { const status = document.getElementById('forward-pe-status'); status.textContent = '⚠️ Forward P/E 暫時無法載入：' + error.message; status.className = 'forward-pe-status error'; }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load); else load();
})();
