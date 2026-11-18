// Datumi poslov so koledarski datumi 'YYYY-MM-DD' — brez ure in časovnega pasu.
// Nikoli ne uporabljaj new Date(...).toISOString(): ob polnoči lahko premakne dan.

export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIsoDate(d: IsoDate): { y: number; m: number; day: number } {
  const match = ISO_DATE.exec(d);
  if (!match) throw new Error(`Neveljaven datum: "${d}" (pričakovano YYYY-MM-DD)`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (m < 1 || m > 12 || day < 1 || day > daysInMonth) {
    throw new Error(`Neveljaven datum: "${d}"`);
  }
  return { y, m, day };
}

/** Število polnih let med datumoma (obletnica šteje kot dopolnjeno leto). */
export function fullYearsBetween(from: IsoDate, to: IsoDate): number {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  let years = b.y - a.y;
  if (b.m < a.m || (b.m === a.m && b.day < a.day)) years -= 1;
  return Math.max(0, years);
}

export function compareIsoDate(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 'YYYY-MM-DD' → 'DD.MM.YYYY' */
export function formatDateSl(d: IsoDate): string {
  const { y, m, day } = parseIsoDate(d);
  return `${String(day).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
}
