/**
 * Fixture generator for header detection tests.
 * Run once to create XLSX files. Tests use inline Buffer creation instead
 * so no pre-built fixtures are needed on disk — this file is documentation.
 *
 * Fixtures described here are created inline in the test using xlsx.
 */

export const FIXTURES = {
  /** Sberbank-style: 3 metadata rows, then header at row 3 */
  SBERBANK: 'sberbank.xlsx',
  /** Simple CSV with UTF-8 header at row 0 */
  SIMPLE_CSV: 'simple.csv',
  /** Tinkoff-style: header at row 0, European amount format */
  TINKOFF: 'tinkoff.xlsx',
  /** CSV with Windows-1251 encoding */
  WIN1251_CSV: 'win1251.csv',
  /** File with no recognisable table (free-text) */
  NO_TABLE: 'no_table.csv',
  /** Amount in comma format with space thousands separator */
  SPACE_COMMA: 'space_comma.xlsx',
};
