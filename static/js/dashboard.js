'use strict';

// ── Global state ───────────────────────────────────────────
let lastResult   = null;
let chatHistory  = [];
let doctorMap    = null;
let doctorLayers = [];
let gaugeInst=null, compInst=null, trendInst=null, drvInst=null;
let sidebarOpen  = true;
let currentBookingHospital = '';

// ── Chart.js dark defaults ─────────────────────────────────
Chart.defaults.color        = '#9e9590';
Chart.defaults.borderColor  = 'rgba(255,255,255,0.06)';
Chart.defaults.font.family  = "'DM Mono', monospace";
Chart.defaults.font.size    = 11;

// ── NHANES cholesterol reference ───────────────────────────
const CHOL_REF = {
  '30-39': { male:{total:200,hdl:46}, female:{total:185,hdl:54} },
  '40-49': { male:{total:210,hdl:44}, female:{total:195,hdl:52} },
  '50-59': { male:{total:220,hdl:42}, female:{total:225,hdl:50} },
  '60-69': { male:{total:217,hdl:42}, female:{total:235,hdl:50} },
  '70+':   { male:{total:207,hdl:42}, female:{total:225,hdl:50} },
};

function getAgeGroup(a) {
  if (a < 30) return null;
  if (a < 40) return '30-39';
  if (a < 50) return '40-49';
  if (a < 60) return '50-59';
  if (a < 70) return '60-69';
  return '70+';
}

// ════════════════════════════════════════════════════════════
//  SIDEBAR CHAT TOGGLE
// ════════════════════════════════════════════════════════════
function toggleSidebar() {
  const sidebar = document.getElementById('chat-sidebar');
  sidebarOpen = !sidebarOpen;
  if (sidebarOpen) {
    sidebar.classList.remove('collapsed');
  } else {
    sidebar.classList.add('collapsed');
  }
  // Save preference
  try { localStorage.setItem('corvia_sidebar', sidebarOpen ? '1' : '0'); } catch(e) {}
}

// Restore sidebar state on load
(function() {
  try {
    const saved = localStorage.getItem('corvia_sidebar');
    if (saved === '0') {
      sidebarOpen = false;
      const sidebar = document.getElementById('chat-sidebar');
      if (sidebar) sidebar.classList.add('collapsed');
    }
  } catch(e) {}
})();

// ── Section navigation ─────────────────────────────────────
function switchSection(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.remove('active');
    b.removeAttribute('aria-current');
  });
  const sec = document.getElementById(id);
  const btn = document.querySelector('[data-section="' + id + '"]');
  if (sec) sec.classList.add('active');
  if (btn) { btn.classList.add('active'); btn.setAttribute('aria-current', 'page'); }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchSection(btn.dataset.section));
});

// ── Cholesterol toggle ─────────────────────────────────────
const pillManual   = document.getElementById('pill-manual');
const pillEstimate = document.getElementById('pill-estimate');
const cholManual   = document.getElementById('chol-manual');
const cholEstimate = document.getElementById('chol-estimate');

function updateCholMode() {
  const manual = document.querySelector('input[name="chol_method"]:checked')?.value === 'manual';
  cholManual.style.display   = manual ? 'grid' : 'none';
  cholEstimate.style.display = manual ? 'none' : 'block';
  pillManual.classList.toggle('active', manual);
  pillEstimate.classList.toggle('active', !manual);
  if (!manual) refreshEstimate();
}

pillManual.addEventListener('click', () => {
  pillManual.querySelector('input').checked = true;
  updateCholMode();
});
pillEstimate.addEventListener('click', () => {
  pillEstimate.querySelector('input').checked = true;
  updateCholMode();
});

function refreshEstimate() {
  const age = parseInt(document.getElementById('age').value) || 52;
  const sex = document.getElementById('sex').value;
  const ag  = getAgeGroup(age);
  const el  = document.getElementById('estimate-text');
  if (!ag) { el.textContent = 'Manual entry required for age < 30.'; return; }
  const r = CHOL_REF[ag][sex];
  el.textContent = 'Total: ' + r.total + ' mg/dL  HDL: ' + r.hdl + ' mg/dL  (NHANES avg - ' + ag + ' ' + sex + ')';
}

document.getElementById('age').addEventListener('input', () => {
  const age = parseInt(document.getElementById('age').value) || 0;
  document.getElementById('young-notice').style.display = (age > 0 && age < 30) ? 'flex' : 'none';
  refreshEstimate();
});
document.getElementById('sex').addEventListener('change', refreshEstimate);
refreshEstimate();

// ── CSV Upload — column names match Streamlit safe_col_mean exactly ──
const CSV_COL_MAP = {
  steps:    ['Step count',            'step_count',        'steps',            'Steps'],
  move_min: ['Move Minutes count',    'move_minutes',      'Move Minutes'],
  calories: ['Calories (kcal)',       'calories',          'Calories'],
  distance: ['Distance (m)',          'distance',          'Distance'],
  hp:       ['Heart Points',          'heart_points'],
  hm:       ['Heart Minutes',         'heart_minutes'],
  avg_spd:  ['Average speed (m/s)',   'walking_speed',     'Average speed'],
  max_spd:  ['Max speed (m/s)',       'max_speed',         'Max speed'],
  min_spd:  ['Min speed (m/s)',       'min_speed',         'Min speed'],
  avg_wt:   ['Average weight (kg)',   'weight',            'Average weight'],
  max_wt:   ['Max weight (kg)',       'max_weight',        'Max weight'],
  min_wt:   ['Min weight (kg)',       'min_weight',        'Min weight'],
  walk_dur: ['Walking duration (ms)', 'walking_duration',  'Walking duration'],
};

