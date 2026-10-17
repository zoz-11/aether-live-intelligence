# Security Policy

## Supported versions

Only the default branch (`main`) receives security fixes during active development.

## Reporting a vulnerability

Do **not** open a public issue for security problems.

Email the maintainer privately or open a private GitHub Security Advisory on this repository.

Include:

- Description of the issue
- Steps to reproduce
- Impact assessment
- Suggested fix (optional)

## Hard rules for contributors

- Never commit `XAI_API_KEY`, tokens, or private keys.
- Use environment variables / secret managers only.
- Treat tool calling as untrusted input; validate args before mutation.
- Risky actions (restart, send email) must require explicit user confirmation.
