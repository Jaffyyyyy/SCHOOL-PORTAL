const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'school.db');
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new Database(DB_FILE);

function init() {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password_hash TEXT,
      role TEXT
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
  `);
}

module.exports = { db, init };