function colMean(rows, headers, names) {
  const lc = headers.map(h => h.toLowerCase().trim());
  for (const n of names) {
    const idx = lc.indexOf(n.toLowerCase().trim());
    if (idx === -1) continue;
    const vals = rows.map(r => parseFloat(r[idx])).filter(v => !isNaN(v));
    if (vals.length) return vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  return null;
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error('CSV has no data rows');
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
  const rows    = lines.slice(1).map(l => l.split(',').map(c => c.replace(/^"|"$/g, '').trim()));
  return { headers, rows };
}

function applyCSV(file) {
  const stat = document.getElementById('csv-status');
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const { headers, rows } = parseCSV(e.target.result);
      let applied = 0;
      for (const [field, names] of Object.entries(CSV_COL_MAP)) {
        const val = colMean(rows, headers, names);
        if (val !== null) {
          const el = document.getElementById(field);
          if (el) { el.value = parseFloat(val.toFixed(2)); applied++; }
        }
      }
      stat.style.display = 'block';
      stat.className     = 'csv-status ok';
      stat.textContent   = '+ ' + file.name + ' loaded - ' + applied + ' of 13 fields filled';
    } catch (err) {
      stat.style.display = 'block';
      stat.className     = 'csv-status err';
      stat.textContent   = 'CSV error: ' + err.message;
    }
  };
  reader.readAsText(file);
}

document.getElementById('csv-file').addEventListener('change', e => {
  if (e.target.files[0]) applyCSV(e.target.files[0]);
});

const dropZone = document.getElementById('csv-drop');
dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', ()  => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.name.endsWith('.csv')) {
    applyCSV(file);
  } else {
    const stat = document.getElementById('csv-status');
    stat.style.display = 'block';
    stat.className     = 'csv-status err';
    stat.textContent   = 'Please drop a .csv file';
  }
});

// ── Safe float read ────────────────────────────────────────
function fv(id) { return parseFloat(document.getElementById(id)?.value) || 0; }

// ── Form submit ────────────────────────────────────────────
document.getElementById('assess-form').addEventListener('submit', async e => {
  e.preventDefault();

  const btn   = document.getElementById('calc-btn');
  const label = document.getElementById('calc-label');
  const icon  = document.getElementById('calc-icon');
  const spin  = document.getElementById('calc-spinner');

  btn.disabled       = true;
  label.textContent  = 'Calculating...';
  icon.style.display = 'none';
  spin.style.display = 'inline-block';

  const sex    = document.getElementById('sex').value;
  const age    = parseInt(document.getElementById('age').value) || 52;
  const ag     = getAgeGroup(age);
  const manual = document.querySelector('input[name="chol_method"]:checked')?.value === 'manual';

  let totalChol = 210, hdlChol = 44;
  if (manual) {
    totalChol = parseInt(document.getElementById('total_chol').value) || 210;
    hdlChol   = parseInt(document.getElementById('hdl_chol').value)   || 44;
  } else if (ag) {
    totalChol = CHOL_REF[ag][sex].total;
    hdlChol   = CHOL_REF[ag][sex].hdl;
  }

  const payload = {
    age, sex,
    total_chol: totalChol,
    hdl_chol:   hdlChol,
    sys_bp:     parseInt(document.getElementById('sys_bp').value) || 135,
    dia_bp:     parseInt(document.getElementById('dia_bp').value) || 85,
    on_med:     document.getElementById('on_med').value,
    diabetes:   document.getElementById('diabetes').value,
    smoker:     document.getElementById('smoker').value,
    steps:    fv('steps'),    move_min: fv('move_min'),
    calories: fv('calories'), distance: fv('distance'),
    hp:       fv('hp'),       hm:       fv('hm'),
    avg_spd:  fv('avg_spd'),  max_spd:  fv('max_spd'),
    min_spd:  fv('min_spd'),  avg_wt:   fv('avg_wt'),
    max_wt:   fv('max_wt'),   min_wt:   fv('min_wt'),
    walk_dur: fv('walk_dur'),
  };

  try {
    const res  = await fetch('/api/predict', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    });
    const data = await res.json();
    lastResult = Object.assign({}, data, payload, { total_chol: totalChol, hdl_chol: hdlChol });
    switchSection('results');
    renderResults(lastResult);
  } catch (err) {
    alert('Calculation failed: ' + err.message);
  } finally {
    btn.disabled       = false;
    label.textContent  = 'Calculate my heart risk';
    icon.style.display = 'inline';
    spin.style.display = 'none';
  }
});

// ── Risk colours ───────────────────────────────────────────
const RISK_COLORS = { low:'#4caf50', borderline:'#ffb300', intermediate:'#ff6d00', high:'#d32f2f' };

function animateNum(id, from, to, decimals, suffix, dur) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = performance.now();
  (function tick(now) {
    const t = Math.min((now - start) / dur, 1);
    const e = 1 - Math.pow(1 - t, 4);
    el.textContent = (from + (to - from) * e).toFixed(decimals) + suffix;
    if (t < 1) requestAnimationFrame(tick);
  })(start);
}

