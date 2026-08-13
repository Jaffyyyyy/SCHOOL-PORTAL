# Server changes

I updated the server to support role-based users, teacher report uploads, and a backup endpoint.

Important notes:
- A seeded admin user is created on first run using environment variables:
  - ADMIN_USERNAME (default: jasper)
  - ADMIN_PASSWORD (default: ChangeMe!123)
  - ADMIN_EMAIL (default: jasper@example.com)
  - ADMIN_FULLNAME (default: Jasper S. Campado)
  - ADMIN_POSITION (default: Admin Officer-II)

- New endpoints:
  - GET /api/users (admin only)
  - POST /api/users (admin only)
  - PATCH /api/users/:id (admin only)
  - POST /api/users/:id/reset-password (admin only)
  - POST /api/upload/report (teacher or admin)
  - POST /api/admin/backup (admin only) => creates a ZIP of CSV exports and returns it for download

- The database schema was extended. On first run the server creates new tables and adds missing columns to existing tables where possible.

Run locally:
1. cd server
2. copy .env.example to .env and set ADMIN_PASSWORD if desired
3. npm install
4. npm start

Backups are saved under /backups in the repo root and will be offered for download when created via the API.
