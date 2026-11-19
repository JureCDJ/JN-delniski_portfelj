import Decimal from 'decimal.js';
import type { DivYear, InventorySheet } from './taxReturns';

// Datoteke XML za uvoz v eDavki (Dokumenti → Uvoz). Struktura po uradnih shemah FURS:
//   Doh_KDVP_9.xsd (velja od leta 2013) in Doh_Div_3.xsd (od leta 2020), skupna glava EDP-Common-1.xsd.
// Kopije shem so v docs/edavki/ — test preveri ustvarjene datoteke z xmllint.
// Pravila polj (Doh-Div) po »Navodilo za pripravo in uvoz dokumenta (XML) v napoved za odmero
// dohodnine od dividend« (FURS): davčna številka obvezna; vrsta dokumenta O = original;
// naziv in naslov izplačevalca obvezna; država dvomestno; šifra vrste dividende 1 = dividende;
// zneski v EUR na dve decimalki; tuji davek obvezen za tujega izplačevalca.

const NS_EDP = 'http://edavki.durs.si/Documents/Schemas/EDP-Common-1.xsd';

export class XmlExportError extends Error {}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Decimalno število brez eksponenta, največ `dp` decimalk, brez odvečnih ničel. */
function num(v: Decimal, dp: number): string {
  return v.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toFixed();
}

