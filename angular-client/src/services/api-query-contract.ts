export type ApiQueryParams = Record<string, string | number | null | undefined>;

/** REST managers cannot interpret legacy Firestore constraints. */
export function assertNoQueryConstraints(value: unknown): void {
  if (value !== undefined && (!Array.isArray(value) || value.length !== 0)) {
    throw new TypeError('fetchAll only accepts no argument or []; use fetchWhere({ field: value }) for REST query parameters.');
  }
}

export function cleanApiQueryParams(params: ApiQueryParams): Record<string, string> {
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    throw new TypeError('fetchWhere requires a query parameter object.');
  }
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new TypeError('fetchWhere values must be strings, finite numbers, null or undefined.');
    }
    entries.push([key, String(value)]);
  }
  return Object.fromEntries(entries);
}
