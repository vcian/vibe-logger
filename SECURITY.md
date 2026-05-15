# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |

## Reporting a Vulnerability

Please do NOT open a public GitHub issue for security vulnerabilities.

Report privately via [GitHub Security Advisories](https://github.com/vcian/vibe-logger/security/advisories/new) or email: support@viitorcloud.com

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will respond within 48 hours and aim to release a patch within 7 days
for confirmed critical vulnerabilities.

## Security Model

- Passwords are stored as bcrypt hashes only — never plaintext
- Sessions use signed JWTs stored in HTTP-only cookies
- Rate limiting prevents brute force on the login endpoint
- JWT secret must be at least 32 characters
- The default JWT secret value is rejected at startup
