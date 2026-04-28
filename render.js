    // ─── Render ─────────────────────────────────────────────────
    function renderKPIs(sc) {
        const d = gData;

        // Shiller PE
        if (d.shiller) {
            const z = (d.shiller.current - AI_MEAN) / AI_SD;
            document.getElementById('v-pe').innerText = d.shiller.current.toFixed(2);
            const st = document.getElementById('s-pe');
            st.innerText = `Z: ${z.toFixed(2)}σ`;
            st.className = 'kpi-status ' + (z > 1.5 ? 'down' : z > 0.8 ? 'neutral' : 'up');
        }

        // SPY vs MA200
        if (sc) {
            document.getElementById('v-spy-ma').innerText = `${sc.spyPct >= 0 ? '+' : ''}${sc.spyPct.toFixed(1)}%`;
            document.getElementById('v-spy-ma').style.color = sc.spyPct >= 0 ? '#4caf50' : '#f44336';
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
        if (d.boxx) {
            document.getElementById('v-boxx').innerText = '$' + d.boxx.currentPrice.toFixed(2);
            const mtd = pct(d.boxx.currentPrice, d.boxx.previousClose || d.boxx.currentPrice);
            document.getElementById('mtd-boxx').innerHTML = colorPct(mtd);
        }
        if (d.qld) {
            document.getElementById('v-qld').innerText = '$' + d.qld.currentPrice.toFixed(2);
            const mtd = pct(d.qld.currentPrice, d.qld.previousClose || d.qld.currentPrice);
            document.getElementById('s-qld').innerHTML = colorPct(mtd);
            document.getElementById('mtd-qld').innerHTML = colorPct(mtd);
        }

        if (d.vix) {
            const v = d.vix.currentPrice;
            document.getElementById('v-vix').innerText = v.toFixed(1);
            const s = v > 35 ? '🟢 極度恐慌 (+3)' : v > 28 ? '🟢 緊張 (+2)' : v > 20 ? '🟡 中性 (+1)' : v > 15 ? '⚪ 平靜 (0)' : '🔴 過度樂觀 (-1)';
            document.getElementById('s-vix').innerText = s;
            document.getElementById('s-vix').className = 'kpi-status ' + (v > 28 ? 'up' : v > 15 ? 'neutral' : 'down');
        }

        if (d.fearGreed) {
            const fg = d.fearGreed.score;
            document.getElementById('v-fg').innerText = fg;
            const s = fg < 20 ? '🟢 極度恐慌 (+3)' : fg < 40 ? '🟢 恐懼 (+2)' : fg < 60 ? '🟡 中性 (+1)' : fg < 75 ? '⚪ 貪婪 (0)' : '🔴 極度貪婪 (-1)';
            document.getElementById('s-fg').innerText = s;
            document.getElementById('s-fg').className = 'kpi-status ' + (fg < 40 ? 'up' : fg < 75 ? 'neutral' : 'down');
        }

        // HY OAS (High Yield Spread)
        const hyEl = document.getElementById('v-hyoas');
        const hySt = document.getElementById('s-hyoas');
        if (d.hyOAS && d.hyOAS.current) {
            const hy = d.hyOAS.current;
            hyEl.innerText = hy.toFixed(0) + 'bp';
            const s = hy > 600 ? '🟢 極度恐慌 (+3)' : hy > 500 ? '🟢 緊張 (+2)' : hy > 400 ? '🟡 偏寬 (+1)' : hy > 300 ? '⚪ 正常 (0)' : '🔴 過度樂觀 (-1)';
            hySt.innerText = s;
            hySt.className = 'kpi-status ' + (hy > 500 ? 'up' : hy > 300 ? 'neutral' : 'down');
        } else {
            hyEl.innerText = 'N/A';
            hySt.innerText = '待更新';
            hySt.className = 'kpi-status neutral';
        }

        // Market Breadth
        const brEl = document.getElementById('v-breadth');
        const brSt = document.getElementById('s-breadth');
        if (d.breadth && d.breadth.pct !== undefined) {
            const b = d.breadth.pct;
            brEl.innerText = b.toFixed(0) + '%';
            const s = b > 70 ? '🟢 強勢廣度 (+2)' : b > 50 ? '🟡 中性廣度 (+1)' : '🔴 弱勢廣度 (0)';
            brSt.innerText = s;
            brSt.className = 'kpi-status ' + (b > 70 ? 'up' : b > 50 ? 'neutral' : 'down');
        } else {
            brEl.innerText = '估算';
            brSt.innerText = '採估算值(+1)';
            brSt.className = 'kpi-status neutral';
        }

        if (sc) {
            document.getElementById('v-copper').innerText = '$' + sc.copper.toFixed(3);
            document.getElementById('s-copper').innerText = sc.t1 ? `🟢 高於MA3 $${sc.copperMA3.toFixed(3)} (+2)` : `🔴 低於MA3 $${sc.copperMA3.toFixed(3)} (0)`;
            document.getElementById('s-copper').className = 'kpi-status ' + (sc.t1 ? 'up' : 'down');

            document.getElementById('v-tnx').innerText = sc.tnx.toFixed(2) + '%';
            document.getElementById('s-tnx').innerText = sc.t2 ? `🟢 低於MA20 ${sc.tnxMA20.toFixed(2)}% (+2)` : `🔴 高於MA20 ${sc.tnxMA20.toFixed(2)}% (0)`;
            document.getElementById('s-tnx').className = 'kpi-status ' + (sc.t2 ? 'up' : 'down');

            document.getElementById('v-dxy').innerText = sc.dxy.toFixed(1);
            document.getElementById('s-dxy').innerText = sc.t3 ? `🟢 低於MA20 ${sc.dxyMA20.toFixed(1)} (+2)` : `🔴 高於MA20 ${sc.dxyMA20.toFixed(1)} (0)`;
            document.getElementById('s-dxy').className = 'kpi-status ' + (sc.t3 ? 'up' : 'down');
        }

        if (d.twd) document.getElementById('v-twd').innerText = d.twd.currentPrice.toFixed(2);
        if (d.spy) {
            const mtd = pct(d.spy.currentPrice, d.spy.previousClose || d.spy.currentPrice);
            document.getElementById('mtd-spy').innerHTML = colorPct(mtd);
        }
    }

    // ─── Dual-Axis Score Panel ────────────────────────────────────────────
    function renderDualAxis(sc) {
        // ── Trend axis ──
        const trendColor = sc.trendScore >= 6 ? '#4caf50' : sc.trendScore >= 4 ? '#ff9800' : '#f44336';
        const trendEl = document.getElementById('trend-score-display');
        trendEl.innerText = `${sc.trendScore.toFixed(1)} / 8`;
        trendEl.style.color = trendColor;
        document.getElementById('trend-raw-display').innerText = `原始 ${sc.trendRaw}/8 × K${sc.k} = ${sc.trendScore.toFixed(1)}`;

        const breadthStr = sc.breadth !== null ? `${sc.breadth.toFixed(0)}%` : '估算';
        const trendRows = [
            { name: 'Copper vs MA3',     val: `$${sc.copper.toFixed(3)}`, score: sc.t1 },
            { name: '10Y Yield vs MA20', val: `${sc.tnx.toFixed(2)}%`,   score: sc.t2 },
            { name: 'DXY vs MA20',       val: sc.dxy.toFixed(1),          score: sc.t3 },
            { name: '市場廣度',           val: breadthStr,                 score: sc.t4 },
        ];
        document.getElementById('trend-tbody').innerHTML = trendRows.map(r =>
            `<tr>
                <td>${r.name}</td>
                <td style="color:#aaa;font-size:10px">${r.val}</td>
                <td><span class="score-tag ${r.score === 2 ? 'tag-green' : r.score > 0 ? 'tag-yellow' : 'tag-red'}">${r.score >= 0 ? '+' : ''}${r.score}</span></td>
            </tr>`
        ).join('');

        // ── Sentiment axis ──
        const sentColor = sc.sentimentScore >= 6 ? '#4caf50' : sc.sentimentScore >= 3 ? '#ff9800' : sc.sentimentScore >= 0 ? '#aaa' : '#f44336';
        const sentEl = document.getElementById('sentiment-score-display');
        sentEl.innerText = `${sc.sentimentScore >= 0 ? '+' : ''}${sc.sentimentScore} / 9`;
        sentEl.style.color = sentColor;

        const hyStr = sc.hyOAS !== null ? `${sc.hyOAS.toFixed(0)}bp` : 'N/A';
        const sentRows = [
            { name: 'VIX',         val: sc.vix.toFixed(1), score: sc.s1 },
            { name: 'Fear & Greed', val: sc.fg.toFixed(0), score: sc.s2 },
            { name: 'HY OAS',      val: hyStr,             score: sc.s3 },
        ];
        document.getElementById('sentiment-tbody').innerHTML = sentRows.map(r =>
            `<tr>
                <td>${r.name}</td>
                <td style="color:#aaa;font-size:10px">${r.val}</td>
                <td><span class="score-tag ${r.score > 0 ? 'tag-green' : r.score === 0 ? 'tag-yellow' : 'tag-red'}">${r.score >= 0 ? '+' : ''}${r.score}</span></td>
            </tr>`
        ).join('');

        // ── K factor ──
        document.getElementById('k-value').innerText = sc.k.toFixed(1);
        document.getElementById('k-value').style.color = sc.k >= 1 ? '#4caf50' : sc.k >= 0.7 ? '#ff9800' : '#f44336';
        document.getElementById('k-desc').innerText = `SPY $${sc.spy.toFixed(1)} vs MA200 $${sc.spyMA200.toFixed(1)} (${sc.spyPct >= 0 ? '+' : ''}${sc.spyPct.toFixed(1)}%)`;
        document.getElementById('k-mode').innerText = sc.k >= 1 ? '☀️ 晴天（全速）' : sc.k >= 0.8 ? '⛅ 輕雲（小幅保守）' : sc.k >= 0.6 ? '🌧 雨天（明顯保守）' : '⛈ 暴雨（最大防守）';
    }

    function renderAlloc(sc) {
        const fund = parseFloat(document.getElementById('fund-input').value) || 0;
        const alloc = getAllocation(sc.trendScore, sc.sentimentScore, sc.pe);

        const trendLabel = sc.trendScore <= 2 ? '防守' : sc.trendScore <= 4 ? '中性偏保守' : sc.trendScore <= 6 ? '中性偏進攻' : '進攻';
        const sentAdj = sc.sentimentScore >= 6 ? '+15%' : sc.sentimentScore >= 3 ? '+8%' : sc.sentimentScore >= 0 ? '0%' : sc.sentimentScore >= -2 ? '-8%' : '-15%';
        document.getElementById('alloc-mode').innerText = `趨勢：${trendLabel}（${sc.trendScore.toFixed(1)}/8）× 情緒調整 ${sentAdj} → 股票 ${alloc.equityPct}%`;

        const colors = { cashPct:'#4caf50', qqqPct:'#4fc3f7', smhPct:'#ce93d8', boxxPct:'#ff9800', qldPct:'#f44336' };
        const labels = { cashPct:'現金', qqqPct:'QQQ', smhPct:'SMH', boxxPct:'BOXX', qldPct:'QLD' };
        let barHtml = '', dollarHtml = '';

        Object.entries(alloc).forEach(([k, v]) => {
            if (k === 'peNote' || k === 'equityPct' || v === 0) return;
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
            const hint = p.c4 ? '⚡ HY OAS > 500bp，信用市場偏緊，留意是否接近觸發。' : '持續觀察，前三條件須同時滿足才觸發。';
            document.getElementById('panic-action').innerText = hint;
        }

        const hyStr = p.hyOAS !== null ? p.hyOAS.toFixed(0) + 'bp' : 'N/A';
        const conditions = [
            { label: 'SPY 週跌幅',     val: `${p.weeklyRet.toFixed(1)}%`, threshold: '≤ -7%',   met: p.c1 },
            { label: 'VIX',            val: p.vix.toFixed(1),              threshold: '> 35',    met: p.c2 },
            { label: 'Fear & Greed',   val: p.fg,                          threshold: '< 20',    met: p.c3 },
            { label: 'HY OAS（輔助）', val: hyStr,                         threshold: '> 500bp', met: p.c4 },
        ];
        document.getElementById('panic-conditions').innerHTML = conditions.map(c => `
            <div class="panic-item ${c.met ? 'panic-met' : 'panic-unmet'}">
                <div class="panic-label">${c.label}</div>
                <div class="panic-value ${c.met ? 'down' : 'up'}">${c.val}</div>
                <div class="panic-threshold" style="color:#888">門檻：${c.threshold}</div>
                <div style="font-size:13px;margin-top:3px">${c.met ? '⚠️ 觸發' : '✅ 正常'}</div>
            </div>`).join('');
    }
