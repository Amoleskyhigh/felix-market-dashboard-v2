    const AI_MEAN = 35.55, AI_SD = 4.27;
    const PE_WARN1 = AI_MEAN + AI_SD;   // 39.82
    const PE_WARN2 = AI_MEAN + 2*AI_SD; // 44.09
    const PE_SCORE_T1 = 36, PE_SCORE_T2 = 39.33;

    let gData = null;
    let chartsDrawn = [];

    // ─── Utility ──────────────────────────────────────────────────────────
    function calcMA(closes, period) {
        if (!closes || closes.length < period) return closes ? closes[closes.length-1] : null;
        return closes.slice(-period).reduce((a,b) => a+b, 0) / period;
    }
    function calcMA_full(closes, period) {
        // Returns full array of MAs (same length as closes, null for early entries)
        return closes.map((_, i) => i < period-1 ? null : closes.slice(i-period+1, i+1).reduce((a,b)=>a+b,0)/period);
    }
    function pct(val, ref) { return ((val - ref) / ref * 100); }
    function colorPct(v) { return v >= 0 ? `<span class="up">+${v.toFixed(2)}%</span>` : `<span class="down">${v.toFixed(2)}%</span>`; }

    // ─── Scoring ───────────────────────────────────────────────────────────
    function computeScore() {
        const d = gData;
        const vix = d.vix?.currentPrice ?? 20;
        const fg  = d.fearGreed?.score ?? 50;
        const copper = d.copper?.currentPrice ?? 4.5;
        const copperMA3 = calcMA(d.copper?.closes, 3) ?? copper;
        const tnx = d.tnx?.currentPrice ?? 4.3;
        const tnxMA20 = calcMA(d.tnx?.closes, 20) ?? tnx;
        const pe  = d.shiller?.current ?? 35;
        const dxy = d.dxy?.currentPrice ?? 100;
        const dxyMA20 = calcMA(d.dxy?.closes, 20) ?? dxy;

        // SPY vs MA200
        const spyCloses = d.spy?.closes ?? d.spx?.closes ?? [];
        const spy = d.spy?.currentPrice ?? d.spx?.currentPrice ?? 500;
        const spyMA200 = calcMA(spyCloses, 200) ?? spy;
        const spyPct = pct(spy, spyMA200);

        // Scores
        const vixRaw = vix > 35 ? 3 : vix > 28 ? 2 : vix > 20 ? 1 : 0;
        const fgRaw  = fg < 25 ? 2 : fg < 40 ? 1 : 0;
        const copperRaw = copper > copperMA3 ? 1 : 0;
        const tnxRaw = tnx < tnxMA20 ? 1 : 0;
        const peRaw  = pe < PE_SCORE_T1 ? 2 : pe < PE_SCORE_T2 ? 1 : 0;
        const dxyRaw = dxy < dxyMA20 ? 1 : 0;

        const rawScore = (vixRaw*3) + (fgRaw*2) + (copperRaw*2) + (tnxRaw*2) + (peRaw*2) + (dxyRaw*1);

        // K coefficient
        let k;
        if (spyPct >= 0) k = 1.0;
        else if (spyPct >= -5) k = 0.8;
        else if (spyPct >= -15) k = 0.6;
        else k = 0.5;

        const finalScore = parseFloat((rawScore * k).toFixed(2));

        return {
            vix, vixRaw, vixMA: null,
            fg, fgRaw,
            copper, copperMA3, copperRaw,
            tnx, tnxMA20, tnxRaw,
            pe, peRaw,
            dxy, dxyMA20, dxyRaw,
            rawScore, k, finalScore, spyPct, spy, spyMA200
        };
    }

    function getAllocation(finalScore, pe) {
        let cashPct, qqqPct, smhPct, boxxPct, qldPct;

        if (finalScore <= 3) {
            cashPct=35; qqqPct=35; smhPct=25; boxxPct=5; qldPct=0;
        } else if (finalScore <= 6) {
            cashPct=20; qqqPct=30; smhPct=40; boxxPct=10; qldPct=0;
        } else if (finalScore <= 9) {
            cashPct=10; qqqPct=40; smhPct=40; boxxPct=10; qldPct=0;
        } else {
            cashPct=5; qqqPct=35; smhPct=50; boxxPct=5; qldPct=5;
        }

        let peNote = '';
        if (pe >= PE_SCORE_T2) {
            qqqPct = Math.max(0, qqqPct - 10);
            smhPct = Math.max(0, smhPct - 10);
            boxxPct += 20;
            peNote = `⚠️ Shiller PE ${pe.toFixed(2)} > 39.33（+1σ過熱）：BOXX 額外 +20%`;
        } else if (pe >= PE_SCORE_T1) {
            qqqPct = Math.max(0, qqqPct - 5);
            smhPct = Math.max(0, smhPct - 5);
            boxxPct += 10;
            peNote = `⚠️ Shiller PE ${pe.toFixed(2)} 在 36–39.33（略高）：BOXX +10%`;
        }

        const total = cashPct + qqqPct + smhPct + boxxPct + qldPct;
        if (total !== 100) {
            const diff = 100 - total;
            boxxPct = Math.max(0, boxxPct + diff);
        }

        return { cashPct, qqqPct, smhPct, boxxPct, qldPct, peNote };
    }

    // ─── Panic trigger ───────────────────────────────────────────────────
    function checkPanic() {
        const d = gData;
        const vix = d.vix?.currentPrice ?? 20;
        const fg  = d.fearGreed?.score ?? 50;
        const weeklyRet = d.spy?.weeklyReturn ?? d.spx?.weeklyReturn ?? 0;

        const c1 = weeklyRet <= -7;
        const c2 = vix > 35;
        const c3 = fg < 20;
        const triggered = c1 && c2 && c3;

        return { triggered, weeklyRet, vix, fg, c1, c2, c3 };
    }
