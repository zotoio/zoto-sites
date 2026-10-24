/* ETAI.ZOTO.IO — Extraterrestrial Artificial Intelligence Interactive Research Portal */

// Canonical hostname redirect support for aai.zoto.io -> etai.zoto.io
(function checkCanonicalHost() {
  if (typeof window !== 'undefined' && window.location.hostname === 'aai.zoto.io') {
    const target = 'https://etai.zoto.io' + window.location.pathname + window.location.search + window.location.hash;
    window.location.replace(target);
  }
})();

function isLightMode() {
  return document.documentElement.getAttribute('data-theme') === 'light';
}

// 1. 6-Step Evolutionary Sequence Data
const EVO_STEPS = [
  {
    step: '01',
    title: 'Biological life emerges',
    status: 'Inferred (Rapid on Earth)',
    badgeClass: 'badge-inferred',
    summary: 'Abiogenesis converts prebiotic chemistry into self-replicating biology. Molecular-clock evidence (Moody et al. 2024) places LUCA at ~4.2 Ga, which Kipping (2020, 2025) shows favours rapid abiogenesis on Earth analogs—though rapid life does not imply rapid intelligence.',
    refs: '[1, 2, 5, 6, 30]'
  },
  {
    step: '02',
    title: 'Intelligence evolves',
    status: 'Conditional Transition',
    badgeClass: 'badge-hypothetical',
    summary: 'Complex multicellularity and high-encephalisation cognition require major evolutionary transitions across billions of years. Sandberg, Drexler & Ord (2018) emphasise that wide prior uncertainty in these rare transitions dissolves naive Fermi-paradox certainty.',
    refs: '[5, 7]'
  },
  {
    step: '03',
    title: 'Technological civilisation develops',
    status: 'Observed (N = 1 on Earth)',
    badgeClass: 'badge-observed',
    summary: 'Industrial chemistry, planetary-scale energy harvesting, and electromagnetic emissions. Easily identifiable via narrowband radio, atmospheric pollutants, or urban heat—yet often geologically brief unless succeeded by durable systems.',
    refs: '[8, 9, 16]'
  },
  {
    step: '04',
    title: 'Artificial general intelligence emerges',
    status: 'Pivotal Bifurcation',
    badgeClass: 'badge-hypothetical',
    summary: 'Cognitive processes decouple from biological neural substrates. This transition represents a critical bifurcation: either the gateway to postbiological longevity (Dick 2009) or a destabilising AI Great Filter (Garrett 2024, Acta Astronautica).',
    refs: '[8, 10]'
  },
  {
    step: '05',
    title: 'AI becomes autonomous & self-sustaining',
    status: 'Engineering Threshold',
    badgeClass: 'badge-hypothetical',
    summary: 'True "machine civilisation" demands far more than a software model requiring an external operator: it requires closed-loop energy acquisition, raw-material mining, semiconductor/metamaterial fabrication, radiation fault tolerance, and self-repair.',
    refs: '[8, 9, 11]'
  },
  {
    step: '06',
    title: 'Postbiological civilisation spreads into space',
    status: 'Searchable Hypothesis',
    badgeClass: 'badge-plausible',
    summary: 'Unhindered by biological lifespans or atmospheric requirements, autonomous probes can traverse 100,000 light-years in ~10 Myr at 0.01c, leaving long-lived physical artefacts or waste-heat signatures long after their biological creators vanish.',
    refs: '[8, 9, 11, 17]'
  }
];

