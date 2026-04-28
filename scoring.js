    const AI_MEAN = 35.55, AI_SD = 4.27;
    const PE_CAP1 = 39.33;   // → max equity 55%
    const PE_CAP2 = 36;      // → max equity 65%
    const PE_WARN1 = AI_MEAN + AI_SD;    // 39.82
    const PE_WARN2 = AI_MEAN + 2*AI_SD; // 44.09

    let gData = null;
    let chartsDrawn = [];

    // ─── Utility ──────────────────────────────────────────────────────────
    function calcMA(closes, period) {
        if (!closes || closes.length < period) return closes ? closes[closes.length-1] : null;
        return closes.slice(-period).reduce((a,b) => a+b, 0) / period;
    }
    function calcMA_full(closes, period) {
        return closes.map((_, i) => i < period-1 ? null : closes.slice(i-period+1, i+1).reduce((a,b)=>a+b,0)/period);
    }
    function pct(val, ref) { return ((val - ref) / ref * 100); }
    function colorPct(v) { return v >= 0 ? `<span class="up">+${v.toFixed(2)}%</span>` : `<span class="down">${v.toFixed(2)}%</span>`; }

    // ─── Dual-Axis Scoring ────────────────────────────────────────────────
    function computeScore() {
        const d = gData;
        const vix      = d.vix?.currentPrice ?? 20;
        const fg       = d.fearGreed?.score ?? 50;
        const hyOAS    = d.hyOAS?.current ?? null;
        const breadth  = d.breadth?.pct ?? null;
        const copper   = d.copper?.currentPrice ?? 4.5;
        const copperMA3 = calcMA(d.copper?.closes, 3) ?? copper;
        const tnx      = d.tnx?.currentPrice ?? 4.3;
        const tnxMA20  = calcMA(d.tnx?.closes, 20) ?? tnx;
        const pe       = d.shiller?.current ?? 35;
        const dxy      = d.dxy?.currentPrice ?? 100;
        const dxyMA20  = calcMA(d.dxy?.closes, 20) ?? dxy;

        const spyCloses = d.spy?.closes ?? d.spx?.closes ?? [];
        const spy       = d.spy?.currentPrice ?? d.spx?.currentPrice ?? 500;
        const spyMA200  = calcMA(spyCloses, 200) ?? spy;
        const spyPct    = pct(spy, spyMA200);

        // ── TREND AXIS (0–8, momentum) ──
        const t1 = copper > copperMA3 ? 2 : 0;
        const t2 = tnx < tnxMA20 ? 2 : 0;
        const t3 = dxy < dxyMA20 ? 2 : 0;
        const t4 = breadth !== null ? (breadth > 70 ? 2 : breadth > 50 ? 1 : 0) : 1; // default 1 if unknown
        const trendRaw = t1 + t2 + t3 + t4;

        // K factor: SPY vs MA200
        let k;
        if (spyPct >= 0) k = 1.0;
        else if (spyPct >= -5) k = 0.8;
        else if (spyPct >= -15) k = 0.6;
        else k = 0.5;
        const trendScore = parseFloat((trendRaw * k).toFixed(2));

        // ── SENTIMENT AXIS (-3 to +9, contrarian) ──
        // Inverted: high fear = high score = buy signal
        const s1 = vix > 35 ? 3 : vix > 28 ? 2 : vix > 20 ? 1 : vix > 15 ? 0 : -1;
        const s2 = fg < 20 ? 3 : fg < 40 ? 2 : fg < 60 ? 1 : fg < 75 ? 0 : -1;
        const s3 = hyOAS !== null ? (hyOAS > 600 ? 3 : hyOAS > 500 ? 2 : hyOAS > 400 ? 1 : hyOAS > 300 ? 0 : -1) : 0;
        const sentimentScore = s1 + s2 + s3;

        return {
            vix, fg, hyOAS, breadth,
            copper, copperMA3, tnx, tnxMA20, pe, dxy, dxyMA20,
            spy, spyMA200, spyPct, k,
            t1, t2, t3, t4, trendRaw, trendScore,
            s1, s2, s3, sentimentScore,
            // legacy compat
            rawScore: trendScore, finalScore: trendScore
        };
    }

    function getAllocation(trendScore, sentimentScore, pe) {
        // Base equity from trend axis
        let baseEquity;
        if (trendScore <= 2)      baseEquity = 0.40;
        else if (trendScore <= 4) baseEquity = 0.55;
        else if (trendScore <= 6) baseEquity = 0.75;
        else                      baseEquity = 0.90;

        // Sentiment adjustment (contrarian)
        let sAdj;
        if (sentimentScore >= 6)       sAdj =  0.15;
        else if (sentimentScore >= 3)  sAdj =  0.08;
        else if (sentimentScore >= 0)  sAdj =  0.00;
        else if (sentimentScore >= -2) sAdj = -0.08;
        else                           sAdj = -0.15;

        let equityPct = Math.min(1.0, Math.max(0.0, baseEquity + sAdj));

        // Shiller PE hard cap
        let peNote = '';
        if (pe > PE_CAP1) {
            equityPct = Math.min(equityPct, 0.55);
            peNote = `⚠️ Shiller PE ${pe.toFixed(2)} > 39.33 → 股票上限 55%`;
        } else if (pe > PE_CAP2) {
            equityPct = Math.min(equityPct, 0.65);
            peNote = `⚠️ Shiller PE ${pe.toFixed(2)} > 36 → 股票上限 65%`;
        }

        // Distribute equity
        const equityPctRound = Math.round(equityPct * 100);
        const qldPct  = (equityPct > 0.80 && pe < PE_CAP2) ? Math.round(equityPct * 0.10 * 100) : 0;
        const rem     = equityPct - qldPct / 100;
        const qqqPct  = Math.round(rem * 0.44 * 100);
        const smhPct  = Math.round(rem * 0.56 * 100);
        const boxxPct = Math.round((1 - equityPct) * 0.60 * 100);
        const cashPct = 100 - equityPctRound - boxxPct;

        return { cashPct, qqqPct, smhPct, boxxPct, qldPct, peNote, equityPct: equityPctRound };
    }

    // ─── Panic trigger (3 core + 1 supplementary) ────────────────────────
    function checkPanic() {
        const d = gData;
        const vix       = d.vix?.currentPrice ?? 20;
        const fg        = d.fearGreed?.score ?? 50;
        const weeklyRet = d.spy?.weeklyReturn ?? d.spx?.weeklyReturn ?? 0;
        const hyOAS     = d.hyOAS?.current ?? null;

        const c1 = weeklyRet <= -7;
        const c2 = vix > 35;
        const c3 = fg < 20;
        const c4 = hyOAS !== null ? hyOAS > 500 : false; // supplementary
        const triggered = c1 && c2 && c3;

        return { triggered, weeklyRet, vix, fg, hyOAS, c1, c2, c3, c4 };
    }
