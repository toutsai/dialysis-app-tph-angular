// Use SheetJS' Node entry point so filesystem and legacy codepages remain available.
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

export default XLSX
