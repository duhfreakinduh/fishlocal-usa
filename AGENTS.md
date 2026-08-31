# AI / Contributor Guide

This app should remain useful as a lightweight fishing/location PWA. AI coaching is optional and must not replace authoritative safety, weather, access, or consumption-advisory information.

## Priorities
1. Keep location and saved fishing data private by default.
2. Never expose API/provider keys in client code.
3. Label AI-generated suggestions and keep them separate from sourced advisories/facts.
4. AI/network failures must fall back to the normal app without blocking maps, logs, or saved spots.
5. Prefer deterministic rules for safety/advisory warnings; do not let AI invent regulations or consumption limits.
6. Preserve offline/PWA behavior and keep model/network use light on mobile devices.
7. Validate external data and handle missing geolocation permission cleanly.
8. Update README when data sources or AI behavior change.

## Before merging
- Test with geolocation denied.
- Test offline and with AI unavailable.
- Verify saved spots/logs survive an update.
- Confirm safety/advisory text is sourced, not generated.
- Check mobile layout and console errors.