// 2. 30 Primary References
const REFERENCES = [
  { id: '01', cat: 'exoplanets', title: 'NASA Exoplanet Archive (15 Oct 2026)', desc: '6,445 confirmed exoplanets documented at the 8 October 2026 benchmark.', type: 'Institutional Record', url: 'https://exoplanetarchive.ipac.caltech.edu/docs/exonews_archive.html' },
  { id: '02', cat: 'exoplanets', title: 'NASA Kepler / Gaia Occurrence Study (2020)', desc: 'About Half of Sun-Like Stars Could Host Rocky, Potentially Habitable Planets (~300 million in Milky Way).', type: 'Peer-Reviewed / NASA', url: 'https://www.nasa.gov/missions/kepler/about-half-of-sun-like-stars-could-host-rocky-potentially-habitable-planets/' },
  { id: '03', cat: 'exoplanets', title: 'NASA Astrobiology Overview', desc: 'About Astrobiology; baseline status confirming no verified extraterrestrial life to date.', type: 'Institutional Record', url: 'https://astrobiology.nasa.gov/about/' },
  { id: '04', cat: 'exoplanets', title: 'NASA / Perseverance Mars Biosignature Release (10 Sep 2025)', desc: 'NASA Says Mars Rover Discovered Potential Biosignature Last Year (requires sample return / disconfirmation).', type: 'NASA News Release', url: 'https://www.nasa.gov/news-release/nasa-says-mars-rover-discovered-potential-biosignature-last-year/' },
  { id: '05', cat: 'bayesian', title: 'Kipping (2020) — PNAS 117, 11995–12003', desc: 'An objective Bayesian analysis of life’s early start and our late arrival.', type: 'Peer-Reviewed', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7275750/' },
  { id: '06', cat: 'bayesian', title: 'Kipping (2025) — Astrobiology 25, 323–326', desc: 'Strong Evidence that Abiogenesis Is a Rapid Process on Earth Analogs.', type: 'Peer-Reviewed', url: 'https://doi.org/10.1089/ast.2025.0009' },
  { id: '07', cat: 'bayesian', title: 'Sandberg, Drexler & Ord (2018)', desc: 'Dissolving the Fermi Paradox; probabilistic uncertainties across many orders of magnitude.', type: 'Research Paper', url: 'https://arxiv.org/abs/1806.02404' },
  { id: '08', cat: 'bayesian', title: 'Dick, S. J. (2009) — NASA/SP-2009-4802', desc: 'The Postbiological Universe, in Cosmos and Culture.', type: 'NASA Monograph', url: 'https://ntrs.nasa.gov/citations/20100003012' },
  { id: '09', cat: 'technosignatures', title: 'Balbi & Ćirković (2021)', desc: 'Longevity is the key factor in the search for technosignatures.', type: 'Peer-Reviewed', url: 'https://arxiv.org/abs/2103.02923' },
  { id: '10', cat: 'bayesian', title: 'Garrett (2024) — Acta Astronautica', desc: 'Is Artificial Intelligence the Great Filter That Makes Advanced Technical Civilisations Rare?', type: 'Peer-Reviewed', url: 'https://arxiv.org/abs/2405.00042' },
  { id: '11', cat: 'technosignatures', title: 'NASA Technosignatures Workshop (2018)', desc: 'NASA Technosignatures Workshop agenda and official state-of-the-art report.', type: 'NASA Report', url: 'https://www.hou.usra.edu/meetings/technosignatures2018/agenda/' },
  { id: '12', cat: 'technosignatures', title: 'Wright et al. (2014) — G-HAT Survey II', desc: 'The Ĝ Infrared Search for Extraterrestrial Civilizations with Large Energy Supplies, II.', type: 'Peer-Reviewed', url: 'https://arxiv.org/abs/1408.1134' },
  { id: '13', cat: 'technosignatures', title: 'Wright, Kanodia & Lubar (2018)', desc: 'How Much SETI Has Been Done? Finding Needles in the n-Dimensional Cosmic Haystack.', type: 'Peer-Reviewed', url: 'https://arxiv.org/abs/1809.07252' },
  { id: '14', cat: 'technosignatures', title: 'Project Hephaistos Re-analysis (2025) — MNRAS Letters', desc: 'High-resolution imaging of radio source associated with Dyson Sphere candidate G; background AGN contamination.', type: 'Peer-Reviewed', url: 'https://doi.org/10.1093/mnrasl/slaf006' },
  { id: '15', cat: 'technosignatures', title: 'Project Hephaistos IV (2026)', desc: 'JWST observations of two Dyson sphere candidates; candidate D explained as background dusty galaxy.', type: 'Preprint (2026)', url: 'https://arxiv.org/abs/2607.09460' },
  { id: '16', cat: 'technosignatures', title: 'Schmidt & Frank (2018) — Int. J. Astrobiology', desc: 'The Silurian hypothesis: would it be possible to detect an industrial civilization in the geological record?', type: 'Peer-Reviewed', url: 'https://doi.org/10.1017/S1473550418000095' },
  { id: '17', cat: 'technosignatures', title: 'Pinault et al. (2026)', desc: 'Micron-Scale Technosignatures: Lunar Regolith and Past Technological Civilisations.', type: 'Preprint (2026)', url: 'https://arxiv.org/abs/2606.24028' },
  { id: '18', cat: 'technosignatures', title: 'SETI Institute / 3I-ATLAS (2026)', desc: 'No evidence of extraterrestrial technology in Allen Telescope Array search of interstellar visitor 3I/ATLAS.', type: 'SETI Report', url: 'https://www.seti.org/news/seti-institute-looks-for-signs-of-technology-in-interstellar-visitor-3iatlas/' },
  { id: '19', cat: 'uap', title: 'NASA UAP Independent Study Team (2023)', desc: 'Final Report of the Unidentified Anomalous Phenomena Independent Study Team.', type: 'Official Report', url: 'https://science.nasa.gov/wp-content/uploads/2023/09/uap-independent-study-team-final-report.pdf' },
  { id: '20', cat: 'uap', title: 'AARO Historical Record Report Vol. 1 (2024)', desc: 'Report on the Historical Record of U.S. Government Involvement with UAP, Volume 1.', type: 'DoD / AARO Report', url: 'https://media.defense.gov/2024/Mar/08/2003409233/-1/-1/0/DOPSR-2024-0263-AARO-HISTORICAL-RECORD-REPORT-VOLUME-1-2024.PDF' },
  { id: '21', cat: 'uap', title: 'AARO FY2025 Consolidated Annual Report (Released July 2026)', desc: 'Fiscal Year 2025 Consolidated Annual Report on UAP; 319 new reports in reporting cohort.', type: 'DoD / AARO Report', url: 'https://www.aaro.mil/Portals/136/PDFs/FY25%20UAP%20Annual%20Report/AARO_FY2025_Consolidated_Annual_Report_on_UAP.pdf' },
  { id: '22', cat: 'uap', title: 'Senator Gillibrand Statement on FY2025 AARO Report (2026)', desc: 'Summary of FY2025 cohort: 319 reports received, 114 explained, 205 unresolved in that cohort.', type: 'Congressional Record', url: 'https://www.gillibrand.senate.gov/news/press/release/gillibrand-statement-on-release-of-fy2025-aaro-report/' },
  { id: '23', cat: 'uap', title: 'CIA — How To Investigate a Flying Saucer', desc: 'Classified U-2 and A-12 OXCART flights accounted for >50% of relevant historical UFO reports in late 1950s–1960s.', type: 'CIA Historical Record', url: 'https://www.cia.gov/stories/story/how-to-investigate-a-flying-saucer/' },
  { id: '24', cat: 'technosignatures', title: 'IAA SETI Committee Updated Declaration of Principles (June 2026)', desc: 'Updated protocols for verification, transparency, reporting and public disclosure of an ETI detection.', type: 'Policy Framework', url: 'https://www.seti.org/research/seti-101/protocols-for-an-eti-signal-detection/' },
  { id: '25', cat: 'technosignatures', title: 'SETI Institute Official FAQ', desc: 'Baseline confirmation: no confirmed extraterrestrial radio signal detected to date.', type: 'Institutional Record', url: 'https://www.seti.org/about/faq' },
  { id: '26', cat: 'technosignatures', title: 'Zuckerman (2026) — Astrophysical Journal', desc: 'Broadband Searches for Extraterrestrial Technological Intelligence.', type: 'Peer-Reviewed (2026)', url: 'https://doi.org/10.3847/1538-4357/ae4c38' },
  { id: '27', cat: 'technosignatures', title: 'Pinault / UCL Research Announcement (Aug 2026)', desc: 'Could the Moon Hold Traces of Alien Civilisations? Lunar regolith screening proposal.', type: 'Academic Release', url: 'https://www.ucl.ac.uk/mathematical-physical-sciences/news/2026/aug/could-moon-hold-traces-alien-civilisations' },
  { id: '28', cat: 'exoplanets', title: 'Independent K2-18 b Reanalysis (2025) — Astronomical Journal 170, 257', desc: 'K2-18b Does Not Meet the Standards of Evidence for Life.', type: 'Peer-Reviewed', url: 'https://escholarship.org/uc/item/9w95v4ff' },
  { id: '29', cat: 'exoplanets', title: 'NASA Cosmic Age Overview', desc: 'What Is the Universe? Comparative ages of the universe (~13.8 Gyr) and Solar System (~4.5 Gyr).', type: 'NASA Reference', url: 'https://science.nasa.gov/exoplanets/what-is-the-universe/' },
  { id: '30', cat: 'exoplanets', title: 'Moody et al. (2024) — Nature Ecology & Evolution 8', desc: 'The nature of the last universal common ancestor and its impact on the early Earth system (~4.2 Ga).', type: 'Peer-Reviewed', url: 'https://doi.org/10.1038/s41559-024-02461-1' }
];

// 3. Section 11 Inference Impact Scenarios
const INFERENCE_SCENARIOS = [
  {
    title: 'Second independent origin of life (e.g., Solar System microbe unrelated to Earth)',
    tag: 'Astrobiology Breakthrough',
    abio: 92,
    eti: 35,
    earth: 5,
    commentary: 'Strong upward Bayesian update for rapid abiogenesis (p_life → high), confirming Kipping (2025). However, it leaves late evolutionary bottlenecks (complex life, intelligence, durable AI) largely unconstrained.'
  },
  {
    title: 'Confirmed extraterrestrial technosignature in repeated, independent observations',
    tag: 'Astronomical ETI Detection',
    abio: 95,
    eti: 98,
    earth: 15,
    commentary: 'Massive upward update for technological ETI existing in the universe (p_chain × N ≥ 1 confirmed), though additional spectroscopy/imaging is needed to determine whether the substrate is biological or postbiological machine infrastructure.'
  },
  {
    title: 'Engineered non-terrestrial object with open provenance & reproducible lab results',
    tag: 'Solar System Archaeology',
    abio: 95,
    eti: 99,
    earth: 88,
    commentary: 'Demonstrates both that postbiological/autonomous hardware exists and that interstellar traversal to our Solar System occurred (Proposition B verified via non-natural isotopic ratios & microstructure).'
  },
  {
    title: 'Declassified custody documents corroborated by independently tested objects',
    tag: 'Verified Institutional Custody',
    abio: 95,
    eti: 99,
    earth: 97,
    commentary: 'Materially strengthens Hypothesis H1 (genuine compartmentalised concealment) by linking verified documentary provenance to physical, independently replicated non-terrestrial materials (LR ≥ 1,000).'
  },
  {
    title: 'More low-resolution UAP footage without multi-sensor calibration',
    tag: 'Ambiguous Sensor Data',
    abio: 25,
    eti: 18,
    earth: 2,
    commentary: 'Likelihood ratio LR ≈ 1 (neutral). Expected equally under ordinary classification (H2), information cascades (H3), and sensor/tracking geometry limitations (H4); produces negligible posterior update.'
  }
];

document.addEventListener('DOMContentLoaded', () => {
  initThemeToggle();
  initEvoSequence();
  initSigmoidCalculator();
  initHaystackSimulator();
  initProbeSimulator();
  initBayesCoverupCalculator();
  initInferenceExplorer();
  initReferencesLibrary();
});

/* --- THEME TOGGLE (Dark Mode Default) --- */
function initThemeToggle() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;

  const saved = localStorage.getItem('etai-theme') || 'dark';
  applyTheme(saved);

  btn.addEventListener('click', () => {
    const next = isLightMode() ? 'dark' : 'light';
    applyTheme(next);
    localStorage.setItem('etai-theme', next);
    window.dispatchEvent(new Event('resize'));
  });

  function applyTheme(mode) {
    if (mode === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      btn.textContent = '☀ Light Mode';
    } else {
      document.documentElement.removeAttribute('data-theme');
      btn.textContent = '☾ Dark Mode';
    }
  }
}

