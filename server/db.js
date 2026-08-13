const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'school.db');
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new Database(DB_FILE);

function columnExists(table, column){
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some(r=>r.name===column);
}

function init() {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT,
      first_name TEXT,
      last_name TEXT,
      role TEXT,
      position TEXT,
      disabled INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER
    );
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT,
      first_name TEXT,
      last_name TEXT,
      grade TEXT,
      section TEXT,
      meta JSON
    );
    CREATE TABLE IF NOT EXISTS tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      subject TEXT,
      grade TEXT,
      date TEXT
    );
    CREATE TABLE IF NOT EXISTS scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER,
      test_id INTEGER,
      score REAL,
      mps REAL,
      status TEXT,
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY(test_id) REFERENCES tests(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      filename TEXT,
      original_name TEXT,
      path TEXT,
      uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
      status TEXT,
      parsed_at TEXT,
      format_indicator JSON,
      summary JSON,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id INTEGER,
      report_type TEXT,
      grade TEXT,
      assessment TEXT,
      mps REAL,
      subject TEXT,
      analysis JSON,
      FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS competencies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      subject TEXT,
      grade TEXT,
      at_risk_count INTEGER,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT,
      target_type TEXT,
      target_id INTEGER,
      metadata JSON,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value JSON
    );
  `);

  // ensure older installations get new columns (sqlite allows ALTER TABLE ADD COLUMN)
  try{
    if(!columnExists('users','email')) db.prepare('ALTER TABLE users ADD COLUMN email TEXT UNIQUE').run();
  }catch(e){}
  try{ if(!columnExists('users','first_name')) db.prepare('ALTER TABLE users ADD COLUMN first_name TEXT').run(); }catch(e){}
  try{ if(!columnExists('users','last_name')) db.prepare('ALTER TABLE users ADD COLUMN last_name TEXT').run(); }catch(e){}
  try{ if(!columnExists('users','position')) db.prepare('ALTER TABLE users ADD COLUMN position TEXT').run(); }catch(e){}
  try{ if(!columnExists('users','disabled')) db.prepare('ALTER TABLE users ADD COLUMN disabled INTEGER DEFAULT 0').run(); }catch(e){}
  try{ if(!columnExists('users','created_at')) db.prepare("ALTER TABLE users ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP").run(); }catch(e){}
  try{ if(!columnExists('users','created_by')) db.prepare('ALTER TABLE users ADD COLUMN created_by INTEGER').run(); }catch(e){}
}

module.exports = { db, init };