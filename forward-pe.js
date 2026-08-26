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
        status.textContent = `✅ 已載入 ${snapshot.date} 快照（${available}/4 個 ETF 有安全覆蓋值）`;
        status.className = 'forward-pe-status ' + (available === 4 ? 'success' : 'warning');
        document.getElementById('forward-pe-latest').innerHTML = symbols.map(symbol => {
            const item = values[symbol] || {};
            const value = Number.isFinite(item.value) ? `${item.value.toFixed(2)}x` : 'N/A';
            const coverage = Number.isFinite(item.coverage) ? `覆蓋 ${(item.coverage * 100).toFixed(1)}%` : '無覆蓋';
            return `<div class="forward-pe-metric"><b style="color:${colors[symbol]}">${symbol}</b><strong>${value}</strong><small>${esc(item.status || 'unavailable')} · ${coverage}</small></div>`;
        }).join('');
        document.getElementById('forward-pe-meta').textContent = `資料日：${snapshot.asOf || snapshot.date}｜來源：${history.sources?.constituentForwardPE || 'Yahoo Finance forwardPE'}｜計算：${history.methodology || '成分股權重調和平均'}`;
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
