// dashboard.js — parse CSV and render dashboard
(async function(){
  const csvPath = 'data/MAM_ONDATABASE_COMPLETE_DASHBOARD.csv';
  const raw = await fetch(csvPath).then(r=>r.text());

  // Use PapaParse to parse CSV into rows
  const parsed = Papa.parse(raw, {skipEmptyLines:false}).data;

  // Helper: join cell values into string for detection
  const rowText = (row)=> (row||[]).map(c=>c||'').join(',').trim();

  // Find sections
  let teacherStart = parsed.findIndex(r=> (r[0]||'').toString().startsWith('Teacher') && (r[1]||'').toString().startsWith('Grade'));
  let recentStart = parsed.findIndex(r=> (r[0]||'').toString().startsWith('Date') && (r[1]||'').toString().startsWith('Teacher'));
  let compStart = parsed.findIndex(r=> (r[0]||'').toString().startsWith('Priority Need'));

  // Metrics by scanning for key labels
  const metrics = { totalLearners:null, overallMPS:null, atRisk:null, submissionRate:null, lastRefresh:null };
  for(const r of parsed){
    const a = (r[0]||'').toString();
    const joined = rowText(r);
    if(joined.includes('Total Learners')){
      // look for number after Total Learners
      const idx = r.findIndex(c=> (c||'').toString().includes('Total Learners'));
    }
    if(joined.includes('Total Learners,') || joined.includes('TOTAL LEARNERS')){
      // attempt to extract nearby number
      const n = joined.match(/Total Learners,?\W*(\d{1,6})/i);
      if(n) metrics.totalLearners = Number(n[1]);
    }
    if(joined.match(/Overall MPS,?\W*(0?\.?\d+)/i)){
      const m = joined.match(/Overall MPS,?\W*(0?\.?\d+)/i);
      if(m) metrics.overallMPS = Number(m[1]);
    }
    if(joined.match(/AT-?RISK LEARNERS,?\W*(\d+)/i)){
      const m = joined.match(/AT-?RISK LEARNERS,?\W*(\d+)/i);
      if(m) metrics.atRisk = Number(m[1]);
    }
    if(joined.match(/Submission Rate,?\W*(\d{1,3}\.\d+%|\d{1,3}%)/i)){
      const m = joined.match(/Submission Rate,?\W*(\d{1,3}\.\d+%|\d{1,3}%)/i);
      if(m) metrics.submissionRate = m[1];
    }
    if(joined.includes('Last Refresh')){
      const m = joined.match(/Last Refresh,?\W*([^,]+)/i);
      if(m) metrics.lastRefresh = m[1].trim();
    }
  }

  // Fallbacks from helper area near top of file
  if(!metrics.totalLearners){
    // try to find a number like ",Total Learners,130"
    for(const r of parsed){
      const j = rowText(r);
      const m = j.match(/Total Learners,\s*(\d{1,6})/i);
      if(m){ metrics.totalLearners = Number(m[1]); break; }
    }
  }
  if(!metrics.overallMPS){
    for(const r of parsed){
      const j = rowText(r);
      const m = j.match(/Overall MPS,?\W*(0?\.?\d+)/i);
      if(m){ metrics.overallMPS = Number(m[1]); break; }
    }
  }
  if(!metrics.atRisk){
    for(const r of parsed){
      const j = rowText(r);
      const m = j.match(/At-?Risk Learners,?\W*(\d{1,6})/i);
      if(m){ metrics.atRisk = Number(m[1]); break; }
    }
  }
  if(!metrics.submissionRate){
    for(const r of parsed){
      const j = rowText(r);
      const m = j.match(/(Submission Rate|Overall Rate),?\W*(\d{1,3}\.\d+%|\d{1,3}%)/i);
      if(m){ metrics.submissionRate = m[2]; break; }
    }
  }

  // Parse teacher table
  const teachers = [];
  if(teacherStart>=0){
    const headers = parsed[teacherStart].map(h=> (h||'').toString().trim());
    for(let i=teacherStart+1;i<parsed.length;i++){
      const row = parsed[i];
      if(!row || row.every(c=>!c)) break; // stop at empty row
      // stop if row starts a different section
      const first = (row[0]||'').toString();
      if(first && first.includes('Submitted') && i>teacherStart+6) break;
      const obj = {};
      obj.name = row[0]||'';
      obj.grade = row[1]||'';
      obj.status = row[2]||'';
      obj.dateSubmitted = row[3]||'';
      obj.deadline = row[4]||'';
      obj.remarks = row[5]||'';
      teachers.push(obj);
    }
  }

  // Parse recent submissions
  const recent = [];
  if(recentStart>=0){
    const headers = parsed[recentStart];
    for(let i=recentStart+1;i<parsed.length;i++){
      const row = parsed[i];
      if(!row || row.every(c=>!c)) break;
      const name = (row[1]||'').toString();
      if(!name) continue;
      recent.push({date:row[0]||'',teacher:row[1]||'',grade:row[2]||'',assessment:row[3]||'',subject:row[4]||'',mps:row[5]||'',status:row[6]||'',file:row[7]||''});
    }
  }

  // Parse competencies
  const competencies = [];
  if(compStart>=0){
    for(let i=compStart+1;i<parsed.length;i++){
      const row = parsed[i];
      if(!row || row.every(c=>!c)) break;
      if((row[0]||'').toString().startsWith('Priority')) continue;
      const need = row[0]||'';
      const subject = row[1]||'';
      const grade = row[2]||'';
      const at = row[3]||'';
      if(need) competencies.push({need,subject,grade,atRisk:at});
    }
  }

  // Derive MPS by grade from teacher rows if available
  const mpsByGrade = {};
  // There are columns after remarks with percent values for Kinder..Grade6 sometimes — heuristic: find row that contains "Kinder" in header near teacher header
  const headerRow = parsed[12] || [];
  // try to read MPS by subject near top helper metrics
  for(const r of parsed){
    const j = rowText(r);
    const subj = j.match(/English,([0-9\.]+)/i);
    if(subj) mpsByGrade['English'] = Number(subj[1]);
  }

  // Fill UI
  document.getElementById('meta-info').textContent = 'Source: CSV — last refresh: ' + (metrics.lastRefresh||'unknown');
  document.getElementById('kpi-total').querySelector('.kpi-value').textContent = metrics.totalLearners ?? '—';
  document.getElementById('kpi-mps').querySelector('.kpi-value').textContent = (metrics.overallMPS!=null)? (Math.round(metrics.overallMPS*1000)/10 + '%') : '—';
  document.getElementById('kpi-atrisk').querySelector('.kpi-value').textContent = metrics.atRisk ?? '—';
  document.getElementById('kpi-submission').querySelector('.kpi-value').textContent = metrics.submissionRate ?? '—';

  // Populate filters
  const gradeSet = new Set(['All']);
  const subjectSet = new Set(['All']);
  const teacherSet = new Set(['All']);
  teachers.forEach(t=>{ if(t.grade) gradeSet.add(t.grade); if(t.name) teacherSet.add(t.name); });
  recent.forEach(r=>{ if(r.subject) subjectSet.add(r.subject); if(r.grade) gradeSet.add(r.grade); });
  competencies.forEach(c=>{ if(c.subject) subjectSet.add(c.subject); });
  const addOptions=(selId,set)=>{ const sel=document.getElementById(selId); Array.from(set).forEach(v=>{ const o=document.createElement('option'); o.value=v; o.textContent=v; sel.appendChild(o);}); }
  addOptions('filter-grade',gradeSet); addOptions('filter-subject',subjectSet); addOptions('filter-teacher',teacherSet);

  // Render teachers table
  const tHead = document.querySelector('#table-teachers thead');
  const tBody = document.querySelector('#table-teachers tbody');
  tHead.innerHTML = '<tr><th>Teacher</th><th>Grade</th><th>Status</th><th>Date Submitted</th><th>Deadline</th><th>Remarks</th></tr>';
  tBody.innerHTML = teachers.map(t=>`<tr><td>${escapeHtml(t.name)}</td><td>${escapeHtml(t.grade)}</td><td>${escapeHtml(t.status)}</td><td>${escapeHtml(t.dateSubmitted)}</td><td>${escapeHtml(t.deadline)}</td><td>${escapeHtml(t.remarks)}</td></tr>`).join('');

  // Render competencies
  const cHead = document.querySelector('#table-competencies thead');
  const cBody = document.querySelector('#table-competencies tbody');
  cHead.innerHTML = '<tr><th>Priority Need</th><th>Subject</th><th>Grade</th><th>At-Risk</th></tr>';
  cBody.innerHTML = competencies.map(c=>`<tr><td>${escapeHtml(c.need)}</td><td>${escapeHtml(c.subject)}</td><td>${escapeHtml(c.grade)}</td><td>${escapeHtml(c.atRisk)}</td></tr>`).join('');

  // Recent table
  const rHead = document.querySelector('#table-recent thead');
  const rBody = document.querySelector('#table-recent tbody');
  rHead.innerHTML = '<tr><th>Date</th><th>Teacher</th><th>Grade</th><th>Assessment</th><th>Subject</th><th>MPS</th><th>Status</th></tr>';
  rBody.innerHTML = recent.map(r=>`<tr><td>${escapeHtml(r.date)}</td><td>${escapeHtml(r.teacher)}</td><td>${escapeHtml(r.grade)}</td><td>${escapeHtml(r.assessment)}</td><td>${escapeHtml(r.subject)}</td><td>${escapeHtml(r.mps)}</td><td>${escapeHtml(r.status)}</td></tr>`).join('');

  // Simple charts: MPS by grade from header values if present; fallback: compute average from recent rows where mps is percent
  const gradeLabels = ['Kinder','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6'];
  const mpsValues = gradeLabels.map(g=>{
    // try to find a header row with g and percent
    for(const r of parsed){ if((r||[]).some(c=> (c||'').toString().includes(g))){
      // find percent in row
      for(const c of r){ const s=(c||'').toString(); if(s.includes('%')) return Number(s.replace('%',''));
        const n = s.match(/(\d+\.?\d+)%/); if(n) return Number(n[1]); }
    }}
    // fallback: compute from recent
    const vals = recent.filter(x=>x.grade==g && x.mps).map(x=>Number((x.mps||'').toString().replace('%',''))).filter(v=>!isNaN(v));
    if(vals.length) return Math.round(vals.reduce((a,b)=>a+b,0)/vals.length);
    return 0;
  });

  const atriskValues = gradeLabels.map(g=>{
    // find in helper area like ",Grade 1,26"
    for(const r of parsed){ const j=rowText(r); const m = j.match(new RegExp(g+"[,\\s]+(\\d{1,3})")); if(m) return Number(m[1]); }
    return 0;
  });

  const ctx1 = document.getElementById('chart-mps-grade').getContext('2d');
  new Chart(ctx1, {type:'bar',data:{labels:gradeLabels,datasets:[{label:'MPS (%)',data:mpsValues,backgroundColor:'#0b73ff'}]},options:{responsive:true}});

  const ctx2 = document.getElementById('chart-atrisk-grade').getContext('2d');
  new Chart(ctx2, {type:'bar',data:{labels:gradeLabels,datasets:[{label:'At-Risk',data:atriskValues,backgroundColor:'#ff7a7a'}]},options:{responsive:true}});

  // Simple filter wiring
  document.getElementById('filter-grade').addEventListener('change',applyFilters);
  document.getElementById('filter-subject').addEventListener('change',applyFilters);
  document.getElementById('filter-teacher').addEventListener('change',applyFilters);

  function applyFilters(){
    const fg = document.getElementById('filter-grade').value;
    const fs = document.getElementById('filter-subject').value;
    const ft = document.getElementById('filter-teacher').value;
    // filter teachers
    const rows = teachers.filter(t=> (fg==='All' || t.grade===fg) && (ft==='All' || t.name===ft));
    tBody.innerHTML = rows.map(t=>`<tr><td>${escapeHtml(t.name)}</td><td>${escapeHtml(t.grade)}</td><td>${escapeHtml(t.status)}</td><td>${escapeHtml(t.dateSubmitted)}</td><td>${escapeHtml(t.deadline)}</td><td>${escapeHtml(t.remarks)}</td></tr>`).join('');
    // filter recent
    const rrows = recent.filter(r=> (fg==='All' || r.grade===fg) && (fs==='All' || r.subject===fs) && (ft==='All' || r.teacher===ft));
    rBody.innerHTML = rrows.map(r=>`<tr><td>${escapeHtml(r.date)}</td><td>${escapeHtml(r.teacher)}</td><td>${escapeHtml(r.grade)}</td><td>${escapeHtml(r.assessment)}</td><td>${escapeHtml(r.subject)}</td><td>${escapeHtml(r.mps)}</td><td>${escapeHtml(r.status)}</td></tr>`).join('');
  }

  function escapeHtml(s){ return (s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
})();