// ── Render results ─────────────────────────────────────────
function renderResults(d) {
  document.getElementById('no-results').style.display      = 'none';
  document.getElementById('results-content').style.display = 'block';

  const color = RISK_COLORS[d.cat_key] || '#d32f2f';

  animateNum('sb-score', 0, d.risk, 1, '%', 1200);
  document.getElementById('sb-category').textContent  = d.category;
  document.getElementById('sb-category').style.color  = color;
  document.getElementById('sbm-baseline').textContent = d.baseline + '%';
  document.getElementById('sbm-proj').textContent     = (d.risk * 0.5).toFixed(1) + '%';

  const diff = d.risk - d.baseline;
  const de   = document.getElementById('sbm-diff');
  de.textContent = (diff >= 0 ? 'up ' : 'down ') + Math.abs(diff).toFixed(1) + '%';
  de.style.color = diff >= 0 ? '#d32f2f' : '#4caf50';

  document.getElementById('score-band').style.borderColor = color + '40';

  const catMap = { low:'seg-low', borderline:'seg-bord', intermediate:'seg-inter', high:'seg-high' };
  document.querySelectorAll('.aha-seg').forEach(s => s.classList.remove('active-seg'));
  if (catMap[d.cat_key]) document.getElementById(catMap[d.cat_key]).classList.add('active-seg');

  drawGauge(d.risk, color);
  drawComp(d.risk, d.baseline);
  drawTrend(d.risk);
  drawDrivers(d.drivers);
  renderRecs(d.doing_well, d.improve, d.critical);
  renderPlan(d.plan, d.risk);
  localStorage.setItem('latest_corvia_result', JSON.stringify(d));
}
function loadSavedResult() {
  const saved = localStorage.getItem('latest_corvia_result');
  if (saved) {
    const data = JSON.parse(saved);
    lastResult = data;
    renderResults(data);
  }
}
function drawGauge(risk, color) {
  const ctx = document.getElementById('gaugeChart').getContext('2d');
  if (gaugeInst) gaugeInst.destroy();
  gaugeInst = new Chart(ctx, {
    type: 'doughnut',
    data: { datasets: [{ data:[risk, Math.max(0,30-risk)], backgroundColor:[color,'rgba(255,255,255,0.05)'], borderWidth:0, circumference:180, rotation:270 }] },
    options: { cutout:'76%', plugins:{legend:{display:false},tooltip:{enabled:false}}, responsive:false, animation:{animateRotate:true,duration:1200,easing:'easeOutQuart'} }
  });
}

function drawComp(risk, baseline) {
  const ctx = document.getElementById('compBar').getContext('2d');
  if (compInst) compInst.destroy();
  compInst = new Chart(ctx, {
    type: 'bar',
    data: { labels:['Your risk','Peer avg'], datasets:[{ data:[risk,baseline], backgroundColor:['rgba(211,47,47,0.8)','rgba(158,149,144,0.4)'], borderColor:['rgba(211,47,47,1)','rgba(158,149,144,0.6)'], borderWidth:1, borderRadius:6, barThickness:44 }] },
    options: {
      plugins: { legend:{display:false}, tooltip:{callbacks:{label:c=>c.parsed.y.toFixed(1)+'%'}} },
      scales: {
        y: { title:{display:true,text:'10-yr risk (%)'}, suggestedMax:Math.max(risk,baseline)*1.5, grid:{color:'rgba(255,255,255,0.04)'}, ticks:{color:'#534e4a'} },
        x: { grid:{display:false}, ticks:{color:'#9e9590'} }
      },
      animation: { duration:1000, easing:'easeOutQuart' }
    }
  });
}

function drawTrend(risk) {
  const ctx    = document.getElementById('trendLine').getContext('2d');
  if (trendInst) trendInst.destroy();
  const labels = ['Now','+3 mo','+6 mo','+1 yr','+5 yr','+10 yr'];
  const proj   = [1,0.93,0.87,0.80,0.65,0.50].map(f => parseFloat((risk*f).toFixed(1)));
  trendInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label:'No change', data:labels.map(()=>risk), borderColor:'rgba(211,47,47,0.35)', borderDash:[5,5], pointRadius:0, tension:0, borderWidth:1.5 },
        { label:'With plan', data:proj, borderColor:'#d32f2f', backgroundColor:'rgba(211,47,47,0.08)', fill:true, pointBackgroundColor:'#d32f2f', pointBorderColor:'#0f0c10', pointBorderWidth:2, pointRadius:4, tension:0.35, borderWidth:2 }
      ]
    },
    options: {
      plugins: { legend:{position:'top',labels:{color:'#9e9590',boxWidth:10,padding:14,usePointStyle:true}} },
      scales: {
        y: { title:{display:true,text:'10-yr risk (%)'}, suggestedMax:risk*1.15, grid:{color:'rgba(255,255,255,0.04)'}, ticks:{color:'#534e4a'} },
        x: { grid:{display:false}, ticks:{color:'#9e9590'} }
      },
      animation: { duration:1200, easing:'easeOutQuart' }
    }
  });
}

