// 和テーマの背景アート生成: 生成りの和紙 + 墨の筆跡(かすれ/飛沫) + 金砂子(金の散らし)
// 参考画像の"美意識"をSVGで一から描き起こす(参考画像そのものは使わない)。
// 使い方: node scripts/gen-wa-bg.mjs > assets/wa-bg.svg
// パラメータを振って調整 → 再生成。決まったらCSSから url("assets/wa-bg.svg") で参照。

const W = 1080, H = 1920;

// 決定論的な擬似乱数(mulberry32)。seedを変えると散らしの配置が変わる
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 金砂子クラスタ: 中心cx,cyから半径方向に密度が落ちる金の粒を撒く
function goldCluster(cx, cy, spread, count, seed) {
  const r = rng(seed);
  const pal = ["#c9a24a", "#d9b45c", "#e7c977", "#b8892f", "#a9781f"];
  let s = "";
  for (let i = 0; i < count; i++) {
    // 中心に密、外に疎(二乗で寄せる) + 角度
    const rad = Math.pow(r(), 1.7) * spread;
    const ang = r() * Math.PI * 2;
    const x = cx + Math.cos(ang) * rad;
    const y = cy + Math.sin(ang) * rad * 1.05;
    const size = 1.4 + Math.pow(r(), 2) * 12;      // 小粒多め、たまに大粒
    const col = pal[(r() * pal.length) | 0];
    const op = 0.5 + r() * 0.5;
    s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${size.toFixed(1)}" fill="${col}" opacity="${op.toFixed(2)}"/>`;
  }
  return s;
}

// 墨の飛沫: 筆の近くに散る不定形の黒点(小さな円+涙形)
function splatter(cx, cy, spread, count, seed) {
  const r = rng(seed);
  let s = "";
  for (let i = 0; i < count; i++) {
    const rad = Math.pow(r(), 1.4) * spread;
    const ang = r() * Math.PI * 2;
    const x = cx + Math.cos(ang) * rad;
    const y = cy + Math.sin(ang) * rad;
    const size = 1 + Math.pow(r(), 2.2) * 13;
    const op = 0.75 + r() * 0.25;
    if (r() < 0.2) {
      // 涙形(尾を引く飛沫)
      const len = size * (2 + r() * 4), a2 = ang + (r() - 0.5);
      const tx = x + Math.cos(a2) * len, ty = y + Math.sin(a2) * len;
      s += `<path d="M${x.toFixed(1)},${y.toFixed(1)} Q${((x+tx)/2).toFixed(1)},${((y+ty)/2).toFixed(1)} ${tx.toFixed(1)},${ty.toFixed(1)}" stroke="#1a1712" stroke-width="${(size*0.7).toFixed(1)}" stroke-linecap="round" fill="none" opacity="${op.toFixed(2)}"/>`;
    } else {
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${size.toFixed(1)}" fill="#1a1712" opacity="${op.toFixed(2)}"/>`;
    }
  }
  return s;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
<defs>
  <!-- 和紙の地の微かな陰影 -->
  <radialGradient id="paperShade" cx="50%" cy="38%" r="75%">
    <stop offset="0%" stop-color="#f4eede"/>
    <stop offset="70%" stop-color="#ece4d0"/>
    <stop offset="100%" stop-color="#e3d9c1"/>
  </radialGradient>
  <!-- 和紙の繊維(細かな斑) -->
  <filter id="washi"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="6" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="0.05"/></feComponentTransfer></filter>
  <!-- 墨(かすれ強め): 抜き・縁のドライブラシ用。芯は残しつつ細かい筋 -->
  <filter id="brushDry" x="-20%" y="-20%" width="140%" height="140%">
    <feTurbulence type="fractalNoise" baseFrequency="0.05 0.11" numOctaves="4" seed="4" result="streak"/>
    <feColorMatrix in="streak" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1.9 -0.5" result="mask"/>
    <feComposite in="SourceGraphic" in2="mask" operator="in" result="dry"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="9" result="grain"/>
    <feDisplacementMap in="dry" in2="grain" scale="6"/>
  </filter>
  <!-- 墨(芯): べた塗りだが縁を有機的に。芯の濃さを担保 -->
  <filter id="inkCore" x="-15%" y="-15%" width="130%" height="130%">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="12" result="g"/>
    <feDisplacementMap in="SourceGraphic" in2="g" scale="4"/>
  </filter>
</defs>

<rect width="${W}" height="${H}" fill="url(#paperShade)"/>
<rect width="${W}" height="${H}" filter="url(#washi)"/>

<!-- 金砂子: 左上と右下(参考画像の配置) -->
${goldCluster(70, 120, 460, 260, 101)}
${goldCluster(880, 1600, 520, 300, 202)}
${goldCluster(300, 1780, 300, 90, 303)}

<!-- 墨: 左上の掃くような弧。主線は芯(solid)+かすれの二枚、脇に細い運びを添える -->
<g fill="none" stroke-linecap="round">
  <path d="M -40,780 C 130,520 250,350 480,50" stroke="#100e0d" stroke-width="34" opacity="0.9" filter="url(#brushDry)"/>
  <path d="M -34,772 C 134,516 252,350 484,52" stroke="#0e0c0b" stroke-width="19" opacity="0.97" filter="url(#inkCore)"/>
  <path d="M 30,690 C 205,485 335,360 560,100" stroke="#131010" stroke-width="9" opacity="0.72" filter="url(#brushDry)"/>
</g>

<!-- 墨: 右下の力強い一掃き。芯(solid)+外側(ドライ)の二枚重ねで"芯は濃く縁はかすれ" -->
<g fill="none" stroke-linecap="round">
  <path d="M 290,1560 C 430,1360 630,1120 790,975 C 905,870 1005,895 1130,985" stroke="#100e0d" stroke-width="96" opacity="0.9" filter="url(#brushDry)"/>
  <path d="M 300,1545 C 435,1355 625,1130 788,982 C 900,880 1000,902 1125,990" stroke="#0e0c0b" stroke-width="64" opacity="0.98" filter="url(#inkCore)"/>
  <path d="M 360,1520 C 520,1300 700,1120 905,1012" stroke="#131010" stroke-width="22" opacity="0.7" filter="url(#brushDry)"/>
</g>

<!-- 墨の飛沫(筆の起点/終点付近) -->
${splatter(430, 220, 240, 60, 404)}
${splatter(340, 1470, 260, 70, 505)}
${splatter(1050, 980, 150, 24, 606)}
</svg>`;

process.stdout.write(svg);
