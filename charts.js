    function renderCharts() {
        const d = gData;
        chartsDrawn.forEach(c => c.destroy());
        chartsDrawn = [];

        // SPY vs MA200
        if (d.spy || d.spx) {
            const src = d.spy || d.spx;
            const ma200 = calcMA_full(src.closes, 200);
            chartsDrawn.push(drawMulti('chart-spy', src.timestamps, [
                { label:'SPY', data: src.closes, color:'#4fc3f7', width:1.5 },
                { label:'MA200', data: ma200, color:'#f44336', dash:[4,4], width:1 }
            ]));
        }

        // Shiller PE
        if (d.shiller && d.shiller.history && d.shiller.history.length > 0) {
            const peData = { timestamps: d.shiller.history.map(h=>new Date(h.date).getTime()), closes: d.shiller.history.map(h=>h.value) };
            chartsDrawn.push(drawMulti('chart-pe', peData.timestamps, [
                { label:'Shiller PE', data: peData.closes, color:'#ff9800', width:1.5 },
                { label:'+1σ', data: peData.closes.map(()=>PE_WARN1), color:'#ff5722', dash:[5,5], width:1 },
                { label:'Mean', data: peData.closes.map(()=>AI_MEAN), color:'#4fc3f7', dash:[3,3], width:1 },
            ]));
        }

        // Copper
        if (d.copper) {
            const ma3 = calcMA_full(d.copper.closes, 3);
            chartsDrawn.push(drawMulti('chart-copper', d.copper.timestamps, [
                { label:'Copper', data: d.copper.closes, color:'#cd7f32', width:1.5 },
                { label:'MA3', data: ma3, color:'#ffeb3b', dash:[4,4], width:1 }
            ]));
        }

        // VIX
        if (d.vix && d.vix.closes && d.vix.closes.length > 1) {
            chartsDrawn.push(drawMulti('chart-vix', d.vix.timestamps, [
                { label:'VIX', data: d.vix.closes, color:'#f44336', width:1.5 },
                { label:'35', data: d.vix.closes.map(()=>35), color:'#ff5722', dash:[5,5], width:1 },
                { label:'28', data: d.vix.closes.map(()=>28), color:'#ff9800', dash:[3,3], width:1 },
                { label:'20', data: d.vix.closes.map(()=>20), color:'#888', dash:[3,3], width:1 },
            ]));
        }

        // HY OAS
        if (d.hyOAS && d.hyOAS.history && d.hyOAS.history.length > 1) {
            const hyTs = d.hyOAS.history.map(h => new Date(h.date).getTime());
            const hyVals = d.hyOAS.history.map(h => h.value);
            chartsDrawn.push(drawMulti('chart-hyoas', hyTs, [
                { label:'HY OAS', data: hyVals, color:'#ef5350', width:1.5 },
                { label:'500bp', data: hyVals.map(()=>500), color:'#ff9800', dash:[5,5], width:1 },
                { label:'300bp', data: hyVals.map(()=>300), color:'#4caf50', dash:[3,3], width:1 },
            ]));
        }

        if (d.qqq && d.qqq.closes && d.qqq.closes.length > 1)
            chartsDrawn.push(drawSingle('chart-qqq', d.qqq.timestamps, d.qqq.closes, '#4fc3f7', 'QQQ'));
        if (d.smh && d.smh.closes && d.smh.closes.length > 1)
            chartsDrawn.push(drawSingle('chart-smh', d.smh.timestamps, d.smh.closes, '#ce93d8', 'SMH'));

        // DXY with MA20
        if (d.dxy) {
            const ma20 = calcMA_full(d.dxy.closes, 20);
            chartsDrawn.push(drawMulti('chart-dxy', d.dxy.timestamps, [
                { label:'DXY', data: d.dxy.closes, color:'#81c784', width:1.5 },
                { label:'MA20', data: ma20, color:'#ffeb3b', dash:[4,4], width:1 }
            ]));
        }

        // TNX with MA20
        if (d.tnx) {
            const ma20 = calcMA_full(d.tnx.closes, 20);
            chartsDrawn.push(drawMulti('chart-tnx', d.tnx.timestamps, [
                { label:'10Y Yield', data: d.tnx.closes, color:'#ffd54f', width:1.5 },
                { label:'MA20', data: ma20, color:'#4fc3f7', dash:[4,4], width:1 },
                { label:'4.5%', data: d.tnx.closes.map(()=>4.5), color:'#f44336', dash:[5,5], width:1 },
                { label:'3.5%', data: d.tnx.closes.map(()=>3.5), color:'#4caf50', dash:[5,5], width:1 },
            ]));
        }
    }

    function drawSingle(id, timestamps, closes, color, label) {
        return new Chart(document.getElementById(id), {
            type:'line',
            data:{ labels: timestamps.map(t=>new Date(t)), datasets:[{ label, data: closes, borderColor: color, borderWidth:1.5, pointRadius:0, fill:false }] },
            options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} }, scales:{ x:{ type:'time', ticks:{maxTicksLimit:5}, grid:{color:'#1a2a3a'} }, y:{ grid:{color:'#1a2a3a'} } } }
        });
    }

    function drawMulti(id, timestamps, datasets) {
        const ds = datasets.filter(d=>d.data).map(d => ({
            label: d.label,
            data: d.data,
            borderColor: d.color,
            borderWidth: d.width || 1.5,
            borderDash: d.dash || [],
            pointRadius: 0,
            fill: false,
            spanGaps: true
        }));
        return new Chart(document.getElementById(id), {
            type:'line',
            data:{ labels: timestamps.map(t=>new Date(t)), datasets: ds },
            options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} }, scales:{ x:{ type:'time', ticks:{maxTicksLimit:5}, grid:{color:'#1a2a3a'} }, y:{ grid:{color:'#1a2a3a'} } } }
        });
    }

    function updateAlloc() {
        if (!gData) return;
        const sc = computeScore();
        renderAlloc(sc);
    }

    // ─── Init ───────────────────────────────────────────────────────────
    async function init() {
        const bar = document.getElementById('status-bar');
        try {
            let dataSource = 'live API';
            let res;
            try {
                res = await fetch('/api/data?t=' + Date.now());
                if (!res.ok) throw new Error('live api failed');
                gData = await res.json();
            } catch (_) {
                dataSource = 'snapshot';
                res = await fetch('./market-data-snapshot.json?t=' + Date.now());
                if (!res.ok) throw new Error('無法載入 market-data-snapshot.json');
                gData = await res.json();
            }

            bar.className = 'success';
            const ts = gData.timestamp || gData.updatedAt || null;
            const tsText = ts ? new Date(ts).toLocaleString('zh-TW') : new Date().toLocaleString('zh-TW');
            bar.innerText = dataSource === 'live API'
                ? `✅ 數據同步完成（即時） ${tsText}`
                : `✅ 數據已載入（快照） ${tsText}`;

            const sc = computeScore();
            const panic = checkPanic();

            renderKPIs(sc);
            renderDualAxis(sc);
            renderAlloc(sc);
            renderPanic(panic);
            renderCharts();

        } catch (e) {
            bar.className = 'error';
            bar.innerText = '❌ 系統錯誤: ' + e.message;
            console.error(e);
        }
    }

    init();
