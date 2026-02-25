# AI Agent Instructions

- **Changelog Maintenance**: Every time a change is made to the codebase, the [CHANGELOG.md](file:///c:/Users/javse/rybak.Software/bolivar-flow/CHANGELOG.md) file MUST be updated with a summary of the changes, following the standard format (Added, Fixed, Changed, Removed).
- **Vercel Compatibility**: Be aware that the filesystem is read-only on Vercel. Any code that writes to `src/data` must be wrapped in `try-catch` blocks and fail gracefully without crashing the API.
- **Timezone Awareness**: Always use Venezuela time (`America/Caracas`) for date logic to avoid UTC offset issues (e.g., at 8:00 PM VET when UTC advances to the next day).