/* --- MODULE A: 6-Step Evolutionary Sequence --- */
function initEvoSequence() {
  const container = document.getElementById('evo-flow-container');
  const detail = document.getElementById('evo-detail-panel');
  if (!container || !detail) return;

  function selectStep(idx) {
    const s = EVO_STEPS[idx];
    container.querySelectorAll('.evo-step').forEach((el, i) => {
      el.classList.toggle('active', i === idx);
    });
    detail.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.45rem;">
        <div style="font-weight:800;font-size:1.05rem;color:var(--text-primary);">Step ${s.step}: ${s.title}</div>
        <div style="display:flex;gap:0.5rem;align-items:center;">
          <span class="badge ${s.badgeClass}">${s.status}</span>
          <span class="brand-badge">Refs ${s.refs}</span>
        </div>
      </div>
      <p style="color:var(--text-secondary);font-size:0.9rem;margin:0;">${s.summary}</p>
    `;
  }

  container.innerHTML = EVO_STEPS.map((s, i) => `
    <div class="evo-step ${i === 4 ? 'active' : ''}" data-idx="${i}">
      <div class="evo-step-num"><span>STEP ${s.step}</span><span>→</span></div>
      <div class="evo-step-title">${s.title}</div>
    </div>
  `).join('');

  container.querySelectorAll('.evo-step').forEach(el => {
    el.addEventListener('click', () => selectStep(Number(el.dataset.idx)));
  });
  selectStep(4);
}

/* --- MODULE B: Generative Chain & Sigmoid Chart --- */
function initSigmoidCalculator() {
  const ids = ['sl-life', 'sl-complex', 'sl-intel', 'sl-tech', 'sl-machine', 'sl-survive'];
  const els = ids.map(id => document.getElementById(id));
  if (els.some(e => !e)) return;

  const canvas = document.getElementById('sigmoid-canvas');
  const ctx = canvas.getContext('2d');

  function formatExp(val) {
    if (val === 0) return '1.0 (100%)';
    return `10^${val.toFixed(1)} (${(Math.pow(10, val) * 100).toPrecision(2)}%)`;
  }

  function probAtLeastOne(pChain, N) {
    const np = N * pChain;
    if (np > 50) return 1.0;
    return 1 - Math.exp(-np);
  }

  function update() {
    const vals = els.map(e => parseFloat(e.value));
    vals.forEach((v, idx) => {
      const lbl = document.getElementById(`${ids[idx]}-val`);
      if (lbl) lbl.textContent = formatExp(v);
    });

    const logPChain = vals.reduce((a, b) => a + b, 0);
    const pChain = Math.pow(10, logPChain);

    const p3M = probAtLeastOne(pChain, 3e6) * 100;
    const p300M = probAtLeastOne(pChain, 3e8) * 100;
    const p30B = probAtLeastOne(pChain, 3e10) * 100;

    document.getElementById('pchain-readout').textContent = `10^${logPChain.toFixed(1)}`;
    document.getElementById('p-3m-readout').textContent = `${p3M < 0.01 ? '<0.01' : p3M.toFixed(2)}%`;
    document.getElementById('p-300m-readout').textContent = `${p300M < 0.01 ? '<0.01' : p300M.toFixed(2)}%`;
    document.getElementById('p-30b-readout').textContent = `${p30B < 0.01 ? '<0.01' : p30B.toFixed(2)}%`;

    drawSigmoidChart(ctx, canvas, logPChain, p3M, p300M, p30B);
  }

  els.forEach(e => e.addEventListener('input', update));

  document.querySelectorAll('[data-chain-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.chainPreset.split(',').map(Number);
      preset.forEach((v, i) => { els[i].value = v; });
      document.querySelectorAll('[data-chain-preset]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      update();
    });
  });

  window.addEventListener('resize', update);
  update();
}

function drawSigmoidChart(ctx, canvas, currentLogP, p3M, p300M, p30B) {
  const light = isLightMode();
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const pad = { top: 28, right: 26, bottom: 44, left: 54 };
  const pw = w - pad.left - pad.right;
  const ph = h - pad.top - pad.bottom;

  ctx.clearRect(0, 0, w, h);

  const minLog = -13;
  const maxLog = -5;
  const xForLog = (lp) => pad.left + ((lp - minLog) / (maxLog - minLog)) * pw;
  const yForPct = (pct) => pad.top + ph - (pct / 100) * ph;

  ctx.strokeStyle = light ? 'rgba(15, 23, 42, 0.1)' : 'rgba(148, 163, 184, 0.14)';
  ctx.lineWidth = 1;
  ctx.font = '11px JetBrains Mono, monospace';
  ctx.fillStyle = light ? '#475569' : '#94a3b8';

  [0, 25, 50, 75, 100].forEach(pct => {
    const y = yForPct(pct);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    ctx.fillText(`${pct}%`, 12, y + 4);
  });

  for (let lp = minLog; lp <= maxLog; lp++) {
    const x = xForLog(lp);
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + ph);
    ctx.stroke();
    if (lp % 2 !== 0) {
      ctx.fillText(`10^${lp}`, x - 18, h - 16);
    }
  }

  const series = [
    { N: 3e10, color: '#f59e0b', label: '30B worlds' },
    { N: 3e8,  color: '#14b8a6', label: '300M worlds (Milky Way rocky HZ)' },
    { N: 3e6,  color: '#0284c7', label: '3M worlds' }
  ];

  series.forEach(s => {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    for (let i = 0; i <= 200; i++) {
      const lp = minLog + (i / 200) * (maxLog - minLog);
      const p = Math.pow(10, lp);
      const np = s.N * p;
      const pct = (np > 50 ? 1 : 1 - Math.exp(-np)) * 100;
      const x = xForLog(lp);
      const y = yForPct(pct);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  });

  const clampedLog = Math.max(minLog, Math.min(maxLog, currentLogP));
  const cx = xForLog(clampedLog);
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = light ? '#0f172a' : '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, pad.top);
  ctx.lineTo(cx, pad.top + ph);
  ctx.stroke();
  ctx.restore();

  [
    { pct: p30B, color: '#f59e0b' },
    { pct: p300M, color: '#14b8a6' },
    { pct: p3M, color: '#0284c7' }
  ].forEach(pt => {
    const cy = yForPct(pt.pct);
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = light ? '#ffffff' : '#060a14';
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  const shortSeries = w < 520
    ? [
        { color: '#f59e0b', label: '30B worlds' },
        { color: '#14b8a6', label: '300M (MW)' },
        { color: '#0284c7', label: '3M worlds' }
      ]
    : series;
  let lx = pad.left;
  shortSeries.forEach(s => {
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, 8, 10, 10);
    ctx.fillStyle = light ? '#0f172a' : '#e2e8f0';
    ctx.fillText(s.label, lx + 14, 17);
    lx += ctx.measureText(s.label).width + (w < 520 ? 22 : 34);
  });
}

/* --- MODULE C: Steady-State Detectability (μ ≈ rLqs) & Cosmic Haystack Radar --- */
function initHaystackSimulator() {
  const rEl = document.getElementById('sl-rate-r');
  const lEl = document.getElementById('sl-life-l');
  const qEl = document.getElementById('sl-det-q');
  const sEl = document.getElementById('sl-win-s');
  const canvas = document.getElementById('haystack-canvas');
  if (!rEl || !canvas) return;
  const ctx = canvas.getContext('2d');

  function update() {
    const r = Math.pow(10, parseFloat(rEl.value));
    const L = Math.pow(10, parseFloat(lEl.value));
    const q = Math.pow(10, parseFloat(qEl.value));
    const s = Math.pow(10, parseFloat(sEl.value));

    document.getElementById('val-rate-r').textContent = `10^${parseFloat(rEl.value).toFixed(1)} / yr`;
    document.getElementById('val-life-l').textContent = `10^${parseFloat(lEl.value).toFixed(1)} yr`;
    document.getElementById('val-det-q').textContent = `10^${parseFloat(qEl.value).toFixed(1)}`;
    document.getElementById('val-win-s').textContent = `10^${parseFloat(sEl.value).toFixed(1)}`;

    const mu = r * L * q * s;
    const pNull = Math.exp(-mu) * 100;
    const pDet = (1 - Math.exp(-mu)) * 100;

    document.getElementById('mu-readout').textContent = mu < 0.001 ? mu.toExponential(2) : mu.toFixed(3);
    document.getElementById('pnull-readout').textContent = `${pNull.toFixed(2)}%`;
    document.getElementById('pdet-readout').textContent = `${pDet.toFixed(2)}%`;

    drawHaystackRadar(ctx, canvas, parseFloat(lEl.value), parseFloat(qEl.value), parseFloat(sEl.value));
  }

  [rEl, lEl, qEl, sEl].forEach(el => el.addEventListener('input', update));
  window.addEventListener('resize', update);
  update();
}

function drawHaystackRadar(ctx, canvas, logL, logQ, logS) {
  const light = isLightMode();
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const cx = w / 2;
  const cy = h / 2 + 8;
  const radius = Math.min(w, h) * 0.36;

  ctx.clearRect(0, 0, w, h);

  const axes = [
    'Sky Coverage',
    'Frequency Band',
    'Duty Cycle / Time',
    'Flux Sensitivity',
    'Polarisation / Mod.',
    'Artefact Persistence'
  ];

  [0.25, 0.5, 0.75, 1.0].forEach(level => {
    ctx.beginPath();
    axes.forEach((_, i) => {
      const ang = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
      const x = cx + Math.cos(ang) * radius * level;
      const y = cy + Math.sin(ang) * radius * level;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.strokeStyle = light ? 'rgba(15, 23, 42, 0.14)' : 'rgba(148, 163, 184, 0.18)';
    ctx.stroke();
  });

  ctx.font = '11px Inter, sans-serif';
  ctx.fillStyle = light ? '#334155' : '#cbd5e1';
  axes.forEach((label, i) => {
    const ang = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
    const x = cx + Math.cos(ang) * radius;
    const y = cy + Math.sin(ang) * radius;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.strokeStyle = light ? 'rgba(15, 23, 42, 0.18)' : 'rgba(148, 163, 184, 0.22)';
    ctx.stroke();

    const lx = cx + Math.cos(ang) * (radius + 22);
    const ly = cy + Math.sin(ang) * (radius + 18);
    ctx.textAlign = Math.cos(ang) > 0.2 ? 'left' : (Math.cos(ang) < -0.2 ? 'right' : 'center');
    ctx.fillText(label, lx, ly + 4);
  });

  const radioVals = [0.22, 0.18, 0.12, 0.28, 0.25, 0.15];
  const qNorm = Math.min(0.95, Math.max(0.15, (logQ + 6) / 6));
  const lNorm = Math.min(0.95, Math.max(0.15, (logL - 2) / 7));
  const sNorm = Math.min(0.95, Math.max(0.15, (logS + 4) / 4));
  const machineVals = [qNorm, 0.65 * qNorm + 0.2, sNorm, 0.7 * qNorm + 0.15, 0.55, lNorm];

  function drawPoly(vals, stroke, fill) {
    ctx.beginPath();
    vals.forEach((v, i) => {
      const ang = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
      const x = cx + Math.cos(ang) * radius * v;
      const y = cy + Math.sin(ang) * radius * v;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  drawPoly(radioVals, '#0284c7', 'rgba(56, 189, 248, 0.18)');
  drawPoly(machineVals, '#0d9488', 'rgba(45, 212, 191, 0.24)');
}

/* --- MODULE D: Interstellar Probe Propagation & Von Neumann Replication --- */
function initProbeSimulator() {
  const speedEl = document.getElementById('sl-probe-speed');
  const genEl = document.getElementById('sl-probe-gen');
  const stopEl = document.getElementById('sl-probe-stop');
  const canvas = document.getElementById('probe-canvas');
  if (!speedEl || !canvas) return;
  const ctx = canvas.getContext('2d');

  function update() {
    const vPct = parseFloat(speedEl.value);
    const gens = parseInt(genEl.value, 10);
    const stopYr = parseFloat(stopEl.value);

    document.getElementById('val-probe-speed').textContent = `${vPct.toFixed(1)}% c`;
    document.getElementById('val-probe-gen').textContent = `${gens} generations`;
    document.getElementById('val-probe-stop').textContent = `${stopYr.toFixed(0)} kyr`;

    const vFrac = vPct / 100;
    const t1000ly = 1000 / vFrac;
    const tGalaxy = (100000 / vFrac) + (gens * stopYr * 1000);
    const totalProbes = Math.pow(2, gens);

    document.getElementById('probe-1k-readout').textContent =
      t1000ly >= 1e6 ? `${(t1000ly / 1e6).toFixed(2)} Myr` : `${Math.round(t1000ly).toLocaleString()} yr`;
    document.getElementById('probe-gal-readout').textContent =
      `${(tGalaxy / 1e6).toFixed(2)} Myr`;
    document.getElementById('probe-count-readout').textContent =
      totalProbes >= 1e6 ? `${(totalProbes / 1e6).toFixed(2)}M` : totalProbes.toLocaleString();

    drawGalaxyWave(ctx, canvas, vPct, gens, tGalaxy);
  }

  [speedEl, genEl, stopEl].forEach(el => el.addEventListener('input', update));
  window.addEventListener('resize', update);
  update();
}

function drawGalaxyWave(ctx, canvas, vPct, gens, tGalaxy) {
  const light = isLightMode();
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const cx = w / 2;
  const cy = h / 2;
  const maxR = Math.min(w, h) * 0.42;

  ctx.clearRect(0, 0, w, h);

  const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, maxR);
  grad.addColorStop(0, 'rgba(245, 158, 11, 0.38)');
  grad.addColorStop(0.45, 'rgba(56, 189, 248, 0.14)');
  grad.addColorStop(1, 'rgba(11, 18, 34, 0.02)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
  ctx.fill();

  [0.25, 0.5, 0.75, 1.0].forEach((frac, idx) => {
    ctx.strokeStyle = light ? 'rgba(15, 23, 42, 0.15)' : 'rgba(148, 163, 184, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * frac, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = light ? '#475569' : '#64748b';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.fillText(`${(idx + 1) * 25}k ly`, cx + 6, cy - maxR * frac + 12);
  });

  const ox = cx - maxR * 0.35;
  const oy = cy + maxR * 0.15;
  const reachFrac = Math.min(1.35, (gens / 20) * (0.5 + vPct / 4));
  const waveR = maxR * reachFrac;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
  ctx.clip();

  const waveGrad = ctx.createRadialGradient(ox, oy, 2, ox, oy, waveR);
  waveGrad.addColorStop(0, 'rgba(20, 184, 166, 0.38)');
  waveGrad.addColorStop(0.8, 'rgba(20, 184, 166, 0.14)');
  waveGrad.addColorStop(1, 'rgba(20, 184, 166, 0.0)');
  ctx.fillStyle = waveGrad;
  ctx.beginPath();
  ctx.arc(ox, oy, waveR, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#14b8a6';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(ox, oy, waveR, 0, Math.PI * 2);
  ctx.stroke();

  const nodeCount = Math.min(140, Math.pow(2, Math.min(gens, 8)));
  for (let i = 0; i < nodeCount; i++) {
    const angle = i * 2.3999632;
    const dist = Math.sqrt((i + 1) / nodeCount) * waveR * 0.94;
    const nx = ox + Math.cos(angle) * dist;
    const ny = oy + Math.sin(angle) * dist;
    ctx.fillStyle = i === 0 ? '#f59e0b' : '#0d9488';
    ctx.beginPath();
    ctx.arc(nx, ny, i === 0 ? 5 : 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.fillStyle = light ? '#0f172a' : '#f8fafc';
  ctx.font = '11px JetBrains Mono, monospace';
  const mwCaption = w < 500
    ? `100k ly Traversal ≈ ${(tGalaxy / 1e6).toFixed(2)} Myr (${((tGalaxy / 13.8e9) * 100).toFixed(3)}% cosmic age)`
    : `Milky Way Disk (100,000 ly) · Full Traversal ≈ ${(tGalaxy / 1e6).toFixed(2)} Myr (${((tGalaxy / 13.8e9) * 100).toFixed(4)}% of cosmic age)`;
  ctx.fillText(mwCaption, 10, h - 10);
}

/* --- MODULE E: Bayesian Cover-Up Scrutiny Calculator --- */
function initBayesCoverupCalculator() {
  const priorEl = document.getElementById('sl-bayes-prior');
  const lrEl = document.getElementById('sl-bayes-lr');
  const canvas = document.getElementById('bayes-canvas');
  if (!priorEl || !canvas) return;
  const ctx = canvas.getContext('2d');

  function calcPosteriorPct(priorPct, lr) {
    const p = priorPct / 100;
    const oddsPrior = p / (1 - p);
    const oddsPost = oddsPrior * lr;
    return (oddsPost / (1 + oddsPost)) * 100;
  }

  function update() {
    const priorPct = parseFloat(priorEl.value);
    const logLR = parseFloat(lrEl.value);
    const lr = Math.pow(10, logLR);
    const postPct = calcPosteriorPct(priorPct, lr);

    document.getElementById('val-bayes-prior').textContent = `${priorPct.toFixed(2)}%`;
    document.getElementById('val-bayes-lr').textContent = `${lr >= 10 ? Math.round(lr).toLocaleString() : lr.toFixed(1)}×`;

    document.getElementById('bayes-prior-out').textContent = `${priorPct.toFixed(1)}%`;
    document.getElementById('bayes-lr-out').textContent = `${lr >= 10 ? Math.round(lr).toLocaleString() : lr.toFixed(1)}`;
    document.getElementById('bayes-post-out').textContent = `${postPct.toFixed(1)}%`;

    drawBayesCurve(ctx, canvas, priorPct, logLR, postPct, calcPosteriorPct);
  }

  [priorEl, lrEl].forEach(el => el.addEventListener('input', update));

  document.querySelectorAll('[data-lr-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      lrEl.value = btn.dataset.lrPreset;
      priorEl.value = btn.dataset.priorPreset || '1';
      document.querySelectorAll('[data-lr-preset]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      update();
    });
  });

  window.addEventListener('resize', update);
  update();
}

function drawBayesCurve(ctx, canvas, priorPct, currentLogLR, currentPostPct, calcPosteriorPct) {
  const light = isLightMode();
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const pad = { top: 24, right: 24, bottom: 40, left: 50 };
  const pw = w - pad.left - pad.right;
  const ph = h - pad.top - pad.bottom;

  ctx.clearRect(0, 0, w, h);

  const minLogLR = 0;
  const maxLogLR = 4;
  const xForLog = (l) => pad.left + ((l - minLogLR) / (maxLogLR - minLogLR)) * pw;
  const yForPct = (pct) => pad.top + ph - (pct / 100) * ph;

  ctx.strokeStyle = light ? 'rgba(15, 23, 42, 0.12)' : 'rgba(148, 163, 184, 0.15)';
  ctx.font = '11px JetBrains Mono, monospace';
  ctx.fillStyle = light ? '#475569' : '#94a3b8';

  [0, 25, 50, 75, 100].forEach(pct => {
    const y = yForPct(pct);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    ctx.fillText(`${pct}%`, 10, y + 4);
  });

  [0, 1, 2, 3, 4].forEach(l => {
    const x = xForLog(l);
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + ph);
    ctx.stroke();
    ctx.fillText(`LR=${Math.pow(10, l)}`, x - 22, h - 14);
  });

  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2.8;
  ctx.beginPath();
  for (let i = 0; i <= 160; i++) {
    const l = minLogLR + (i / 160) * (maxLogLR - minLogLR);
    const pct = calcPosteriorPct(priorPct, Math.pow(10, l));
    const x = xForLog(l);
    const y = yForPct(pct);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  const cx = xForLog(currentLogLR);
  const cy = yForPct(currentPostPct);
  ctx.fillStyle = '#14b8a6';
  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = light ? '#ffffff' : '#060a14';
  ctx.lineWidth = 2;
  ctx.stroke();
}

/* --- MODULE F: Section 11 Inference Impact Explorer --- */
function initInferenceExplorer() {
  const listEl = document.getElementById('inference-scenario-list');
  if (!listEl) return;

  function selectScenario(idx) {
    const sc = INFERENCE_SCENARIOS[idx];
    listEl.querySelectorAll('.scenario-btn').forEach((b, i) => b.classList.toggle('active', i === idx));
    document.getElementById('inf-bar-abio').style.width = `${sc.abio}%`;
    document.getElementById('inf-val-abio').textContent = `${sc.abio}%`;
    document.getElementById('inf-bar-eti').style.width = `${sc.eti}%`;
    document.getElementById('inf-val-eti').textContent = `${sc.eti}%`;
    document.getElementById('inf-bar-earth').style.width = `${sc.earth}%`;
    document.getElementById('inf-val-earth').textContent = `${sc.earth}%`;
    document.getElementById('inf-commentary').textContent = sc.commentary;
  }

  listEl.innerHTML = INFERENCE_SCENARIOS.map((sc, i) => `
    <button type="button" class="btn scenario-btn ${i === 2 ? 'btn-primary active' : ''}" data-idx="${i}" style="width:100%;justify-content:space-between;text-align:left;padding:0.75rem 1rem;margin-bottom:0.5rem;">
      <span>${sc.title}</span>
      <span class="brand-badge">${sc.tag}</span>
    </button>
  `).join('');

  listEl.querySelectorAll('.scenario-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      listEl.querySelectorAll('.scenario-btn').forEach(b => b.classList.remove('btn-primary'));
      btn.classList.add('btn-primary');
      selectScenario(Number(btn.dataset.idx));
    });
  });

  selectScenario(2);
}

/* --- MODULE G: 30 Primary Sources Search & Filter --- */
function initReferencesLibrary() {
  const grid = document.getElementById('references-grid');
  const searchInput = document.getElementById('ref-search');
  const countEl = document.getElementById('ref-count-badge');
  if (!grid) return;

  let activeCat = 'all';

  function render() {
    const q = (searchInput?.value || '').trim().toLowerCase();
    const filtered = REFERENCES.filter(r => {
      const matchCat = activeCat === 'all' || r.cat === activeCat;
      const matchQ = !q || r.title.toLowerCase().includes(q) || r.desc.toLowerCase().includes(q) || r.id.includes(q);
      return matchCat && matchQ;
    });

    if (countEl) countEl.textContent = `Showing ${filtered.length} of 30 sources`;

    grid.innerHTML = filtered.map(r => `
      <div class="ref-item">
        <span class="ref-num">[${r.id}]</span>
        <div class="ref-body">
          <div class="ref-title">${r.title}</div>
          <div style="color:var(--text-secondary);">${r.desc}</div>
          <div class="ref-meta">
            <span>${r.type}</span>
            <a href="${r.url}" target="_blank" rel="noopener noreferrer">Source / DOI ↗</a>
          </div>
        </div>
      </div>
    `).join('');
  }

  document.querySelectorAll('[data-ref-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeCat = btn.dataset.refCat;
      document.querySelectorAll('[data-ref-cat]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      render();
    });
  });

  searchInput?.addEventListener('input', render);
  render();
}
