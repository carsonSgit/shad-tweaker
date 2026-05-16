# Studio Shell Notes

The studio shell currently keeps Express 4 for compatibility with the wildcard route patterns used by the browser studio fallback and existing API routes. Async route handlers should continue to catch expected failures directly or forward unexpected errors with `next(error)` until an Express 5 migration is handled as its own compatibility pass.

The TUI and browser studio open on the Components workbench by default. That is intentional for this shell because component selection is the first step for the current edit, preview, diff, and backup workflows. Guarding navigation away from unapplied previews remains a follow-up for the preview workflow rather than part of the shell dependency patch.
