require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { Parser } = require('json2csv');
const { db, init } = require('./db');
const { parse } = require('csv-parse/sync');

init();

const PORT = process.env.PORT || 4000;
const ADMIN_USER = process.env.ADMIN_USERNAME || 'jasper';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'ChangeMe!123';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'jasper@example.com';
const ADMIN_FULLNAME = process.env.ADMIN_FULLNAME || 'Jasper S. Campado';
const ADMIN_POSITION = process.env.ADMIN_POSITION || 'Admin Officer-II';
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';

// ensure admin user exists (seed Jasper as system creator)
(function ensureAdmin(){
  try{
    const row = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(ADMIN_USER, ADMIN_EMAIL);
    if(!row){
      const hash = bcrypt.hashSync(ADMIN_PASS, 10);
      const stmt = db.prepare('INSERT INTO users (username,email,password_hash,first_name,last_name,role,position,created_at) VALUES (?,?,?,?,?,?,?,datetime("now"))');
      const names = ADMIN_FULLNAME.split(' ');
      const first = names.shift();
      const last = names.join(' ');
      stmt.run(ADMIN_USER, ADMIN_EMAIL, hash, first, last, 'admin', ADMIN_POSITION);
      console.log('Seeded admin user ->', ADMIN_USER);
    }
  }catch(e){ console.error('ensureAdmin error', e); }
})();

const app = express();
app.use(cors());
app.use(express.json());

function authMiddleware(req,res,next){
  const auth = req.headers.authorization;
  if(!auth) return res.status(401).json({error:'missing Authorization header'});
  const parts = auth.split(' ');
  if(parts.length!==2) return res.status(401).json({error:'invalid Authorization header'});
  const token = parts[1];
  try{
    const payload = jwt.verify(token, JWT_SECRET);
    // attach fresh user row
    const u = db.prepare('SELECT id,username,email,role,first_name,last_name,position,disabled FROM users WHERE id = ?').get(payload.id);
    if(!u) return res.status(401).json({error:'user not found'});
    if(u.disabled) return res.status(403).json({error:'user disabled'});
    req.user = u; next();
  }catch(e){res.status(401).json({error:'invalid token'});}  
}

function requireRole(...roles){
  return function(req,res,next){
    if(!req.user) return res.status(401).json({error:'not authenticated'});
    if(!roles.includes(req.user.role)) return res.status(403).json({error:'insufficient role'});
    next();
  }
}

// login
app.post('/api/auth/login', (req,res)=>{
  const {username,password} = req.body;
  if(!username || !password) return res.status(400).json({error:'username & password required'});
  const row = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username, username);
  if(!row) return res.status(401).json({error:'invalid credentials'});
  const match = bcrypt.compareSync(password, row.password_hash);
  if(!match) return res.status(401).json({error:'invalid credentials'});
  const token = jwt.sign({id:row.id,username:row.username,role:row.role}, JWT_SECRET, {expiresIn:'8h'});
  res.json({token, user:{id:row.id,username:row.username,role:row.role,first_name:row.first_name,last_name:row.last_name,email:row.email,position:row.position}});
});

// users management (admin)
app.get('/api/users', authMiddleware, requireRole('admin'), (req,res)=>{
  const rows = db.prepare('SELECT id,username,email,first_name,last_name,role,position,disabled,created_at FROM users ORDER BY id DESC').all();
  res.json({users:rows});
});

app.post('/api/users', authMiddleware, requireRole('admin'), (req,res)=>{
  const {username,email,password,first_name,last_name,role,position} = req.body;
  if(!username || !email || !password) return res.status(400).json({error:'username,email,password required'});
  const hash = bcrypt.hashSync(password, 10);
  try{
    const info = db.prepare('INSERT INTO users (username,email,password_hash,first_name,last_name,role,position,created_by) VALUES (?,?,?,?,?,?,?,?)').run(username,email,hash,first_name,last_name,role||'teacher',position||'', req.user.id);
    const id = info.lastInsertRowid;
    const user = db.prepare('SELECT id,username,email,first_name,last_name,role,position,disabled FROM users WHERE id = ?').get(id);
    db.prepare('INSERT INTO audit_logs (user_id,action,target_type,target_id,metadata) VALUES (?,?,?,?,?)').run(req.user.id,'create_user','user',id,JSON.stringify({by:req.user.username}));
    res.json({user});
  }catch(e){ res.status(500).json({error:'create failed',details:e.message}); }
});

