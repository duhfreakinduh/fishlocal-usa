# Security Policy

## Reporting a vulnerability
Do not post secrets, private URLs, personal/location data, exploit details, or sensitive logs in a public issue. Use GitHub private vulnerability reporting if enabled; otherwise open only a minimal issue until a private channel is established.

## Security expectations
- Never commit API keys or provider tokens.
- Treat precise location, saved spots, logs, and viewing/history data as private.
- Do not send location or user-entered notes to remote AI without explicit action and disclosure.
- Validate external data and keep authoritative safety/advisory information separate from generated text.
- Bound AI/network calls with timeouts and safe fallbacks.
- Review third-party CDN/dependency changes before release.
