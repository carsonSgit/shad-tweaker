# CLAUDE.md

## Secrets

Secrets are managed via Infisical, not committed `.env` files. This VM has a
machine identity (Universal Auth) configured system-wide, so the CLI needs no
login step — it just works.

- Run anything that needs secrets through `infisical run -- <command>` (injects
  them as env vars into the process).
- Inspect what's set: `infisical secrets`.
- `.infisical.json` at the repo root points the CLI at this project's `dev`
  environment. Once other environments exist, target one with
  `infisical run --env=<env> -- <command>`.
- Add or change a secret with `infisical secrets set KEY=value` — don't create
  a `.env` file with real values.