app.patch('/api/users/:id', authMiddleware, requireRole('admin'), (req,res)=>{
  const id = Number(req.params.id);
  const fields = ['username','email','first_name','last_name','role','position','disabled'];
  const updates = [];
  const values = [];
  for(const f of fields){ if(req.body[f]!==undefined){ updates.push(`${f} = ?`); values.push(req.body[f]); } }
  if(!updates.length) return res.status(400).json({error:'no fields to update'});
  values.push(id);
  try{
    db.prepare(`UPDATE users SET ${updates.join(',')} WHERE id = ?`).run(...values);
    const user = db.prepare('SELECT id,username,email,first_name,last_name,role,position,disabled FROM users WHERE id = ?').get(id);
    db.prepare('INSERT INTO audit_logs (user_id,action,target_type,target_id,metadata) VALUES (?,?,?,?,?)').run(req.user.id,'update_user','user',id,JSON.stringify({by:req.user.username,changes:req.body}));
    res.json({user});
  }catch(e){ res.status(500).json({error:'update failed',details:e.message}); }
});

app.post('/api/users/:id/reset-password', authMiddleware, requireRole('admin'), (req,res)=>{
  const id = Number(req.params.id);
  const newPassword = req.body.password || (Math.random().toString(36).slice(-10) + 'A1');
  const hash = bcrypt.hashSync(newPassword, 10);
  try{
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash,id);
    db.prepare('INSERT INTO audit_logs (user_id,action,target_type,target_id,metadata) VALUES (?,?,?,?,?)').run(req.user.id,'reset_password','user',id,JSON.stringify({by:req.user.username}));
    res.json({ok:true,password:newPassword});
  }catch(e){ res.status(500).json({error:'reset failed',details:e.message}); }
});

// file uploads
const upload = multer({ dest: path.join(__dirname,'tmp') });

// teacher upload (reports) - teacher or admin
app.post('/api/upload/report', authMiddleware, (req,res,next)=>{
  // allow teacher and admin
  if(!['teacher','admin'].includes(req.user.role)) return res.status(403).json({error:'only teachers or admin can upload reports'});
  next();
}, upload.single('file'), (req,res)=>{
  if(!req.file) return res.status(400).json({error:'file required'});
  const savedPath = path.join('uploads', String(req.user.id));
  fs.mkdirSync(path.join(__dirname,'..',savedPath), { recursive: true });
  const destName = Date.now() + '-' + (req.file.originalname || 'upload');
  const destPath = path.join(__dirname,'..',savedPath, destName);
  fs.renameSync(req.file.path, destPath);
  // create submission record
  const info = db.prepare('INSERT INTO submissions (user_id,filename,original_name,path,status) VALUES (?,?,?,?,?)').run(req.user.id, destName, req.file.originalname, destPath, 'uploaded');
  const submissionId = info.lastInsertRowid;
  db.prepare('INSERT INTO audit_logs (user_id,action,target_type,target_id,metadata) VALUES (?,?,?,?,?)').run(req.user.id,'upload_submission','submission',submissionId,JSON.stringify({file:req.file.originalname}));

  // attempt quick parse if CSV
  let formatIndicator = {required_fields_present:false,missing_fields:[],confidence:0,flags:[]};
  let summary = {};
  try{
    const text = fs.readFileSync(destPath,'utf8');
    const records = parse(text, {columns:true,skip_empty_lines:true});
    // basic detection
    const headers = Object.keys(records[0]||{}).map(h=>h.toLowerCase());
    const need = ['student_id','first_name','last_name','grade','subject','score','mps'];
    const missing = need.filter(n=>!headers.some(h=>h.includes(n)));
    formatIndicator.required_fields_present = missing.length===0;
    formatIndicator.missing_fields = missing;
    formatIndicator.confidence = Math.max(40, 100 - missing.length * 15);
    if(missing.length) formatIndicator.flags.push('missing_fields');

    // quick summary: count rows, avg mps
    const mpsVals = records.map(r=>{
      const v = (r.mps || r.MPS || r.Mps || r['MPS (%)'] || '').toString().replace('%','');
      const n = Number(v);
      return isNaN(n)? null : n;
    }).filter(x=>x!=null);
    summary.rowCount = records.length;
    summary.avgMPS = mpsVals.length ? (mpsVals.reduce((a,b)=>a+b,0)/mpsVals.length) : null;

    db.prepare('UPDATE submissions SET status = ?, parsed_at = datetime("now"), format_indicator = ?, summary = ? WHERE id = ?').run('parsed', JSON.stringify(formatIndicator), JSON.stringify(summary), submissionId);
    // optionally create report rows for each record (lightweight)
    const insertReport = db.prepare('INSERT INTO reports (submission_id,report_type,grade,assessment,mps,subject,analysis) VALUES (?,?,?,?,?,?,?)');
    const insertMany = db.transaction((rows)=>{
      for(const r of rows){
        const grade = r.grade || r.Grade || '';
        const subject = r.subject || r.Subject || '';
        const mps = r.mps ? Number((r.mps||'').toString().replace('%','')) : (r.MPS ? Number(r.MPS) : null);
        insertReport.run(submissionId, 'teacher_upload', grade, (r.test_name||r.assessment||''), mps, subject, JSON.stringify({sourceRow:r}));
      }
    });
    try{ insertMany(records); }catch(e){ console.error('report insert failed', e); }

    res.json({ok:true,submissionId,formatIndicator,summary});
  }catch(e){
    // not CSV or parse failed
    db.prepare('UPDATE submissions SET status = ? WHERE id = ?').run('uploaded', submissionId);
    res.json({ok:true,submissionId,formatIndicator,summary,warning:'could not parse file automatically'});
  }
});

