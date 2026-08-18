/**
 * The export is a document someone may hand to a clinician, so the things
 * asserted here are the ones that make it wrong rather than ugly: the BOM
 * Excel needs to read Thai, the filename that says whose data it is, the
 * subject name when a caregiver is the one exporting, and escaping — a note
 * containing a comma or a `<` must not be able to shift a column or break the
 * report's markup.
 */
import type { Reading } from '../types';
import {
  CSV_BOM,
  buildExportFileName,
  buildReadingsCsv,
  buildReadingsPdfHtml,
  csvEscape,
  escapeHtml,
  readingsPeriod,
  resolveExportSubjectName,
  sanitizeFileNameSegment,
} from './export';

function makeReading(overrides: Partial<Reading> = {}): Reading {
  return {
    key: 'remote-1',
    remoteId: 1,
    userId: 'u1',
    systolic: 118,
    diastolic: 76,
    pulse: 70,
    measuredAt: new Date(2026, 6, 10, 21, 52),
    status: 'normal',
    createdAt: new Date(2026, 6, 10, 21, 52),
    syncState: 'synced',
    ...overrides,
  };
}

/** The data rows of a CSV, with the BOM and the header line removed. */
function csvRows(csv: string): string[] {
  return csv.replace(CSV_BOM, '').split('\n').slice(1);
}

describe('csvEscape', () => {
  it('leaves an ordinary field unquoted', () => {
    expect(csvEscape('ปกติ')).toBe('ปกติ');
  });

  it.each([
    ['a,b', '"a,b"'],
    ['a\nb', '"a\nb"'],
    ['say "hi"', '"say ""hi"""'],
  ])('quotes %j', (input, expected) => {
    expect(csvEscape(input)).toBe(expected);
  });

  it('renders null and undefined as empty rather than the literal word', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });
});

describe('escapeHtml', () => {
  it('neutralises a tag so a note cannot inject markup into the report', () => {
    expect(escapeHtml('<script>x</script>')).toBe(
      '&lt;script&gt;x&lt;/script&gt;',
    );
  });

  it('escapes the ampersand first, so entities are not double-broken', () => {
    expect(escapeHtml('a & <b>')).toBe('a &amp; &lt;b&gt;');
  });
});

describe('readingsPeriod', () => {
  it('is null for an empty set', () => {
    expect(readingsPeriod([])).toBeNull();
  });

  it('finds the earliest and latest regardless of array order', () => {
    const period = readingsPeriod([
      makeReading({ measuredAt: new Date(2026, 5, 15) }),
      makeReading({ measuredAt: new Date(2026, 4, 1) }),
      makeReading({ measuredAt: new Date(2026, 6, 20) }),
    ]);

    expect(period?.start).toEqual(new Date(2026, 4, 1));
    expect(period?.end).toEqual(new Date(2026, 6, 20));
  });

  it('skips an unparseable date instead of poisoning the range', () => {
    const period = readingsPeriod([
      makeReading({ measuredAt: new Date(Number.NaN) }),
      makeReading({ measuredAt: new Date(2026, 4, 1) }),
    ]);

    expect(period?.start).toEqual(new Date(2026, 4, 1));
  });
});

describe('sanitizeFileNameSegment', () => {
  it('keeps Thai characters — both platforms use UTF-8 filenames', () => {
    expect(sanitizeFileNameSegment('สมชาย ใจดี')).toBe('สมชาย-ใจดี');
  });

  it('strips path separators so a name cannot escape the directory', () => {
    expect(sanitizeFileNameSegment('a/b\\c')).toBe('abc');
  });

  it('caps the length', () => {
    expect(sanitizeFileNameSegment('x'.repeat(80))).toHaveLength(40);
  });
});

describe('buildExportFileName', () => {
  it('says whose data and what period', () => {
    const name = buildExportFileName({
      readings: [
        makeReading({ measuredAt: new Date(2026, 5, 1) }),
        makeReading({ measuredAt: new Date(2026, 6, 10) }),
      ],
      subjectName: 'สมชาย ใจดี',
    });

    expect(name).toBe('BP-Report_สมชาย-ใจดี_20260601-20260710');
  });

  it('drops the name segment rather than guessing when there is no subject', () => {
    const name = buildExportFileName({
      readings: [makeReading({ measuredAt: new Date(2026, 6, 10) })],
    });

    expect(name).toBe('BP-Report_20260710-20260710');
  });

  it('falls back to today when there are no readings to date the file by', () => {
    const name = buildExportFileName({ readings: [], now: new Date(2026, 7, 5) });

    expect(name).toBe('BP-Report_20260805');
  });
});

