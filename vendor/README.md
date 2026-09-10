# SheetJS Community Edition

`xlsx-0.20.3.tgz` is the unmodified official SheetJS release archive, vendored so
installing this branch does not depend on the SheetJS CDN being reachable from
the hospital. Both package manifests use this same archive; npm lockfiles pin
its SHA-512 integrity value.

- Source: https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
- Installation guidance: https://docs.sheetjs.com/docs/getting-started/installation/nodejs/
- Downloaded: 2026-09-11
- SHA-256: `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`
- License: Apache-2.0 (license and notices included in the archive)

This replaces npm's `xlsx 0.18.5`, affected by CVE-2023-30533 and
CVE-2024-22363. Keep the archive, both manifests, lockfiles and spreadsheet
compatibility tests in sync when upgrading. The Node wrapper uses the CommonJS
entry point for filesystem/codepage support; browser callers use a lazy loader
that registers legacy codepages.
