# School Portal Server

This simple Node/Express server uses SQLite to store Students, Tests, and Scores, and exposes APIs for:
- Admin authentication (simple JWT)
- Upload LIS CSV (students)
- Upload Test results CSV
- Search students
- Dashboard summary and grade consolidation

Run locally
1. cd server
2. copy .env.example to .env and edit ADMIN_PASSWORD if desired
3. npm install
4. npm start

Docker
- You can dockerize the server; instructions omitted here but straightforward.

Notes
- This is a minimal starter backend for the static dashboard. It uses JWTs and a seeded admin user. In production, replace with a proper auth provider and HTTPS.