function drawDrivers(drivers) {
  const ctx    = document.getElementById('driversBar').getContext('2d');
  if (drvInst) drvInst.destroy();
  drvInst = new Chart(ctx, {
    type: 'bar',
    data: { labels:Object.keys(drivers), datasets:[{ data:Object.values(drivers), backgroundColor:['rgba(83,78,74,0.7)','rgba(255,109,0,0.7)','rgba(255,179,0,0.7)','rgba(211,47,47,0.8)'], borderRadius:5, barThickness:26 }] },
    options: {
      indexAxis: 'y',
      plugins: { legend:{display:false}, tooltip:{callbacks:{label:c=>c.parsed.x.toFixed(1)+'% contribution'}} },
      scales: {
        x: { title:{display:true,text:'Contribution (%)'}, max:60, grid:{color:'rgba(255,255,255,0.04)'}, ticks:{color:'#534e4a'} },
        y: { grid:{display:false}, ticks:{color:'#9e9590'} }
      },
      animation: { duration:1000, easing:'easeOutQuart' }
    }
  });
}

function renderRecs(doing_well, improve, critical) {
  // ── Doing Well (green) ──────────────────────────────────
  document.getElementById('doing-well-list').innerHTML =
    (doing_well || []).map(i => '<li>✅ ' + i + '</li>').join('');

  // ── Areas for Improvement (yellow) ──────────────────────
  document.getElementById('recs-list').innerHTML =
    (improve || []).map(i => '<li>' + i + '</li>').join('');

  // ── Critical Actions (red) ───────────────────────────────
  document.getElementById('critical-list').innerHTML =
    (critical || []).map(i => '<li>' + i + '</li>').join('');
}

function renderPlan(plan, risk) {
  // Tier label — exact same wording as Streamlit
  let tierNote = '';
  if      (risk < 5)   tierNote = '🟢 Low Risk plan — focus on lifestyle maintenance and prevention.';
  else if (risk < 7.5) tierNote = '🟡 Borderline Risk plan — assessment, diet optimisation & possible statin discussion.';
  else if (risk < 20)  tierNote = '🟠 Intermediate Risk plan — statin therapy initiation, structured exercise & monitoring.';
  else                 tierNote = '🔴 High Risk plan — immediate high-intensity statin, cardiac rehabilitation & strict monitoring.';

  document.getElementById('plan-tier-label').textContent = tierNote;

  // Roadmap cards — exact same full descriptions as Streamlit
  const planData = getPlanData(risk);
  document.getElementById('roadmap').innerHTML = planData.map(p =>
    '<div class="rm-card">' +
      '<div class="rm-phase">' + p.phase + '</div>' +
      '<div class="rm-title">' + p.title + '</div>' +
      '<div class="rm-desc">'  + p.desc  + '</div>' +
    '</div>'
  ).join('');
}

function getPlanData(risk) {
  if (risk < 5) return [
    {
      phase: 'Phase 1 · Months 1–2',
      title: '🏃 Lifestyle Foundation',
      desc:  'Maintain 150–300 min/week moderate physical activity · Adhere to Mediterranean/DASH diet · Ensure 7–9 hours quality sleep nightly · Track BP monthly; check lipids every 4–6 years.',
    },
    {
      phase: 'Phase 2 · Months 3–4',
      title: '⚡ Optimisation',
      desc:  'Increase activity to 300 min/week if possible · Add resistance training 2×/week · Limit sodium <2,300 mg/day; saturated fat <10% of calories.',
    },
    {
      phase: 'Phase 3 · Months 5–6',
      title: '🔄 Long-term Maintenance',
      desc:  'Establish sustainable healthy routine · Annual health check-up · Continue monitoring BP, weight & waist circumference.',
    },
  ];
  if (risk < 7.5) return [
    {
      phase: 'Phase 1 · Months 1–2',
      title: '🩺 Assessment & Foundation',
      desc:  'Baseline lipid panel, BP & weight · Initiate 150 min/week moderate activity · Adopt Mediterranean diet; reduce saturated fat <6% calories · If LDL-C ≥160 mg/dL or risk enhancers present, initiate moderate-intensity statin.',
    },
    {
      phase: 'Phase 2 · Months 3–4',
      title: '📈 Intensification',
      desc:  'Increase activity to 200–300 min/week · Recheck lipid panel (if on statin, at 4–8 weeks) · Aim for LDL-C <100 mg/dL; BP <130/80 mmHg · If risk discussion uncertain, consider CAC scoring.',
    },
    {
      phase: 'Phase 3 · Months 5–6',
      title: '🎯 Optimisation',
      desc:  'If LDL-C not at goal, consider intensifying statin or adding ezetimibe · Reassess 10-year risk · Establish 6-month follow-up schedule with your doctor.',
    },
  ];
  if (risk < 20) return [
    {
      phase: 'Phase 1 · Months 1–2',
      title: '💊 Initiate Therapy',
      desc:  'Baseline lipids, BP, HbA1c & weight · Initiate moderate- to high-intensity statin (target LDL-C reduction 30–49% or ≥50%) · Start structured exercise program (150 min/week + resistance 2×/week) · Mediterranean/DASH diet; sodium <2,300 mg/day.',
    },
    {
      phase: 'Phase 2 · Months 3–4',
      title: '🔬 Monitor & Adjust',
      desc:  'Recheck LDL-C at 4–8 weeks; adjust statin intensity if needed · Increase activity to 200–300 min/week · Target LDL-C <100 mg/dL; if LDL-C ≥70 mg/dL on maximally tolerated statin, consider adding ezetimibe · BP goal <130/80 mmHg.',
    },
    {
      phase: 'Phase 3 · Months 5–6',
      title: '🎯 Optimisation',
      desc:  'If LDL-C remains ≥70 mg/dL, consider PCSK9 inhibitor for very high-risk features · Reassess 10-year risk · Develop long-term maintenance plan with 3–6 month follow-up.',
    },
  ];
  return [
    {
      phase: 'Phase 1 · Months 1–2',
      title: '🚨 Immediate Intervention',
      desc:  'Comprehensive baseline panel (lipids, HbA1c, creatinine, LFTs) · Initiate high-intensity statin immediately (atorvastatin 40–80 mg or rosuvastatin 20–40 mg) · Start cardiac rehabilitation or supervised exercise · Strict Mediterranean/DASH diet; sodium <1,500 mg/day if hypertensive.',
    },
    {
      phase: 'Phase 2 · Months 3–4',
      title: '⚡ Intensify & Monitor',
      desc:  'Recheck LDL-C at 4–8 weeks; target LDL-C <70 mg/dL · If LDL-C ≥70 mg/dL, add ezetimibe · Achieve BP <130/80 mmHg · HbA1c <7% if diabetic.',
    },
    {
      phase: 'Phase 3 · Months 5–6',
      title: '🎯 Optimisation',
      desc:  'If LDL-C <70 mg/dL achieved, continue current therapy · If very high risk (multiple ASCVD events), consider LDL-C <55 mg/dL goal · Reassess 10-year risk · Transition to long-term management with 3-month follow-up.',
    },
  ];
}

