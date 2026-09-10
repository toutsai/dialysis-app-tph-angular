These are synthetic compatibility fixtures generated with the project's previous
SheetJS 0.18.5. They contain no real patients or hospital data. `expected.json`
describes the first sheet of `legacy.xlsx` and `legacy.xls`; the latter uses
BIFF8. `legacy-big5.csv` is a CP950/Big5 input. Tests verify the Node and browser
entry points can preserve Chinese, leading-zero identifiers, zero/numeric values,
Excel date serial numbers, quotes, commas and multiple sheets after the upgrade.