// backup endpoint - admin only -> creates CSVs and zips them
app.post('/api/admin/backup', authMiddleware, requireRole('admin'), async (req,res)=>{
  try{
    const tables = ['users','students','tests','scores','submissions','reports','competencies','audit_logs','settings'];
    const tmpDir = path.join(__dirname,'..','backups');
    fs.mkdirSync(tmpDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g,'-');
    const zipPath = path.join(tmpDir, `backup-${timestamp}.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(output);

    for(const t of tables){
      try{
        const rows = db.prepare(`SELECT * FROM ${t}`).all();
        const csv = rows.length ? new Parser().parse(rows) : '';
        archive.append(csv, { name: `${t}.csv` });
      }catch(e){ archive.append('', { name: `${t}.csv` }); }
    }

    // also include uploads list (file paths) as a manifest
    const uploads = db.prepare('SELECT id,user_id,filename,original_name,path,uploaded_at,status FROM submissions ORDER BY uploaded_at DESC').all();
    archive.append(new Parser().parse(uploads), { name: 'uploads_manifest.csv' });

    await archive.finalize();
    output.on('close', ()=>{
      db.prepare('INSERT INTO audit_logs (user_id,action,target_type,target_id,metadata) VALUES (?,?,?,?,?)').run(req.user.id,'create_backup','backup',null,JSON.stringify({path:zipPath}));
      res.download(zipPath);
    });
  }catch(e){ console.error(e); res.status(500).json({error:'backup failed',details:e.message}); }
});

// search students
app.get('/api/students', authMiddleware, (req,res)=>{
  const q = (req.query.q||'').toLowerCase();
  if(!q) return res.json({students: db.prepare('SELECT * FROM students LIMIT 200').all()});
  const rows = db.prepare("SELECT * FROM students WHERE lower(first_name) LIKE ? OR lower(last_name) LIKE ? OR student_id LIKE ? OR grade LIKE ? LIMIT 200").all(`%${q}%`,`%${q}%`,`%${q}%`,`%${q}%`);
  res.json({students:rows});
});

// list tests for dropdown
app.get('/api/tests', authMiddleware, (req,res)=>{
  const rows = db.prepare('SELECT id,name,subject,grade,date FROM tests ORDER BY date DESC LIMIT 200').all();
  res.json({tests:rows});
});

// consolidation per grade
app.get('/api/grades/:grade/consolidation', authMiddleware, (req,res)=>{
  const grade = req.params.grade;
  const rows = db.prepare(`
    SELECT s.id as student_id, s.student_id as sid, s.first_name, s.last_name, t.name as test_name, t.subject, sc.score, sc.mps
    FROM scores sc
    JOIN students s ON sc.student_id = s.id
    JOIN tests t ON sc.test_id = t.id
    WHERE s.grade = ?
  `).all(grade);
  // group by student, compute average mps
  const map = {};
  for(const r of rows){
    const key = r.student_id;
    if(!map[key]) map[key] = {studentId:r.sid, first_name:r.first_name, last_name:r.last_name, tests:[], avgMPS:null};
    map[key].tests.push({test:r.test_name,subject:r.subject,score:r.score,mps:r.mps});
  }
  const result = Object.values(map).map(s=>{ const m = s.tests.map(t=>t.mps).filter(x=>x!=null); s.avgMPS = m.length ? (m.reduce((a,b)=>a+b,0)/m.length) : null; return s; });
  res.json({grade,students:result});
});

// dashboard summary
app.get('/api/dashboard/summary', authMiddleware, (req,res)=>{
  const total = db.prepare('SELECT COUNT(*) as c FROM students').get().c;
  const m = db.prepare('SELECT avg(mps) as avgm FROM scores WHERE mps IS NOT NULL').get().avgm;
  const atRisk = db.prepare("SELECT COUNT(DISTINCT student_id) as c FROM scores WHERE mps IS NOT NULL AND mps < 60").get().c;
  const studentsWithScore = db.prepare('SELECT COUNT(DISTINCT student_id) as c FROM scores').get().c;
  const submissionRate = total? Math.round((studentsWithScore/total)*100):0;
  res.json({totalLearners:total, overallMPS: m, atRisk, submissionRate});
});

// serve static frontend files from repo root if present (for convenience when running locally)
app.use(express.static(path.join(__dirname,'..')));

app.listen(PORT, ()=>{
  console.log('Server started on', PORT);
});