document.querySelectorAll('.rtab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.rtab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.rtab-pane').forEach(p => p.style.display = 'none');
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).style.display = 'block';
    if (tab.dataset.tab === 'drivers' && lastResult) drawDrivers(lastResult.drivers);
  });
});

// ════════════════════════════════════════════════════════════
//  DOCTOR FINDER
// ════════════════════════════════════════════════════════════
document.getElementById('find-btn').addEventListener('click', findDoctors);
document.getElementById('pincode').addEventListener('keydown', e => { if (e.key === 'Enter') findDoctors(); });

async function findDoctors() {
  const pin  = document.getElementById('pincode').value.trim();
  const type = document.getElementById('place-type').value;
  const spec = document.getElementById('specialty').value.trim();
  const stat = document.getElementById('doctor-status');
  const area = document.getElementById('doctor-area');

  stat.style.display = 'block';
  setStatus(stat, 'searching', 'Searching...');
  area.style.display = 'none';

  try {
    const res  = await fetch('/api/doctors', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pincode:pin,place_type:type,specialty:spec}) });
    const data = await res.json();

    if (data.error) { setStatus(stat, 'error', 'Error: ' + data.error); return; }
    setStatus(stat, 'success', 'Found ' + data.results.length + ' places near ' + data.area + ' (' + data.pincode + ')');
    if (!data.results.length) return;
    area.style.display = 'block';

    if (!doctorMap) {
      doctorMap = L.map('doctor-map', { zoomControl:true }).setView([+data.user_lat, +data.user_lon], 14);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution:'Map data OpenStreetMap / CARTO', maxZoom:20 }).addTo(doctorMap);
    } else {
      doctorMap.setView([+data.user_lat, +data.user_lon], 14);
      doctorLayers.forEach(l => l.remove());
      doctorLayers = [];
    }

    const uM = L.marker([+data.user_lat, +data.user_lon], {
      icon: L.divIcon({ className:'', iconSize:[34,34], iconAnchor:[17,17],
        html:'<div style="width:34px;height:34px;border-radius:50%;background:#4caf50;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:white;box-shadow:0 4px 16px rgba(76,175,80,0.5);">YOU</div>'
      })
    }).addTo(doctorMap).bindPopup('<b>Your location</b>');
    doctorLayers.push(uM);

    document.getElementById('doctor-list').innerHTML = '';
    data.results.forEach((r, i) => {
      const nearest = i === 0;
      const bg = nearest ? 'rgba(211,47,47,0.9)' : 'rgba(50,45,50,0.9)';
      const m  = L.marker([+r.lat, +r.lon], {
        icon: L.divIcon({ className:'', iconSize:[30,30], iconAnchor:[15,15],
          html:'<div style="width:30px;height:30px;border-radius:50%;background:' + bg + ';display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:white;font-family:monospace;box-shadow:0 3px 12px rgba(0,0,0,0.4);">' + (i+1) + '</div>'
        })
      }).addTo(doctorMap);
      m.bindPopup('<b>' + r.name + '</b><br>' + r.specialty + '<br>' + r.distance_km + ' km' + (r.phone ? '<br>' + r.phone : ''));
      doctorLayers.push(m);

      document.getElementById('doctor-list').innerHTML +=
        '<div class="doc-card' + (nearest ? ' nearest' : '') + '">' +
          '<div class="doc-badge">' + (nearest ? 'Nearest' : '#' + (i+1)) + '</div>' +
          '<div class="doc-name">'  + r.name     + '</div>' +
          '<div class="doc-spec">'  + r.specialty + '</div>' +
          '<div class="doc-dist">  ' + r.distance_km + ' km away</div>' +
          (r.phone  ? '<div class="doc-contact">Tel: ' + r.phone + '</div>' : '') +
          (r.website? '<div class="doc-contact"><a href="' + r.website + '" target="_blank" rel="noopener">Website</a></div>' : '') +
          '<button class="doc-book-btn" onclick="openBookModal(\'' + escapeSQ(r.name) + '\', \'' + escapeSQ(r.specialty) + '\')">Book Appointment</button>' +
        '</div>';
    });
  } catch (err) {
    setStatus(stat, 'error', 'Error: ' + err.message);
  }
}