describe('buildReadingsCsv', () => {
  it('starts with the BOM, or Excel renders every Thai column as mojibake', () => {
    expect(buildReadingsCsv([makeReading()]).startsWith(CSV_BOM)).toBe(true);
  });

  it('has a header row and one row per reading', () => {
    const csv = buildReadingsCsv([makeReading(), makeReading({ remoteId: 2 })]);

    expect(csv.replace(CSV_BOM, '').split('\n')).toHaveLength(3);
  });

  it('writes the Thai date and the status label, not the raw values', () => {
    const csv = buildReadingsCsv([makeReading({ status: 'high' })]);

    expect(csvRows(csv)[0]).toContain('10 ก.ค. 2569 21:52');
    expect(csvRows(csv)[0]).not.toContain('high');
  });

  it('leaves the ID blank for a reading still in the offline queue', () => {
    const csv = buildReadingsCsv([
      makeReading({ remoteId: undefined, clientId: 'local-1', syncState: 'queued' }),
    ]);

    expect(csvRows(csv)[0].startsWith(',')).toBe(true);
  });

  it('quotes a note containing a comma so it cannot shift a column', () => {
    const csv = buildReadingsCsv([makeReading({ notes: 'เช้า, ก่อนอาหาร' })]);

    expect(csvRows(csv)[0]).toContain('"เช้า, ก่อนอาหาร"');
    // 9 columns → 8 separating commas; the one inside the note is quoted.
    expect(csvRows(csv)[0].split(',')).toHaveLength(9);
  });

  it('omits the attribution column when every reading is self-entered', () => {
    const csv = buildReadingsCsv([makeReading()]);

    expect(csv).not.toContain('บันทึกโดย');
  });

  it('adds the attribution column as soon as one reading was logged by someone else', () => {
    const csv = buildReadingsCsv([
      makeReading(),
      makeReading({ remoteId: 2, recordedByName: 'พยาบาล ก' }),
    ]);

    expect(csv).toContain('บันทึกโดย');
    // The self-entered row is labelled rather than left blank, so a mixed
    // report cannot be read as "the nurse recorded all of these".
    expect(csvRows(csv)[0]).toContain('ผู้ป่วย');
    expect(csvRows(csv)[1]).toContain('พยาบาล ก');
  });

  it('reports whether a photo exists rather than a dead local file path', () => {
    const csv = buildReadingsCsv([
      makeReading({ imageUri: 'file:///data/user/0/app/cache/x.jpg' }),
    ]);

    expect(csv).not.toContain('file://');
    expect(csvRows(csv)[0].endsWith('มี')).toBe(true);
  });

  it('produces a valid header-only file for an empty set rather than crashing', () => {
    const csv = buildReadingsCsv([]);

    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.replace(CSV_BOM, '').split('\n')).toHaveLength(1);
  });
});

describe('buildReadingsPdfHtml', () => {
  const now = new Date(2026, 7, 5, 9, 30);

  it('embeds the logo instead of linking it, so the PDF renders offline', () => {
    const html = buildReadingsPdfHtml([makeReading()], { now });

    expect(html).toContain('src="data:image/png;base64,');
    expect(html).not.toMatch(/src="https?:/);
  });

  it('carries the subject name and the period in the header', () => {
    const html = buildReadingsPdfHtml([makeReading()], {
      subjectName: 'สมชาย ใจดี',
      now,
    });

    expect(html).toContain('สมชาย ใจดี');
    expect(html).toContain('10 ก.ค. 2569');
    expect(html).toContain('1 รายการ');
  });

  it('escapes a note, so it cannot inject markup into the report', () => {
    const html = buildReadingsPdfHtml([makeReading({ notes: '<b>x</b>' })], { now });

    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x</b>');
  });

  it('renders one row per reading', () => {
    const html = buildReadingsPdfHtml(
      [makeReading(), makeReading({ remoteId: 2, systolic: 145 })],
      { now },
    );

    expect(html.match(/<tr>/g)).toHaveLength(3); // header + 2 rows
    expect(html).toContain('145');
  });

  it('says so in the document when the range is empty, rather than printing a bare header', () => {
    const html = buildReadingsPdfHtml([], { now });

    expect(html).toContain('ไม่มีข้อมูลในช่วงที่เลือก');
  });

  it('always carries the not-a-diagnosis footer', () => {
    expect(buildReadingsPdfHtml([makeReading()], { now })).toContain(
      'ไม่ใช่เอกสารวินิจฉัยทางการแพทย์',
    );
  });
});

describe('resolveExportSubjectName', () => {
  const patient = { firstname: 'สมหญิง', lastname: 'รักดี' };

  it('names the patient when a caregiver is viewing one', () => {
    const name = resolveExportSubjectName(
      { role: 'caregiver', firstname: 'สมชาย', lastname: 'ใจดี' },
      patient,
    );

    // The readings on screen are the patient's; filing them under the
    // caregiver's name attributes one person's medical data to another.
    expect(name).toBe('สมหญิง รักดี');
  });

  it('names the caregiver when they are not viewing anyone', () => {
    const name = resolveExportSubjectName(
      { role: 'caregiver', firstname: 'สมชาย', lastname: 'ใจดี' },
      null,
    );

    expect(name).toBe('สมชาย ใจดี');
  });

  it('ignores an active patient for a patient account', () => {
    const name = resolveExportSubjectName(
      { role: 'patient', firstname: 'สมชาย', lastname: 'ใจดี' },
      patient,
    );

    expect(name).toBe('สมชาย ใจดี');
  });

  it('is undefined rather than a blank guess when there is no name to use', () => {
    expect(resolveExportSubjectName(null, null)).toBeUndefined();
    expect(
      resolveExportSubjectName({ role: 'patient', firstname: '', lastname: '' }, null),
    ).toBeUndefined();
  });
});
