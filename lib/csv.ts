/** Quote fields and neutralize spreadsheet formulas, including leading whitespace. */
export function csvCell(value: unknown) {
  return '"' + String(value ?? '').replace(/^[\t\r\n ]*[=+@-]/, "'$&").replaceAll('"', '""') + '"';
}
