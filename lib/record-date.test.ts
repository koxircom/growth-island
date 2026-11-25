import { it, expect } from 'vitest';
import { validRecordDate } from './record-date';
it('accepts today and actual past calendar days including leap days', () => {
  for (const day of ['2026-11-11','2026-11-10','2024-02-29','2000-02-29']) expect(validRecordDate(day,'2026-11-11')).toBe(true);
});
it('rejects future, empty, malformed and impossible calendar dates', () => {
  for (const day of ['2026-11-12','2027-01-01','','2026-2-2','2026-02-29','1900-02-29','2026-04-31','2026-00-01','2026-01-00','0000-01-01','2026-11-11T00:00:00Z',' 2026-11-11']) expect(validRecordDate(day,'2026-11-11')).toBe(false);
});
