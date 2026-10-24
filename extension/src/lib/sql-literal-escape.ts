/** Escape a value for use inside a SQL single-quoted string literal. */
export function escapeSqlStringLiteral(value: string): string {
  return value.replace(/'/g, "''");
}
