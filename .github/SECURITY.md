# Security policy

## Supported version

Security fixes are applied to the current default branch and the live deployment. Older commits and archived releases are not supported.

## Report a vulnerability privately

Please use GitHub's **Report a vulnerability** button in the repository Security tab. Do not open a public issue for a suspected vulnerability.

Useful reports include:

- a concise description and potential impact;
- affected URL, component, commit, or configuration;
- reproducible steps or a minimal proof of concept;
- whether browser location, journey analytics, API credentials, or WebMCP tool results may be exposed.

Please do not access other people's data, disrupt the public service, perform denial-of-service testing, or publish credentials while investigating.

We will acknowledge a report as soon as practical, investigate it, and coordinate disclosure after a fix is available. No bounty program is currently offered.

## Particularly sensitive areas

- browser geolocation and the boundary that removes raw coordinates from agent-visible results;
- server-only TDX and CWA credentials;
- submitted journey questions and session-scoped analytics;
- natural-language intent parsing and the restricted Codex CLI subprocess;
- upstream place, routing, transit, and weather requests;
- native WebMCP tool registration and result handling.

