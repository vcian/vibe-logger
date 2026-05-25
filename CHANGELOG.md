# Changelog

All notable changes to this project will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.1] - 2026-05-25

### Security
- Removed unused `uuid` dependency to eliminate the v9 bounds-check CVE (GHSA-w5hq-g745-h8pq). The library already uses Node's built-in `crypto.randomUUID()`.
- Added `qs` override (`>=6.15.2`) to fix the transitive moderate DoS CVE (GHSA-q8mj-m7cp-5q26) coming through `express` → `body-parser` → `qs`.
- `npm audit` now reports zero vulnerabilities.

### Changed
- Upgraded `bcryptjs` from `^2.4.3` to `^3.0.2`. The v2.x line was deprecated by its maintainer; v3.x is API-compatible (`bcrypt.hash` / `bcrypt.compare` work unchanged).
- Expanded npm `keywords` with high-signal terms (winston, pino, nestjs, observability, log-dashboard, log-ui, time-series, etc.) for better npm search ranking.
- Rewrote the package `description` to be more keyword-dense while remaining readable.
- Added `publishConfig` with `access: public` and `provenance: true` so the scoped package publishes publicly with a verified provenance attestation.

### Added
- GitHub Actions CI workflow (`.github/workflows/ci.yml`) running lint, typecheck, tests, and build across Ubuntu / Windows / macOS on Node 20 and 22.
- GitHub Actions publish workflow (`.github/workflows/publish.yml`) that auto-publishes to npm with provenance when `package.json` version changes on `main`. Also supports manual dispatch (`patch` / `minor` / `major`) and tag-driven (`v*.*.*`) releases.
- CI status badge and restored npm/license/node/downloads badges as clickable shields in the README.

### Removed
- `uuid` and `@types/uuid` dependencies (unused — code uses Node built-in `crypto.randomUUID`).

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