function escapeSQ(str) {
  return String(str).replace(/'/g, "\\'");
}

function setStatus(el, type, msg) {
  const s = {
    searching: { bg:'rgba(255,179,0,0.06)',  border:'rgba(255,179,0,0.2)',  color:'#ffb300' },
    success:   { bg:'rgba(76,175,80,0.06)',   border:'rgba(76,175,80,0.2)', color:'#4caf50' },
    error:     { bg:'rgba(211,47,47,0.06)',   border:'rgba(211,47,47,0.2)', color:'#ef5350' },
  }[type];
  el.style.cssText = 'display:block;padding:.75rem 1.1rem;border-radius:12px;font-size:.84rem;background:' + s.bg + ';border:1px solid ' + s.border + ';color:' + s.color + ';margin-bottom:1.2rem;';
  el.textContent = msg;
}

// ════════════════════════════════════════════════════════════
//  BOOKING MODAL
// ════════════════════════════════════════════════════════════
function openBookModal(hospitalName, specialty) {
  currentBookingHospital = hospitalName;
  document.getElementById('modal-hospital-name').textContent = '🏥 ' + hospitalName;
  document.getElementById('modal-pat-name').value  = '';
  document.getElementById('modal-pat-phone').value = '';
  document.getElementById('modal-pat-date').value  = '';
  document.getElementById('modal-pat-time').value  = '';
  document.getElementById('modal-pat-spec').value  = specialty || '';
  document.getElementById('modal-confirm').style.display = 'none';
  document.getElementById('modal-submit-label').style.display = '';
  document.getElementById('modal-submit-spinner').style.display = 'none';
  // Reset form visibility
  document.querySelectorAll('#book-modal .field-row, #book-modal .field, .modal-actions').forEach(el => el.style.display = '');
  document.getElementById('modal-hospital-name').style.display = 'block';

  document.getElementById('book-modal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeBookModal() {
  document.getElementById('book-modal').style.display = 'none';
  document.body.style.overflow = '';
}

async function submitBooking() {
  const name    = document.getElementById('modal-pat-name').value.trim();
  const phone   = document.getElementById('modal-pat-phone').value.trim();
  const date    = document.getElementById('modal-pat-date').value;
  const time    = document.getElementById('modal-pat-time').value;
  const spec    = document.getElementById('modal-pat-spec').value.trim();

  if (!name || !phone || !date) {
    alert('Please fill in your name, phone, and preferred date.');
    return;
  }

  const label  = document.getElementById('modal-submit-label');
  const spinner= document.getElementById('modal-submit-spinner');
  label.style.display   = 'none';
  spinner.style.display = 'inline-block';

  try {
    const res  = await fetch('/api/book_appointment', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patient_name:  name,
        hospital_name: currentBookingHospital,
        specialty:     spec,
        date:          date,
        time:          time,
        phone:         phone,
      })
    });
    const data = await res.json();

    // Hide form fields, show confirmation
    document.querySelectorAll('#book-modal .field-row, #book-modal .field, .modal-hospital-name, .modal-actions').forEach(el => el.style.display = 'none');
    const confirm = document.getElementById('modal-confirm');
    document.getElementById('confirm-sub').textContent =
      'Your request for ' + currentBookingHospital + ' on ' + date + (time ? ' at ' + time : '') + ' has been saved. They will confirm your booking shortly.';
    confirm.style.display = 'block';

    setTimeout(closeBookModal, 3800);
  } catch (err) {
    alert('Booking failed: ' + err.message);
    label.style.display   = '';
    spinner.style.display = 'none';
  }
}

// Close modal on overlay click
document.getElementById('book-modal').addEventListener('click', function(e) {
  if (e.target === this) closeBookModal();
});

// ════════════════════════════════════════════════════════════
//  REGISTER HOSPITAL MODAL
// ════════════════════════════════════════════════════════════
function openRegisterModal() {
  ['reg-name','reg-zip','reg-addr','reg-spec','reg-doctor','reg-phone','reg-website','reg-email'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('reg-confirm').style.display = 'none';
  document.getElementById('reg-submit-label').style.display = '';
  document.getElementById('reg-submit-spinner').style.display = 'none';
  document.querySelectorAll('#register-modal .field-row, #register-modal .field, #register-modal .modal-actions, .modal-desc').forEach(el => el.style.display = '');
  document.getElementById('register-modal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeRegisterModal() {
  document.getElementById('register-modal').style.display = 'none';
  document.body.style.overflow = '';
}

async function submitRegisterHospital() {
  const name  = document.getElementById('reg-name').value.trim();
  const zip   = document.getElementById('reg-zip').value.trim();
  const addr  = document.getElementById('reg-addr').value.trim();
  const spec  = document.getElementById('reg-spec').value.trim();
  const phone = document.getElementById('reg-phone').value.trim();

  if (!name || !zip || !addr || !spec || !phone) {
    alert('Please fill in all required fields (*).');
    return;
  }

  const label  = document.getElementById('reg-submit-label');
  const spinner= document.getElementById('reg-submit-spinner');
  label.style.display   = 'none';
  spinner.style.display = 'inline-block';

  try {
    await fetch('/api/register_hospital', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        zipcode: zip,
        address: addr,
        specialty: spec,
        doctor: document.getElementById('reg-doctor').value.trim(),
        phone,
        website: document.getElementById('reg-website').value.trim(),
        email:   document.getElementById('reg-email').value.trim(),
      })
    });

    document.querySelectorAll('#register-modal .field-row, #register-modal .field, #register-modal .modal-actions, .modal-desc').forEach(el => el.style.display = 'none');
    document.getElementById('reg-confirm').style.display = 'block';
    setTimeout(closeRegisterModal, 4000);
  } catch (err) {
    alert('Registration failed: ' + err.message);
    label.style.display   = '';
    spinner.style.display = 'none';
  }
}

