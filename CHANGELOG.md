# Changelog

All notable changes to this project will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-05-06

### Added
- Initial release of vibe-logger
- Real-time log viewer with search, filter, and date range filtering
- Time-series bar chart (Chart.js) showing log volume by hour
- CSV export of filtered log entries
- .env-based authentication with bcrypt password hashing
- JWT session management with HTTP-only cookies
- Multi-user support with admin and viewer roles
- Rate limiting on login endpoint (brute-force protection)
- Express middleware factory pattern — drop-in for any Express app
- TypeScript support with full type definitions
- ESM and CJS dual package output
- CLI helper: npx vibe-logger hash-password
- Console interception mode
- Light mode UI with responsive design
- Pagination with configurable rows per page
- Log Quality Insights panel with error rate, noisy sources, spike hours
