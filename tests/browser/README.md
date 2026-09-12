# Critical browser workflows

Run `npm run build:angular`, `npx playwright install chromium`, then `npm run test:browser`.
CI installs Linux Chromium system dependencies separately and builds the same application.

The fixture starts real backend routers and the compiled Angular application on a random loopback port.
It creates a unique SQLite database and backup directory under the operating system temporary directory,
uses synthetic users/items only, and refuses outbound browser/server requests. No schedulers, dotenv
configuration, external HIS connection, or existing application database are loaded. Credentials and
session tokens remain in fixture memory; traces are disabled. Failure screenshots contain synthetic data.
The fixture validates its temporary directory before cleanup. Test time is fixed to 2026-09-14 in Taipei.

Coverage: note save/update/history metadata and lazy detail/selected restore/reload; administrator verified
manual backup; non-administrator route and API rejection; end-of-day physical count with same-day receipt;
item dialog Escape/focus return. Every page records uncaught runtime errors. These tests do not replace
the isolated database recovery/WAL and transaction-failure tests in `tests/backup-integrity.test.mjs`.
