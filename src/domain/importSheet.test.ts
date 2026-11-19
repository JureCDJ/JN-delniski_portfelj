import { describe, expect, it } from 'vitest';
import { buildLedger } from './portfolio';
import { brokerFromPlatform, buildSheetTrades, parseCsv, parseIsinMap, parseSlAmount, parseSlDate } from './importSheet';

// Sintetični podatki v obliki tabele »JN Delnice« — ne pravi posli.
const NAKUPI = `ID,Datum nakupa,Ticker,Naziv,Količina,Nakupna cena (€),Skupaj (€),Platforma,Valuta nakupa,Opomba
1,06.03.2025,AAA,Podjetje A,"10,5000","10,00 €","105,00 €",Drugo,EUR,
2,07.03.2025,ENR,Prvo Energy,"2,0000","1.198,50 €","2.397,01 €",IBKR (Interactive Brokers),USD,
3,08.03.2025,ENR,Drugo Holdings,"1,0000","5,00 €","5,00 €",Drugo,EUR,
4,09.03.2025,ZZZ,Brez ISIN,"1,0000","1,00 €","1,00 €",Drugo,EUR,`;

const PRODAJE = `ID,Posel ID,Datum prodaje,Ticker,Naziv,Količina,Prodajna cena (€),Prodajna vrednost (€),Platforma
1,1,28.06.2026,AAA,Podjetje A,"10,5000","12,00 €","126,00 €",N26`;

const MAP = parseIsinMap(`Ticker;Naziv;Predlagan ISIN;Status;Opomba
AAA;Podjetje A;US0378331005;OK;
ENR;Prvo Energy;DE000ENER6Y0;OK;
ENR;Drugo Holdings;US29272W1099;OK;
ZZZ;Brez ISIN;;MANJKA;`);

describe('razčlenjevanje tabele', () => {
  it('CSV z narekovaji in vejicami', () => {
    const rows = parseCsv(NAKUPI);
    expect(rows).toHaveLength(4);
    expect(rows[1]!['Skupaj (€)']).toBe('2.397,01 €');
  });
  it('datumi in zneski', () => {
    expect(parseSlDate('6.3.2025')).toBe('2025-03-06');
    expect(() => parseSlDate('31.02.2025')).toThrow();
    expect(parseSlAmount('1.198,50 €').toString()).toBe('1198.5');
    expect(parseSlAmount('−17,87 €').toString()).toBe('-17.87');
  });
  it('platforme', () => {
    expect(brokerFromPlatform('Drugo')).toBe('N26');
    expect(brokerFromPlatform('IBKR (Interactive Brokers)')).toBe('IBKR');
    expect(() => brokerFromPlatform('Revolut')).toThrow();
  });
});

describe('pretvorba v posle', () => {
  const { trades, skipped } = buildSheetTrades(parseCsv(NAKUPI), parseCsv(PRODAJE), MAP);

  it('isti ticker, različno podjetje → različen ISIN', () => {
    const enr = trades.filter((t) => t.ticker === 'ENR').map((t) => t.isin);
    expect(new Set(enr).size).toBe(2);
  });
  it('vrstica brez ISIN se ne uvozi tiho, ampak je navedena', () => {
    expect(skipped).toEqual([{ ref: 'NAKUP-4', reason: 'ni ISIN za ZZZ (Brez ISIN)' }]);
  });
  it('nabavna vrednost = znesek »Skupaj«, ne zaokrožena cena × količina', () => {
    const t = trades.find((x) => x.sourceRef === 'NAKUP-2')!;
    expect(t.totalEur).toBe('2397.01');
    expect(t.originalCurrency).toBe('USD');
    const { openLots } = buildLedger([t]);
    expect(openLots[0]!.costEur.toDecimalPlaces(2).toString()).toBe('2397.01');
  });
  it('prodaja zapre loto, dobiček se ujema s tabelo', () => {
    const { disposals, openLots } = buildLedger(trades);
    expect(disposals).toHaveLength(1);
    expect(disposals[0]!.gainEur.toDecimalPlaces(2).toString()).toBe('21');
    expect(openLots.find((l) => l.isin === 'US0378331005')).toBeUndefined();
  });
  it('stabilni ključi za ponovni uvoz', () => {
    expect(trades.map((t) => t.sourceRef)).toEqual(['NAKUP-1', 'NAKUP-2', 'NAKUP-3', 'PRODAJA-1']);
  });
});
