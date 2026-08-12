# SCHOOL-PORTAL — Dashboard (feature/dashboard)

This branch adds a lightweight static dashboard that uses the provided CSV as the data source.

Files added in branch feature/dashboard:
- index.html — single-page dashboard UI
- assets/css/style.css — styles
- assets/js/dashboard.js — CSV parsing, normalization, rendering, and charts
- data/MAM_ONDATABASE_COMPLETE_DASHBOARD.csv — cleaned copy of your CSV export

How to preview locally:
1. Clone your repo and checkout the branch:
   git fetch origin
   git checkout feature/dashboard
2. Start a simple static server (so fetch() can load the CSV):
   - Python 3: python -m http.server 8000
   - Node: npx serve .
3. Open http://localhost:8000/index.html

Notes and next steps:
- The parser is heuristic-based and extracts teacher rows, recent submissions, and top competencies. If your CSV structure changes (different column order), update assets/js/dashboard.js accordingly.
- If you want, I can extend this to:
  - Use server-side parsing and a database (Postgres/SQLite).
  - Add authentication and teacher upload flows.
  - Improve visuals and accessibility.

If this looks good I can open a pull request from feature/dashboard to main with the changes.
