    // ─── Render ─────────────────────────────────────────────────
    function renderKPIs(sc) {
        const d = gData;

        // Shiller PE
        if (d.shiller) {
            const z = (d.shiller.current - AI_MEAN) / AI_SD;
            const el = document.getElementById('v-pe');
            el.innerText = d.shiller.current.toFixed(2);
            const st = document.getElementById('s-pe');
            st.innerText = `Z: ${z.toFixed(2)}σ`;
            st.className = 'kpi-status ' + (z > 1.5 ? 'down' : z > 0.8 ? 'neutral' : 'up');
        }

        // SPY vs MA200
        if (sc) {
            const el = document.getElementById('v-spy-ma');
            el.innerText = `${sc.spyPct >= 0 ? '+' : ''}${sc.spyPct.toFixed(1)}%`;
            el.style.color = sc.spyPct >= 0 ? '#4caf50' : '#f44336';
            const st = document.getElementById('s-spy-ma');
            st.innerText = `MA200: $${sc.spyMA200.toFixed(0)} | K=${sc.k}`;
            st.className = 'kpi-status ' + (sc.spyPct >= 0 ? 'up' : 'down');
        }

        if (d.spx) document.getElementById('v-spx').innerText = d.spx.currentPrice.toFixed(0);
        if (d.ixic) document.getElementById('v-ixic').innerText = d.ixic.currentPrice.toFixed(0);
        if (d.sox) document.getElementById('v-sox').innerText = d.sox.currentPrice.toFixed(0);

        if (d.qqq) {
            document.getElementById('v-qqq').innerText = '$' + d.qqq.currentPrice.toFixed(1);
            const mtd = pct(d.qqq.currentPrice, d.qqq.previousClose || d.qqq.currentPrice);
            document.getElementById('s-qqq').innerHTML = colorPct(mtd);
            document.getElementById('mtd-qqq').innerHTML = colorPct(mtd);
        }
        if (d.smh) {
            document.getElementById('v-smh').innerText = '$' + d.smh.currentPrice.toFixed(1);
            const mtd = pct(d.smh.currentPrice, d.smh.previousClose || d.smh.currentPrice);
            document.getElementById('s-smh').innerHTML = colorPct(mtd);
            document.getElementById('mtd-smh').innerHTML = colorPct(mtd);
        }
        if (d.boxx) document.getElementById('v-boxx').innerText = '$' + d.boxx.currentPrice.toFixed(2);
        if (d.qld) {
            document.getElementById('v-qld').innerText = '$' + d.qld.currentPrice.toFixed(2);
            const mtd = pct(d.qld.currentPrice, d.qld.previousClose || d.qld.currentPrice);
            document.getElementById('s-qld').innerHTML = colorPct(mtd);
            document.getElementById('mtd-qld').innerHTML = colorPct(mtd);
        }

        if (d.vix) {
            const v = d.vix.currentPrice;
            document.getElementById('v-vix').innerText = v.toFixed(1);
            const s = v > 35 ? '🟢 極度恐慌 (+3)' : v > 28 ? '🟡 緊張 (+2)' : v > 20 ? '🟡 中性 (+1)' : '🔴 過熱 (0)';
            document.getElementById('s-vix').innerText = s;
            document.getElementById('s-vix').className = 'kpi-status ' + (v > 28 ? 'up' : v > 20 ? 'neutral' : 'down');
        }

        if (d.fearGreed) {
            const fg = d.fearGreed.score;
            document.getElementById('v-fg').innerText = fg;
            const s = fg < 25 ? '🟢 極度恐慌 (+2)' : fg < 40 ? '🟡 恐懼 (+1)' : fg < 70 ? '🔴 中性 (0)' : '🔴 貪婪 (0)';
            document.getElementById('s-fg').innerText = s;
            document.getElementById('s-fg').className = 'kpi-status ' + (fg < 25 ? 'up' : fg < 40 ? 'neutral' : 'down');
        }

        if (sc) {
            document.getElementById('v-copper').innerText = '$' + sc.copper.toFixed(3);
            document.getElementById('s-copper').innerText = sc.copperRaw ? `🟢 高於MA3 $${sc.copperMA3.toFixed(3)} (+1)` : `🔴 低於MA3 $${sc.copperMA3.toFixed(3)} (0)`;
            document.getElementById('s-copper').className = 'kpi-status ' + (sc.copperRaw ? 'up' : 'down');

            document.getElementById('v-tnx').innerText = sc.tnx.toFixed(2) + '%';
            document.getElementById('s-tnx').innerText = sc.tnxRaw ? `🟢 低於MA20 ${sc.tnxMA20.toFixed(2)}% (+1)` : `🔴 高於MA20 ${sc.tnxMA20.toFixed(2)}% (0)`;
            document.getElementById('s-tnx').className = 'kpi-status ' + (sc.tnxRaw ? 'up' : 'down');

            document.getElementById('v-dxy').innerText = sc.dxy.toFixed(1);
            document.getElementById('s-dxy').innerText = sc.dxyRaw ? `🟢 低於MA20 ${sc.dxyMA20.toFixed(1)} (+1)` : `🔴 高於MA20 ${sc.dxyMA20.toFixed(1)} (0)`;
            document.getElementById('s-dxy').className = 'kpi-status ' + (sc.dxyRaw ? 'up' : 'down');
        }

        if (d.twd) document.getElementById('v-twd').innerText = d.twd.currentPrice.toFixed(2);
        if (d.spy) {
            const mtd = pct(d.spy.currentPrice, d.spy.previousClose || d.spy.currentPrice);
            document.getElementById('mtd-spy').innerHTML = colorPct(mtd);
        }
        if (d.boxx) {
            const mtd = pct(d.boxx.currentPrice, d.boxx.previousClose || d.boxx.currentPrice);
            document.getElementById('mtd-boxx').innerHTML = colorPct(mtd);
        }
    }

    function renderScoreTable(sc) {
        const rows = [
            { name: 'VIX', val: sc.vix.toFixed(1), cond: '>35/28/20 門檻', raw: sc.vixRaw, w: 3 },
            { name: 'Fear & Greed', val: sc.fg, cond: '<25/<40 門檻', raw: sc.fgRaw, w: 2 },
            { name: 'Copper vs MA3', val: `$${sc.copper.toFixed(3)}`, cond: `MA3=$${sc.copperMA3.toFixed(3)}`, raw: sc.copperRaw, w: 2 },
            { name: '10Y Yield vs MA20', val: `${sc.tnx.toFixed(3)}%`, cond: `MA20=${sc.tnxMA20.toFixed(3)}%`, raw: sc.tnxRaw, w: 2 },
            { name: 'Shiller PE', val: sc.pe.toFixed(2), cond: '<36/<39.33 門檻', raw: sc.peRaw, w: 2 },
            { name: 'DXY vs MA20', val: sc.dxy.toFixed(1), cond: `MA20=${sc.dxyMA20.toFixed(1)}`, raw: sc.dxyRaw, w: 1 },
        ];
        let totalWeighted = 0;
        let html = '';
        rows.forEach(r => {
            const weighted = r.raw * r.w;
            totalWeighted += weighted;
            const cls = weighted === r.w * (r.name==='Shiller PE'?2:r.w>1?r.w:1) ? 'tag-green' :
                        weighted > 0 ? 'tag-yellow' : 'tag-red';
            const tagCls = r.raw === 0 ? 'tag-red' : r.raw < (r.name==='VIX'?3:r.name==='Fear & Greed'||r.name==='Shiller PE'?2:1) ? 'tag-yellow' : 'tag-green';
            html += `<tr>
                <td>${r.name}</td>
                <td style="color:#ccc">${r.val}</td>
                <td style="color:#888;font-size:10px">${r.cond}</td>
                <td><span class="score-tag ${tagCls}">${r.raw}分</span></td>
                <td><b style="color:#4fc3f7">×${r.w} = ${weighted}</b></td>
            </tr>`;
        });
        document.getElementById('score-tbody').innerHTML = html;
        document.getElementById('raw-score-total').innerText = `${sc.rawScore} / 13`;

        // K coefficient
        document.getElementById('k-value').innerText = sc.k.toFixed(1);
        document.getElementById('k-value').style.color = sc.k >= 1 ? '#4caf50' : sc.k >= 0.7 ? '#ff9800' : '#f44336';
        document.getElementById('k-desc').innerText = `SPY $${sc.spy.toFixed(1)} vs MA200 $${sc.spyMA200.toFixed(1)} (${sc.spyPct >= 0 ? '+' : ''}${sc.spyPct.toFixed(1)}%)`;
        document.getElementById('k-mode').innerText = sc.k >= 1 ? '☀️ 晴天模式（全速前進）' : sc.k >= 0.8 ? '⛅ 輕雲模式（小幅保守）' : sc.k >= 0.6 ? '🌧 雨天模式（明顯保守）' : '⛈ 暴雨模式（最大防守）';

        document.getElementById('final-score').innerText = sc.finalScore.toFixed(2);
        document.getElementById('avg5-score').innerText = sc.finalScore.toFixed(2);
    }

    function renderAlloc(sc) {
        const fund = parseFloat(document.getElementById('fund-input').value) || 0;
        const alloc = getAllocation(sc.finalScore, sc.pe);
        const modes = ['防守', '中性偏保守', '中性偏進攻', '進攻'];
        const modeIdx = sc.finalScore <= 3 ? 0 : sc.finalScore <= 6 ? 1 : sc.finalScore <= 9 ? 2 : 3;
        document.getElementById('alloc-mode').innerText = `當前模式：${modes[modeIdx]}（均分 ${sc.finalScore.toFixed(1)}）`;

        const colors = { cashPct:'#4caf50', qqqPct:'#4fc3f7', smhPct:'#ce93d8', boxxPct:'#ff9800', qldPct:'#f44336' };
        const labels = { cashPct:'現金', qqqPct:'QQQ', smhPct:'SMH', boxxPct:'BOXX', qldPct:'QLD' };
        let barHtml = '', dollarHtml = '';

        Object.entries(alloc).forEach(([k, v]) => {
            if (k === 'peNote' || v === 0) return;
            barHtml += `<div class="alloc-item" style="width:${v}%;background:${colors[k]}">${labels[k]} ${v}%</div>`;
            dollarHtml += `<div class="alloc-dollars-row"><span>${labels[k]}</span><span><b>$${(fund*v/100).toLocaleString()}</b> (${v}%)</span></div>`;
        });

        document.getElementById('alloc-bar-container').innerHTML = `<div class="alloc-bar">${barHtml}</div>`;
        document.getElementById('alloc-dollars-container').innerHTML = `<div class="alloc-dollars">${dollarHtml}</div>`;
        document.getElementById('pe-adjustment-note').innerText = alloc.peNote;
    }

    function renderPanic(p) {
        const card = document.getElementById('panic-card');
        const status = document.getElementById('panic-status');
        if (p.triggered) {
            card.className = 'card red-border';
            status.style.background = 'rgba(244,67,54,0.2)';
            status.style.color = '#f44336';
            status.innerText = '⚠️ 恐慌加倉條件觸發！建議執行加倉計畫';
            document.getElementById('panic-action').innerText = '建議：將核心倉現金的 50% 分 3–5 天轉入 QQQ。若 VIX > 40，可啟用 QLD（上限總資產 5%）。';
        } else {
            card.className = 'card green-border';
            status.style.background = 'rgba(76,175,80,0.1)';
            status.style.color = '#4caf50';
            status.innerText = '✅ 未觸發 — 無需執行恐慌加倉';
            document.getElementById('panic-action').innerText = '持續觀察，三條件須同時滿足才觸發。';
        }

        const conditions = [
            { label: 'SPY 週跌幅', val: `${p.weeklyRet.toFixed(1)}%`, threshold: '≤ -7%', met: p.c1 },
            { label: 'VIX', val: p.vix.toFixed(1), threshold: '> 35', met: p.c2 },
            { label: 'Fear & Greed', val: p.fg, threshold: '< 20', met: p.c3 },
        ];
        document.getElementById('panic-conditions').innerHTML = conditions.map(c => `
            <div class="panic-item ${c.met ? 'panic-met' : 'panic-unmet'}">
                <div class="panic-label">${c.label}</div>
                <div class="panic-value ${c.met ? 'down' : 'up'}">${c.val}</div>
                <div class="panic-threshold" style="color:#888">門檻：${c.threshold}</div>
                <div style="font-size:14px;margin-top:3px">${c.met ? '⚠️ 觸發' : '✅ 正常'}</div>
            </div>`).join('');
    }