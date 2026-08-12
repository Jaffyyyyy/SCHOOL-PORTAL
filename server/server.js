require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { db, init } = require('./db');
const { parse } = require('csv-parse/sync');

init();

const PORT = process.env.PORT || 4000;
const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'adminpass';
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';

// ensure admin user exists
(function ensureAdmin(){
  const row = db.prepare('SELECT id FROM users WHERE username = ?').get(ADMIN_USER);
  if(!row){
    const hash = bcrypt.hashSync(ADMIN_PASS, 10);
    db.prepare('INSERT INTO users (username,password_hash,role) VALUES (?,?,?)').run(ADMIN_USER, hash, 'admin');
    console.log('Seeded admin user ->', ADMIN_USER);
  }
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
    req.user = payload; next();
  }catch(e){res.status(401).json({error:'invalid token'});}  
}

function adminOnly(req,res,next){
  if(!req.user) return res.status(401).json({error:'not authenticated'});
  if(req.user.role!=='admin') return res.status(403).json({error:'admin only'});
  next();
}

// login
app.post('/api/auth/login', (req,res)=>{
  const {username,password} = req.body;
  if(!username || !password) return res.status(400).json({error:'username & password required'});
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if(!row) return res.status(401).json({error:'invalid credentials'});
  const match = bcrypt.compareSync(password, row.password_hash);
  if(!match) return res.status(401).json({error:'invalid credentials'});
  const token = jwt.sign({id:row.id,username:row.username,role:row.role}, JWT_SECRET, {expiresIn:'8h'});
  res.json({token});
});

// upload LIS CSV (students list)
const upload = multer({ dest: path.join(__dirname,'tmp') });
app.post('/api/upload/lis', authMiddleware, adminOnly, upload.single('file'), (req,res)=>{
  if(!req.file) return res.status(400).json({error:'file required'});
  const text = fs.readFileSync(req.file.path, 'utf8');
  fs.unlinkSync(req.file.path);
  // parse CSV — expect headers like student_id,first_name,last_name,grade,section
  let records;
  try{
    records = parse(text, {columns:true, skip_empty_lines:true});
  }catch(e){ return res.status(400).json({error:'CSV parse error', details:e.message}); }
  const insert = db.prepare('INSERT INTO students (student_id,first_name,last_name,grade,section,meta) VALUES (?,?,?,?,?,?)');
  const insertMany = db.transaction((rows)=>{
    for(const r of rows){
      const sid = r.student_id || r.StudentID || r.id || null;
      const fn = r.first_name || r.FirstName || r.given_name || '';
      const ln = r.last_name || r.LastName || r.family_name || '';
      const grade = r.grade || r.Grade || r.level || '';
      const section = r.section || r.Section || '';
      const meta = JSON.stringify(r);
      insert.run(sid,fn,ln,grade,section,meta);
    }
  });
  try{ insertMany(records); }catch(e){ return res.status(500).json({error:'db insert failed',details:e.message}); }
  res.json({ok:true, inserted:records.length});
});

// upload test results CSV — expects columns: student_id, test_name, subject, grade, score, mps, status
app.post('/api/upload/results', authMiddleware, adminOnly, upload.single('file'), (req,res)=>{
  if(!req.file) return res.status(400).json({error:'file required'});
  const text = fs.readFileSync(req.file.path, 'utf8');
  fs.unlinkSync(req.file.path);
  let records;
  try{ records = parse(text, {columns:true, skip_empty_lines:true}); }catch(e){ return res.status(400).json({error:'CSV parse error', details:e.message}); }
  const insertTest = db.prepare('INSERT INTO tests (name,subject,grade,date) VALUES (?,?,?,?)');
  const findTest = db.prepare('SELECT id FROM tests WHERE name = ? AND date = ?');
  const insertScore = db.prepare('INSERT INTO scores (student_id,test_id,score,mps,status) VALUES (?,?,?,?,?)');

  const insertMany = db.transaction((rows)=>{
    for(const r of rows){
      const testName = r.test_name || r.Test || 'Uploaded Test';
      const subject = r.subject || r.Subject || '';
      const grade = r.grade || r.Grade || '';
      const date = r.date || r.Date || new Date().toISOString();
      const score = r.score ? Number(r.score) : null;
      const mps = r.mps ? Number(r.mps) : null;
      const status = r.status || r.Status || '';
      // create/get test
      const insertInfo = insertTest.run(testName,subject,grade,date);
      const testId = insertInfo.lastInsertRowid;
      // find student by student_id or name
      let studentRow = null;
      if(r.student_id){ studentRow = db.prepare('SELECT id FROM students WHERE student_id = ?').get(r.student_id); }
      if(!studentRow && r.student_name){
        const parts = r.student_name.split(',').map(s=>s.trim());
        studentRow = db.prepare('SELECT id FROM students WHERE last_name = ? AND first_name LIKE ?').get(parts[0], parts[1] ? `%${parts[1]}%` : '%');
      }
      if(studentRow){ insertScore.run(studentRow.id, testId, score, mps, status); }
    }
  });
  try{ insertMany(records); }catch(e){ return res.status(500).json({error:'db insert failed',details:e.message}); }
  res.json({ok:true, uploaded:records.length});
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
  // overall MPS = average of scores.mps
  const m = db.prepare('SELECT avg(mps) as avgm FROM scores WHERE mps IS NOT NULL').get().avgm;
  const atRisk = db.prepare("SELECT COUNT(DISTINCT student_id) as c FROM scores WHERE mps IS NOT NULL AND mps < 60").get().c;
  // submission rate = number of tests uploaded ? simplified: distinct tests count / number of teachers? not available. We'll compute percent of students with at least one score
  const studentsWithScore = db.prepare('SELECT COUNT(DISTINCT student_id) as c FROM scores').get().c;
  const submissionRate = total? Math.round((studentsWithScore/total)*100):0;
  res.json({totalLearners:total, overallMPS: m, atRisk, submissionRate});
});

// serve static frontend files from repo root if present (for convenience when running locally)
app.use(express.static(path.join(__dirname,'..')));

app.listen(PORT, ()=>{
  console.log('Server started on', PORT);
});