/** Znesek na dve decimalki (FURS: zaokroženo na dve decimalni mesti). */
function amount(v: Decimal): string {
  return v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

export function validTaxNumber(raw: string): boolean {
  return /^[1-9][0-9]{7}$/.test(raw.trim());
}

function header(taxNumber: string): string {
  if (!validTaxNumber(taxNumber)) throw new XmlExportError('Davčna številka mora imeti 8 števk.');
  return [
    '  <edp:Header>',
    '    <edp:taxpayer>',
    `      <edp:taxNumber>${taxNumber.trim()}</edp:taxNumber>`,
    '      <edp:taxpayerType>FO</edp:taxpayerType>',
    '    </edp:taxpayer>',
    '    <edp:Workflow>',
    '      <edp:DocumentWorkflowID>O</edp:DocumentWorkflowID>',
    '    </edp:Workflow>',
    '  </edp:Header>',
    '  <edp:Signatures />',
  ].join('\n');
}

// ───────────────────────────── Doh-KDVP ─────────────────────────────

export interface KdvpXmlInput {
  taxNumber: string;
  year: number;
  sheets: InventorySheet[];
  /** Oznaka (≤ 10 znakov) in naziv (≤ 100 znakov) po ISIN. */
  names: Map<string, { code: string; name: string; isFund: boolean }>;
}

export function buildKdvpXml(input: KdvpXmlInput): string {
  const { taxNumber, year, sheets, names } = input;
  if (!sheets.length) throw new XmlExportError(`Za leto ${year} ni prodaj.`);
  const items = sheets.map((s, i) => {
    const n = names.get(s.isin);
    const rows = s.rows.map((r, j) => {
      const body =
        r.kind === 'NAKUP'
          ? [
              '              <Purchase>',
              `                <F1>${r.date}</F1>`,
              '                <F2>B</F2>',
              `                <F3>${num(r.quantity, 8)}</F3>`,
              `                <F4>${num(r.unitEur, 8)}</F4>`,
              '              </Purchase>',
            ]
          : [
              '              <Sale>',
              `                <F6>${r.date}</F6>`,
              `                <F7>${num(r.quantity, 8)}</F7>`,
              `                <F9>${num(r.unitEur, 8)}</F9>`,
              '              </Sale>',
            ];
      return ['            <Row>', `              <ID>${j}</ID>`, ...body, `              <F8>${num(r.stock, 8)}</F8>`, '            </Row>'].join('\n');
    });
    return [
      '      <KDVPItem>',
      `        <ItemID>${i + 1}</ItemID>`,
      '        <InventoryListType>PLVP</InventoryListType>',
      `        <Name>${esc((n?.name ?? s.isin).slice(0, 100))}</Name>`,
      '        <HasForeignTax>false</HasForeignTax>',
      '        <HasLossTransfer>false</HasLossTransfer>',
      '        <ForeignTransfer>false</ForeignTransfer>',
      '        <TaxDecreaseConformance>false</TaxDecreaseConformance>',
      '        <Securities>',
      `          <ISIN>${esc(s.isin)}</ISIN>`,
      n?.code ? `          <Code>${esc(n.code.slice(0, 10))}</Code>` : null,
      `          <Name>${esc((n?.name ?? s.isin).slice(0, 100))}</Name>`,
      `          <IsFond>${n?.isFund ? 'true' : 'false'}</IsFond>`,
      ...rows,
      '        </Securities>',
      '      </KDVPItem>',
    ]
      .filter((x) => x !== null)
      .join('\n');
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Envelope xmlns="http://edavki.durs.si/Documents/Schemas/Doh_KDVP_9.xsd" xmlns:edp="${NS_EDP}">`,
    header(taxNumber),
    '  <body>',
    '    <edp:bodyContent />',
    '    <Doh_KDVP>',
    '      <KDVP>',
    '        <DocumentWorkflowID>O</DocumentWorkflowID>',
    `        <Year>${year}</Year>`,
    `        <PeriodStart>${year}-01-01</PeriodStart>`,
    `        <PeriodEnd>${year}-12-31</PeriodEnd>`,
    '        <IsResident>true</IsResident>',
    `        <SecurityCount>${sheets.length}</SecurityCount>`,
    '        <SecurityShortCount>0</SecurityShortCount>',
    '        <SecurityWithContractCount>0</SecurityWithContractCount>',
    '        <SecurityWithContractShortCount>0</SecurityWithContractShortCount>',
    '        <ShareCount>0</ShareCount>',
    '      </KDVP>',
    ...items,
    '    </Doh_KDVP>',
    '  </body>',
    '</Envelope>',
    '',
  ].join('\n');
}

// ───────────────────────────── Doh-Div ─────────────────────────────

export interface Payer {
  name: string | null;
  address: string | null;
  country: string | null;
  id: string | null;
}

/** Kaj manjka za izplačevalca (prazno = popolno). Pravila po navodilu FURS za XML Doh-Div. */
export function missingPayerFields(p: Payer | undefined): string[] {
  const out: string[] = [];
  if (!p?.name?.trim()) out.push('naziv');
  if (!p?.address?.trim()) out.push('naslov');
  if (!p?.country || !/^[A-Z]{2}$/.test(p.country)) out.push('država');
  else if (p.country !== 'SI' && !p.id?.trim()) out.push('identifikacijska številka');
  return out;
}

export interface DivXmlInput {
  taxNumber: string;
  div: DivYear;
  payers: Map<string, Payer>;
  email?: string;
  phone?: string;
}

export function buildDivXml(input: DivXmlInput): string {
  const { taxNumber, div, payers } = input;
  if (!div.rows.length) throw new XmlExportError(`Za leto ${div.year} ni dividend.`);
  const problems: string[] = [];
  for (const r of div.rows) {
    const miss = missingPayerFields(payers.get(r.isin));
    if (miss.length) problems.push(`${r.isin}: manjka ${miss.join(', ')}`);
    if (r.grossEur.lte(0)) problems.push(`${r.isin} ${r.date}: znesek dividende mora biti večji od 0`);
  }
  if (problems.length) throw new XmlExportError(`Podatki niso popolni — ${[...new Set(problems)].join('; ')}.`);

  const rows = div.rows.map((r) => {
    const p = payers.get(r.isin)!;
    const foreign = p.country !== 'SI';
    return [
      '    <Dividend>',
      `      <Date>${r.date}</Date>`,
      foreign ? `      <PayerIdentificationNumber>${esc(p.id!.trim())}</PayerIdentificationNumber>` : null,
      `      <PayerName>${esc(p.name!.trim())}</PayerName>`,
      `      <PayerAddress>${esc(p.address!.trim())}</PayerAddress>`,
      `      <PayerCountry>${p.country}</PayerCountry>`,
      '      <Type>1</Type>',
      `      <Value>${amount(r.grossEur)}</Value>`,
      foreign ? `      <ForeignTax>${amount(r.foreignTaxEur)}</ForeignTax>` : null,
      `      <SourceCountry>${r.isin.slice(0, 2)}</SourceCountry>`,
      '    </Dividend>',
    ]
      .filter((x) => x !== null)
      .join('\n');
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Envelope xmlns="http://edavki.durs.si/Documents/Schemas/Doh_Div_3.xsd" xmlns:edp="${NS_EDP}">`,
    header(taxNumber),
    '  <body>',
    '    <Doh_Div>',
    `      <Period>${div.year}</Period>`,
    input.email ? `      <EmailAddress>${esc(input.email)}</EmailAddress>` : null,
    input.phone ? `      <PhoneNumber>${esc(input.phone)}</PhoneNumber>` : null,
    '    </Doh_Div>',
    ...rows,
    '  </body>',
    '</Envelope>',
    '',
  ]
    .filter((x) => x !== null)
    .join('\n');
}
