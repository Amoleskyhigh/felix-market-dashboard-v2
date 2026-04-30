    // Normalize timestamps to ms (Alpha Vantage gives seconds, others ms)
    function normalizeTs(ts) {
        if (!ts || !ts.length) return ts;
        return ts[0] < 1e12 ? ts.map(t => t * 1000) : ts;
    }

    // Sort timestamp+close pairs ascending and deduplicate.
    // Fixes the "today prepended to ascending backfill" ordering bug.
    function sortChronologically(timestamps, closes) {
        if (!timestamps || timestamps.length < 2) return [normalizeTs(timestamps), closes];
        const ts = normalizeTs(timestamps);
        const pairs = ts.map((t, i) => [t, closes[i]])
                        .filter(p => p[0] && p[1] != null)
                        .sort((a, b) => a[0] - b[0]);
        const deduped = pairs.filter((p, i) => i === 0 || p[0] !== pairs[i-1][0]);
        return [deduped.map(p => p[0]), deduped.map(p => p[1])];
    }

    // Where consecutive timestamps are more than maxGapDays apart, insert a
    // null placeholder so Chart.js renders a visible break instead of a
    // misleading straight line across the gap.
    // Accepts timestamps + any number of parallel data arrays.
    // Returns [newTimestamps, ...newDataArrays].
    function insertNullsForGaps(timestamps, ...dataArrays) {
        const maxGapMs = 50 * 24 * 3600 * 1000; // 50 days
        if (timestamps.length < 2) return [timestamps, ...dataArrays];
        const newTs = [timestamps[0]];
        const newArrs = dataArrays.map(arr => [arr[0]]);
        for (let i = 1; i < timestamps.length; i++) {
            if (timestamps[i] - timestamps[i - 1] > maxGapMs) {
                // Place the null midway through the gap
                newTs.push(Math.floor((timestamps[i - 1] + timestamps[i]) / 2));
                newArrs.forEach(arr => arr.push(null));
            }
            newTs.push(timestamps[i]);
            newArrs.forEach((arr, j) => arr.push(dataArrays[j][i]));
        }
        return [newTs, ...newArrs];
    }

    // Parse "YYYY-MM-DD" as LOCAL midnight instead of UTC midnight.
    // new Date("2026-04-27") = UTC midnight = PST 5PM the day before → wrong axis.
    function parseLocalDate(s) {
        const [y, m, d] = s.split('-').map(Number);
        return new Date(y, m - 1, d).getTime();
    }

    function renderCharts() {
        const d = gData;
        chartsDrawn.forEach(c => c.destroy());
        chartsDrawn = [];

        // SPY vs MA200
        if (d.spy || d.spx) {
            const src = d.spy || d.spx;
            const [spyTsSorted, spyClosesSorted] = sortChronologically(src.timestamps, src.closes);
            const ma200raw = calcMA_full(spyClosesSorted, 200);
            const [spyTs, spyCloses, ma200] = insertNullsForGaps(spyTsSorted, spyClosesSorted, ma200raw);
            chartsDrawn.push(drawMulti('chart-spy', spyTs, [
                { label:'SPY',   data: spyCloses, color:'#4fc3f7', width:1.5 },
                { label:'MA200', data: ma200,     color:'#f44336', dash:[4,4], width:1 }
            ]));
        }

        // Shiller PE
        if (d.shiller && d.shiller.history && d.shiller.history.length > 0) {
            const pePairs = d.shiller.history
                .map(h => [parseLocalDate(h.date), h.value])
                .sort((a, b) => a[0] - b[0]);
            const [peTs, peVals] = insertNullsForGaps(pePairs.map(p => p[0]), pePairs.map(p => p[1]));
            chartsDrawn.push(drawMulti('chart-pe', peTs, [
                { label:'Shiller PE', data: peVals,                             color:'#ff9800', width:1.5 },
                { label:'+1σ',        data: new Array(peTs.length).fill(PE_WARN1), color:'#ff5722', dash:[5,5], width:1, spanGaps:true },
                { label:'Mean',       data: new Array(peTs.length).fill(AI_MEAN),  color:'#4fc3f7', dash:[3,3], width:1, spanGaps:true },
            ]));
        }

        // Copper
        if (d.copper) {
            const [copperTsSorted, copperClosesSorted] = sortChronologically(d.copper.timestamps, d.copper.closes);
            const ma3raw = calcMA_full(copperClosesSorted, 3);
            const [copperTs, copperCloses, ma3] = insertNullsForGaps(copperTsSorted, copperClosesSorted, ma3raw);
            chartsDrawn.push(drawMulti('chart-copper', copperTs, [
                { label:'Copper', data: copperCloses, color:'#cd7f32', width:1.5 },
                { label:'MA3',    data: ma3,          color:'#ffeb3b', dash:[4,4], width:1 }
            ]));
        }

        // VIX
        if (d.vix && d.vix.closes && d.vix.closes.length > 1) {
            const [vixTsSorted, vixClosesSorted] = sortChronologically(d.vix.timestamps, d.vix.closes);
            const [vixTs, vixCloses] = insertNullsForGaps(vixTsSorted, vixClosesSorted);
            chartsDrawn.push(drawMulti('chart-vix', vixTs, [
                { label:'VIX', data: vixCloses,                          color:'#f44336', width:1.5 },
                { label:'35',  data: new Array(vixTs.length).fill(35),   color:'#ff5722', dash:[5,5], width:1, spanGaps:true },
                { label:'28',  data: new Array(vixTs.length).fill(28),   color:'#ff9800', dash:[3,3], width:1, spanGaps:true },
                { label:'20',  data: new Array(vixTs.length).fill(20),   color:'#888',    dash:[3,3], width:1, spanGaps:true },
            ]));
        }

        // HY OAS — normalize value from % to bp if needed (FRED gives %, chart expects bp)
        if (d.hyOAS && d.hyOAS.history && d.hyOAS.history.length > 1) {
            const hyPairs = d.hyOAS.history
                .map(h => [parseLocalDate(h.date), h.value < 10 ? h.value * 100 : h.value])
                .sort((a, b) => a[0] - b[0]);
            const [hyTs, hyVals] = insertNullsForGaps(hyPairs.map(p => p[0]), hyPairs.map(p => p[1]));
            chartsDrawn.push(drawMulti('chart-hyoas', hyTs, [
                { label:'HY OAS', data: hyVals,                           color:'#ef5350', width:1.5 },
                { label:'500bp',  data: new Array(hyTs.length).fill(500), color:'#ff9800', dash:[5,5], width:1, spanGaps:true },
                { label:'300bp',  data: new Array(hyTs.length).fill(300), color:'#4caf50', dash:[3,3], width:1, spanGaps:true },
            ]));
        }

        // Market Breadth (% stocks above 200MA)
        if (d.breadth && d.breadth.history && d.breadth.history.length > 0) {
            const brPairs = d.breadth.history
                .map(h => [parseLocalDate(h.date), h.value])
                .sort((a, b) => a[0] - b[0]);
            const [brTs, brVals] = insertNullsForGaps(brPairs.map(p => p[0]), brPairs.map(p => p[1]));
            chartsDrawn.push(drawMulti('chart-breadth', brTs, [
                { label:'廣度%', data: brVals,                            color:'#26c6da', width:2 },
                { label:'65%',   data: new Array(brTs.length).fill(65),  color:'#4caf50', dash:[5,5], width:1, spanGaps:true },
                { label:'50%',   data: new Array(brTs.length).fill(50),  color:'#ff9800', dash:[3,3], width:1, spanGaps:true },
            ], { timeUnit: 'day' }));
        }

        if (d.qqq && d.qqq.closes && d.qqq.closes.length > 1) {
            const [qqqTsSorted, qqqClosesSorted] = sortChronologically(d.qqq.timestamps, d.qqq.closes);
            const [qqqTs, qqqCloses] = insertNullsForGaps(qqqTsSorted, qqqClosesSorted);
            chartsDrawn.push(drawSingle('chart-qqq', qqqTs, qqqCloses, '#4fc3f7', 'QQQ'));
        }
        if (d.smh && d.smh.closes && d.smh.closes.length > 1) {
            const [smhTsSorted, smhClosesSorted] = sortChronologically(d.smh.timestamps, d.smh.closes);
            const [smhTs, smhCloses] = insertNullsForGaps(smhTsSorted, smhClosesSorted);
            chartsDrawn.push(drawSingle('chart-smh', smhTs, smhCloses, '#ce93d8', 'SMH'));
        }

        // DXY with MA20
        if (d.dxy) {
            const [dxyTsSorted, dxyClosesSorted] = sortChronologically(d.dxy.timestamps, d.dxy.closes);
            const ma20raw = calcMA_full(dxyClosesSorted, 20);
            const [dxyTs, dxyCloses, ma20] = insertNullsForGaps(dxyTsSorted, dxyClosesSorted, ma20raw);
            chartsDrawn.push(drawMulti('chart-dxy', dxyTs, [
                { label:'DXY',  data: dxyCloses, color:'#81c784', width:1.5 },
                { label:'MA20', data: ma20,      color:'#ffeb3b', dash:[4,4], width:1 }
            ]));
        }

        // TNX with MA20
        if (d.tnx) {
            const [tnxTsSorted, tnxClosesSorted] = sortChronologically(d.tnx.timestamps, d.tnx.closes);
            const ma20raw = calcMA_full(tnxClosesSorted, 20);
            const [tnxTs, tnxCloses, ma20] = insertNullsForGaps(tnxTsSorted, tnxClosesSorted, ma20raw);
            chartsDrawn.push(drawMulti('chart-tnx', tnxTs, [
                { label:'10Y Yield', data: tnxCloses,                          color:'#ffd54f', width:1.5 },
                { label:'MA20',      data: ma20,                               color:'#4fc3f7', dash:[4,4], width:1 },
                { label:'4.5%',      data: new Array(tnxTs.length).fill(4.5), color:'#f44336', dash:[5,5], width:1, spanGaps:true },
                { label:'3.5%',      data: new Array(tnxTs.length).fill(3.5), color:'#4caf50', dash:[5,5], width:1, spanGaps:true },
            ]));
        }
    }

    function drawSingle(id, timestamps, closes, color, label) {
        return new Chart(document.getElementById(id), {
            type:'line',
            data:{ labels: timestamps.map(t=>new Date(t)), datasets:[{
                label, data: closes, borderColor: color,
                borderWidth:1.5, pointRadius:0, fill:false, spanGaps:false
            }] },
            options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} },
                scales:{ x:{ type:'time', ticks:{maxTicksLimit:5}, grid:{color:'#1a2a3a'} }, y:{ grid:{color:'#1a2a3a'} } } }
        });
    }

    function drawMulti(id, timestamps, datasets, opts) {
        const ds = datasets.filter(d=>d.data).map(d => ({
            label: d.label,
            data: d.data,
            borderColor: d.color,
            borderWidth: d.width || 1.5,
            borderDash: d.dash || [],
            pointRadius: 0,
            fill: false,
            spanGaps: d.spanGaps !== undefined ? d.spanGaps : false
        }));
        const xScaleOpts = { type:'time', ticks:{maxTicksLimit:5}, grid:{color:'#1a2a3a'} };
        if (opts && opts.timeUnit) xScaleOpts.time = { unit: opts.timeUnit };
        return new Chart(document.getElementById(id), {
            type:'line',
            data:{ labels: timestamps.map(t=>new Date(t)), datasets: ds },
            options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} },
                scales:{ x: xScaleOpts, y:{ grid:{color:'#1a2a3a'} } } }
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
            let tsText;
            try {
                tsText = ts ? new Date(ts).toLocaleString('zh-TW') : new Date().toLocaleString('zh-TW');
            } catch (_) {
                tsText = ts ? new Date(ts).toLocaleString() : new Date().toLocaleString();
            }
            bar.innerText = dataSource === 'live API'
                ? `✅ 數據同步完成（即時） ${tsText}`
                : `✅ 數據已載入（快照） ${tsText}`;

            const sc = computeScore();
            const panic = checkPanic();

            renderKPIs(sc);
            renderDualAxis(sc);
            renderAlloc(sc);
            renderPanic(panic);

            // Charts are non-critical — isolated try-catch so chart bugs never block KPI display
            try {
                renderCharts();
            } catch (chartErr) {
                console.warn('Chart rendering error (non-fatal):', chartErr);
                bar.innerText += ' ⚠️ 部分圖表載入失敗';
            }

        } catch (e) {
            bar.className = 'error';
            bar.innerText = '❌ 系統錯誤: ' + e.message;
            console.error(e);
        }
    }

    init();
