# Contributing to vibe-logger

Thank you for your interest in contributing!

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/yourusername/vibe-logger.git`
3. Or clone upstream: `git clone https://github.com/vcian/vibe-logger.git`
4. Install dependencies: `npm install`
5. Copy env template: `cp .env.example .env`
6. Generate a password hash: `npx ts-node src/auth/hashPassword.ts`
7. Start the dev server: `npm run dev`

## Development Workflow

- All source code is in `src/` written in TypeScript
- UI files are in `src/ui/` (vanilla HTML, CSS, JS)
- Run tests: `npm test`
- Run linter: `npm run lint`
- Run type check: `npm run typecheck`
- Format code: `npm run format`

## Pull Request Guidelines

- One feature or fix per PR
- Write or update tests for any changed functionality
- Ensure `npm test` passes before submitting
- Ensure `npm run lint` passes with zero errors
- Ensure `npm run typecheck` passes with zero errors
- Follow the existing code style (Prettier enforces this)
- Update `CHANGELOG.md` under `[Unreleased]` with your change
- Update `README.md` if you add or change any public API

## Commit Message Format

Use conventional commits format:
- `feat: add CSV export column configuration`
- `fix: correct JWT expiry calculation`
- `docs: update README with multi-user example`
- `test: add missing auth route tests`
- `refactor: extract pagination logic to helper`
- `chore: update dependencies`

## Reporting Bugs

Use the GitHub issue template for bug reports.
For security vulnerabilities, see `SECURITY.md`.

## Code of Conduct

This project follows the Contributor Covenant Code of Conduct.
See `CODE_OF_CONDUCT.md` for details.