document.getElementById('register-modal').addEventListener('click', function(e) {
  if (e.target === this) closeRegisterModal();
});

// Keyboard: Escape closes modals
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeBookModal();
    closeRegisterModal();
  }
});

// ════════════════════════════════════════════════════════════
//  AI CHAT (sidebar)
// ════════════════════════════════════════════════════════════
async function sendChat() {
  const input = document.getElementById('chat-input');
  const text  = input.value.trim();
  if (!text) return;
  input.value = '';
  document.getElementById('chat-welcome')?.remove();
  addMsg('user', text);
  addTyping();

  const ctx = lastResult ? {
    age:lastResult.age, sex:lastResult.sex, risk:lastResult.risk,
    category:lastResult.category, sys_bp:lastResult.sys_bp,
    total_chol:lastResult.total_chol, hdl_chol:lastResult.hdl_chol,
    steps:lastResult.steps, smoker:lastResult.smoker, diabetes:lastResult.diabetes,
  } : null;

  try {
    const res  = await fetch('/api/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({message:text,history:chatHistory,result:ctx}) });
    const data = await res.json();
    removeTyping();
    addMsg('bot', data.reply);
    chatHistory.push({ user:text, assistant:data.reply });
  } catch {
    removeTyping();
    addMsg('bot', 'Connection error. Please try again.');
  }
}

function sendQuick(t) { document.getElementById('chat-input').value = t; sendChat(); }

function addMsg(role, text) {
  const box = document.getElementById('chat-messages');
  const d   = document.createElement('div');
  d.className = 'chat-msg ' + role;
  const safe  = text.replace(/\n/g,'<br>').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\*(.*?)\*/g,'<em>$1</em>');
  d.innerHTML = '<div class="chat-sender">' + (role==='user'?'You':'CorVia AI') + '</div><div class="chat-bubble">' + safe + '</div>';
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
}

function addTyping() {
  const box = document.getElementById('chat-messages');
  const d   = document.createElement('div');
  d.className = 'chat-msg bot'; d.id = 'chat-typing';
  d.innerHTML = '<div class="chat-sender">CorVia AI</div><div class="chat-bubble typing-bubble"><span></span><span></span><span></span></div>';
  box.appendChild(d); box.scrollTop = box.scrollHeight;
}

function removeTyping() { document.getElementById('chat-typing')?.remove(); }

function clearChat() {
  chatHistory = [];
  document.getElementById('chat-messages').innerHTML =
    '<div class="chat-welcome" id="chat-welcome">' +
      '<div class="cw-pulse"><div class="cwp-ring cwp-ring1"></div><div class="cwp-ring cwp-ring2"></div><div class="cw-icon">🤖</div></div>' +
      '<div class="cw-title">CorVia AI ready</div>' +
      '<div class="cw-sub">Ask about your risk score, medications, diet, lifestyle, or anything cardiovascular.</div>' +
      '<div class="quick-grid">' +
        '<button class="qp" onclick="sendQuick(\'What does my risk score mean?\')">What does my score mean?</button>' +
        '<button class="qp" onclick="sendQuick(\'Give me a 6-month plan to reduce my risk\')">6-month plan</button>' +
        '<button class="qp" onclick="sendQuick(\'How can I lower my cholesterol?\')">Lower cholesterol</button>' +
        '<button class="qp" onclick="sendQuick(\'Best lifestyle changes for heart health?\')">Lifestyle changes</button>' +
      '</div>' +
    '</div>';
}

// ════════════════════════════════════════════════════════════
//  HOSPITAL MANAGEMENT (existing section)
// ════════════════════════════════════════════════════════════
async function registerHospital() {
  const res = await fetch('/api/register_hospital', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      name:     document.getElementById('hosp_name').value,
      zipcode:  document.getElementById('hosp_zip').value,
      address:  document.getElementById('hosp_addr').value,
      specialty:document.getElementById('hosp_spec').value,
      phone:    document.getElementById('hosp_phone').value,
      email:    document.getElementById('hosp_email').value,
    })
  });
  const data = await res.json();
  alert(data.message || 'Hospital Registered');
}

async function bookAppointment() {
  const res = await fetch('/api/book_appointment', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      patient_name:  document.getElementById('pat_name').value,
      hospital_name: document.getElementById('pat_hospital').value,
      specialty:     document.getElementById('pat_spec').value,
      date:          document.getElementById('pat_date').value,
      time:          document.getElementById('pat_time').value,
      phone:         document.getElementById('pat_phone').value,
    })
  });
  const data = await res.json();
  alert(data.message || 'Appointment Booked');
}

async function viewAppointments() {
  const res  = await fetch('/api/view_appointments');
  const data = await res.json();
  let html = '';
  data.appointments.forEach(a => {
    html += '<div style="padding:.65rem .85rem;border:1px solid rgba(255,255,255,0.07);border-radius:10px;margin-top:.6rem;font-size:.82rem;color:#9e9590;">' +
      '<strong style="color:#f0ebe4;">' + a.patient_name + '</strong> → ' + a.hospital +
      '<br><span style="font-family:monospace;font-size:.7rem;">' + a.date + (a.time ? ' · ' + a.time : '') + ' · ' + a.specialty + '</span>' +
      '</div>';
  });
  document.getElementById('appointment-results').innerHTML = html || '<p style="color:#534e4a;font-size:.82rem;margin-top:.6rem;">No appointments found.</p>';
}
async function downloadResultPDF() {
    console.log("PDF Generation Triggered...");

    let jsPDFInstance;
    if (window.jspdf && window.jspdf.jsPDF) {
        jsPDFInstance = window.jspdf.jsPDF;
    } else {
        alert("PDF Library not found. Ensure script tags are in the correct order.");
        return;
    }

    if (!lastResult) {
        alert("No clinical data found. Please complete the assessment first.");
        return;
    }

    try {
        // Initialize doc
        const doc = new jsPDFInstance();
        
        // IMPORTANT: If using CDN, we sometimes need to ensure the plugin is attached
        if (typeof doc.autoTable !== 'function') {
            console.error("AutoTable plugin not found on doc instance.");
            alert("Table plugin missing. Please check your script tags.");
            return;
        }

        const res = lastResult;

        // --- TITLE & BRANDING ---
        doc.setFont("helvetica", "bold");
        doc.setFontSize(18);
        doc.text("HEART RISK ASSESSMENT REPORT", 105, 20, { align: "center" });
        
        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(100);
        doc.text("10-Year Cardiovascular Event Risk", 105, 26, { align: "center" });

        doc.setFontSize(22);
        doc.setTextColor(211, 47, 47); 
        doc.text("CORVIA", 105, 38, { align: "center" });

        // --- TOP INFO GRID ---
        doc.setDrawColor(200);
        doc.line(14, 45, 196, 45);
        doc.setFontSize(9);
        doc.setTextColor(0);
        doc.setFont("helvetica", "bold");
        doc.text("PATIENT NAME", 14, 52);
        doc.text("REPORT ID", 140, 52);
        doc.setFont("helvetica", "normal");
        doc.text("Patient", 14, 57);
        doc.text(`CVR-${Math.random().toString(36).substr(2, 6).toUpperCase()}`, 140, 57);

        // --- MAIN SCORE ---
        doc.setFontSize(45);
        doc.setTextColor(211, 47, 47);
        doc.text(`${res.risk_score}%`, 105, 80, { align: "center" });
        doc.setFontSize(14);
        doc.setTextColor(60);
        doc.text(res.risk_category, 105, 90, { align: "center" });

        // --- SECTION 1: CLINICAL PARAMETERS ---
        doc.autoTable({
            startY: 100,
            head: [['Investigation', 'Result', 'Unit', 'Ref. Range']],
            body: [
                ['Age', res.input_data.age, 'Years', '20-79'],
                ['Total Cholesterol', `${res.input_data.tot_chol} ${res.input_data.tot_chol > 200 ? 'HIGH' : ''}`, 'mg/dL', '< 200'],
                ['HDL Cholesterol', res.input_data.hdl_chol, 'mg/dL', '> 60'],
                ['Systolic BP', `${res.input_data.sys_bp} ${res.input_data.sys_bp > 120 ? 'HIGH' : ''}`, 'mmHg', '< 120'],
                ['Diabetes', res.input_data.diabetes ? 'Yes' : 'No', '-', 'No'],
                ['Smoking Status', res.input_data.smoker ? 'Yes' : 'No', '-', 'Non-smoker']
            ],
            theme: 'grid',
            headStyles: { fillColor: [17, 14, 24], textColor: [255, 255, 255] },
            styles: { fontSize: 9 }
        });

        // --- SECTION 2: ACTIVITY DATA ---
        let nextY = doc.lastAutoTable.finalY + 15;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.setTextColor(0);
        doc.text("ACTIVITY DATA (GOOGLE FIT)", 14, nextY);
        
        doc.autoTable({
            startY: nextY + 5,
            head: [['Metric', 'Value', 'Unit', 'AHA Target']],
            body: [
                ['Daily Steps', '8,247', 'steps/day', '>= 10,000'],
                ['Move Minutes', '42', 'min/day', '>= 30']
            ],
            theme: 'grid',
            headStyles: { fillColor: [123, 18, 18], textColor: [255, 255, 255] },
            styles: { fontSize: 9 }
        });

        // --- SECTION 3: DOCTOR'S ADVICE ---
        nextY = doc.lastAutoTable.finalY + 15;
        doc.setDrawColor(211, 47, 47);
        doc.setLineWidth(0.5);
        doc.rect(14, nextY, 182, 35); 
        
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(0);
        doc.text("CLINICAL GUIDANCE & REMARKS", 20, nextY + 8);
        
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        const advice = res.recommendation || "Based on your risk score, maintain a heart-healthy diet and regular exercise. Consult a specialist for clinical management.";
        const splitAdvice = doc.splitTextToSize(advice, 170);
        doc.text(splitAdvice, 20, nextY + 15);

        // --- FOOTER ---
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text(`Generated on: ${new Date().toLocaleString()}`, 105, 285, { align: "center" });

        doc.save(`CorVia_Report_${res.risk_score}.pdf`);

    } catch (err) {
        console.error("PDF Generation Error:", err);
        alert("Error: " + err.message);
    }
}