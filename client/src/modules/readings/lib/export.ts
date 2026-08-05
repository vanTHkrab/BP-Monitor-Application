/**
 * Pure builders for the readings export: CSV bodies, PDF report HTML, and
 * filenames. Ported from `client-old/utils/export-report.ts`.
 *
 * **No expo / file-system imports here.** Everything is deterministic and
 * takes a `Reading[]`, which is what makes it testable — and this is output
 * someone may hand to a clinician, so it is tested rather than eyeballed. The
 * I/O and the share sheet live in `../services/export-file.ts`.
 *
 * Three things the old file did that this one does not:
 *
 *   - **Community posts.** `buildPostsCsv` / `buildPostsPdfHtml` are not
 *     ported. This module is readings; a posts export belongs to
 *     `modules/community` if anyone asks for it.
 *   - **The `anonymize` flag.** It branched every builder and every column
 *     list, and nothing in this tree offers a way to turn it on. Carrying a
 *     mode with no caller is the "might be useful later" dependency root
 *     CLAUDE.md rule 13 exists to prevent, one level down. Re-add it with the
 *     UI that needs it, not before.
 *   - **A raw image path column.** client-old wrote `r.imageUri` into the CSV.
 *     That is a `file://` path inside this app's sandbox: dead on any other
 *     device, and meaningless in a file whose whole purpose is to leave the
 *     device. This writes whether a photo exists instead.
 */
import { colorsFor, palette } from '@/theme';
import { formatFileDate, formatThaiDate, formatThaiDateTime } from '@/utils/thai-date';

import type { Reading } from '../types';
import { statusColorFor, statusLabel } from './status';

/**
 * UTF-8 byte-order mark. Excel on Windows sniffs it to decode the file as
 * UTF-8; without it every Thai character renders as mojibake, and the person
 * opening the file is a patient or a clinician, not a developer.
 */
export const CSV_BOM = '﻿';

const APP_NAME = 'BP Monitor';

const REPORT_TITLE = 'รายงานค่าความดันโลหิต';

/**
 * Inline copy of `assets/images/logo.svg`.
 *
 * Embedded as a string rather than resolved from the bundle because
 * `expo-print` renders the HTML in an isolated WebView with no access to the
 * app's assets — and because a `<img src="https://…">` renders blank offline,
 * which is exactly when someone is most likely to be exporting. Keep in sync
 * with the asset if the logo is redesigned.
 */
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1024" y2="1024" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#72DDF4"/>
      <stop offset="0.55" stop-color="#7E57C2"/>
      <stop offset="1" stop-color="#5E35B1"/>
    </linearGradient>
    <radialGradient id="highlight" cx="0.3" cy="0.2" r="0.7">
      <stop offset="0" stop-color="rgba(255,255,255,0.18)"/>
      <stop offset="1" stop-color="rgba(255,255,255,0)"/>
    </radialGradient>
    <clipPath id="iconClip">
      <rect width="1024" height="1024" rx="225" ry="225"/>
    </clipPath>
  </defs>
  <g clip-path="url(#iconClip)">
    <rect width="1024" height="1024" fill="url(#bgGrad)"/>
    <rect width="1024" height="1024" fill="url(#highlight)"/>
    <g transform="translate(512, 512)">
      <path d="M0,200 C-180,90 -310,-30 -240,-160 C-180,-260 -80,-240 0,-130 C80,-240 180,-260 240,-160 C310,-30 180,90 0,200 Z" fill="rgba(255,255,255,0.97)"/>
    </g>
    <g transform="translate(0, 540)" fill="none" stroke="#FFB26B" stroke-width="36" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="170,0 360,0 410,-90 470,150 550,-150 620,90 680,0 854,0"/>
    </g>
  </g>
</svg>`;

export const REPORT_LOGO_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(LOGO_SVG)}`;

/**
 * System Thai-capable fonts only — no webfont `@import`. The PDF must render
 * offline, and a font that fails to load falls back to one with no Thai
 * glyphs, which prints boxes.
 */
const PDF_FONT_STACK =
  "'Sarabun', 'Noto Sans Thai', 'Thonburi', 'Helvetica Neue', Arial, sans-serif";

/** Shown in the attribution column for a reading the patient entered themselves. */
const SELF_RECORDED_LABEL = 'ผู้ป่วย';

// ── Escaping ──────────────────────────────────────────────────────────────

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  // Quote only when required, so an unremarkable field stays readable raw.
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Shared derivations ────────────────────────────────────────────────────

/** Earliest and latest measurement in the set. `null` when there is nothing. */
export function readingsPeriod(readings: Reading[]): { start: Date; end: Date } | null {
  let start: Date | null = null;
  let end: Date | null = null;

  for (const reading of readings) {
    const at = reading.measuredAt;
    if (Number.isNaN(at.getTime())) continue;
    if (!start || at < start) start = at;
    if (!end || at > end) end = at;
  }

  return start && end ? { start, end } : null;
}

/**
 * The attribution column appears only when at least one row was logged by
 * someone else. A column reading "ผู้ป่วย" on every line of a patient's own
 * export is noise.
 */
const hasAttribution = (readings: Reading[]): boolean =>
  readings.some((reading) => Boolean(reading.recordedByName));

const recordedByLabel = (reading: Reading): string =>
  reading.recordedByName || SELF_RECORDED_LABEL;

// ── Filenames ─────────────────────────────────────────────────────────────

/**
 * Filesystem-safe name segment. Thai characters are kept — iOS and Android
 * both use UTF-8 filenames — and only the reserved punctuation is stripped.
 * Capped at 40 characters so a long name cannot push the period out of view
 * in a share sheet.
 */
export function sanitizeFileNameSegment(value: string): string {
  return value
    .replace(/[\\/:*?"<>|#%&{}$!'`@+=,;]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

export type ExportFileNameOptions = {
  readings: Reading[];
  /** Whose readings these are. See `resolveExportSubjectName`. */
  subjectName?: string | null;
  /** Injectable for tests, and for the empty-set fallback below. */
  now?: Date;
};

/**
 * Base filename, no extension: says *whose* data and *what period*.
 * e.g. `BP-Report_สมชาย-ใจดี_20260601-20260710`.
 *
 * A share sheet shows the filename and nothing else — `export.csv` sitting in
 * a chat thread is unidentifiable a week later. The name segment is dropped
 * when unknown rather than replaced with a placeholder.
 */
export function buildExportFileName({
  readings,
  subjectName,
  now = new Date(),
}: ExportFileNameOptions): string {
  const nameSegment = subjectName ? sanitizeFileNameSegment(subjectName) : '';
  const period = readingsPeriod(readings);
  const periodSegment = period
    ? `${formatFileDate(period.start)}-${formatFileDate(period.end)}`
    : formatFileDate(now);

  return ['BP-Report', nameSegment, periodSegment].filter(Boolean).join('_');
}

// ── CSV ───────────────────────────────────────────────────────────────────

/**
 * Row order is the caller's, not this function's: both callers export what is
 * on screen, and the app lists readings newest-first. Re-sorting here would
 * hand back a file in an order the user never saw.
 */
export function buildReadingsCsv(readings: Reading[]): string {
  const withRecorder = hasAttribution(readings);

  const header = [
    'ID',
    'วันที่-เวลา (Date-Time)',
    'ค่าบน SYS (mmHg)',
    'ค่าล่าง DIA (mmHg)',
    'ชีพจร (Pulse)',
    'สถานะ (Status)',
    ...(withRecorder ? ['บันทึกโดย (Recorded By)'] : []),
    'หมายเหตุ (Notes)',
    'รูปภาพ (Image)',
  ];

  const rows = readings.map((reading) => [
    // Blank for a reading still in the offline queue: it genuinely has no
    // server id yet, and inventing one would make two exports disagree.
    reading.remoteId ?? '',
    formatThaiDateTime(reading.measuredAt),
    reading.systolic,
    reading.diastolic,
    reading.pulse,
    statusLabel(reading.status),
    ...(withRecorder ? [recordedByLabel(reading)] : []),
    reading.notes ?? '',
    reading.imageUri || reading.s3Key ? 'มี' : '',
  ]);

  return (
    CSV_BOM +
    [header.join(','), ...rows.map((row) => row.map(csvEscape).join(','))].join('\n')
  );
}

// ── PDF HTML ──────────────────────────────────────────────────────────────

/** Print is always the light palette, whatever the in-app theme is set to. */
const PRINT = colorsFor('light');

const PDF_COLORS = {
  text: PRINT['text-primary'],
  textMuted: PRINT['text-secondary'],
  accent: palette.purple,
  zebra: PRINT['surface-muted'],
  border: PRINT.border,
};

const pdfShellStyles = `
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    font-family: ${PDF_FONT_STACK};
    color: ${PDF_COLORS.text};
    margin: 0;
    padding: 28px 32px;
    font-size: 12px;
    line-height: 1.5;
  }
  .report-header {
    display: flex;
    align-items: center;
    gap: 14px;
    padding-bottom: 14px;
    border-bottom: 2px solid ${PDF_COLORS.accent};
    margin-bottom: 14px;
  }
  .report-logo { width: 48px; height: 48px; }
  .report-title { font-size: 19px; font-weight: 700; margin: 0; }
  .report-subtitle { font-size: 11px; color: ${PDF_COLORS.textMuted}; margin: 2px 0 0; }
  .report-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 24px;
    margin: 0 0 16px;
    padding: 0;
    list-style: none;
    font-size: 11.5px;
  }
  .report-meta .label { color: ${PDF_COLORS.textMuted}; margin-right: 6px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 11.5px; }
  /* Repeats the header on every printed page rather than only the first. */
  thead { display: table-header-group; }
  th {
    text-align: left;
    font-weight: 700;
    padding: 7px 8px;
    border-bottom: 2px solid ${PDF_COLORS.accent};
    white-space: nowrap;
  }
  td {
    padding: 6px 8px;
    border-bottom: 1px solid ${PDF_COLORS.border};
    vertical-align: top;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  tr { page-break-inside: avoid; }
  tbody tr:nth-child(even) td { background: ${PDF_COLORS.zebra}; }
  .num { text-align: center; font-variant-numeric: tabular-nums; }
  th.num { text-align: center; }
  .status-chip {
    display: inline-block;
    padding: 1px 9px;
    border-radius: 999px;
    font-size: 10.5px;
    font-weight: 700;
    white-space: nowrap;
  }
  .empty-note {
    padding: 24px 0;
    text-align: center;
    color: ${PDF_COLORS.textMuted};
  }
  .report-footer {
    margin-top: 20px;
    padding-top: 10px;
    border-top: 1px solid ${PDF_COLORS.border};
    font-size: 10px;
    color: ${PDF_COLORS.textMuted};
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
`;

const metaItemHtml = (label: string, value: string): string =>
  `<li><span class="label">${escapeHtml(label)}</span>${escapeHtml(value)}</li>`;

const statusChipHtml = (status: Reading['status']): string => {
  const color = statusColorFor(status);
  // 12% alpha tint of the status token — derived from it, not a new colour.
  return `<span class="status-chip" style="color: ${color}; background: ${color}1F;">${escapeHtml(
    statusLabel(status),
  )}</span>`;
};

export type ReadingsPdfOptions = {
  subjectName?: string | null;
  /** Injectable so the generated-at line is assertable. */
  now?: Date;
};

export function buildReadingsPdfHtml(
  readings: Reading[],
  { subjectName, now = new Date() }: ReadingsPdfOptions = {},
): string {
  const period = readingsPeriod(readings);
  const withRecorder = hasAttribution(readings);

  const metaItems = [
    metaItemHtml('ผู้ป่วย', subjectName || '-'),
    metaItemHtml(
      'ช่วงข้อมูล',
      period ? `${formatThaiDate(period.start)} – ${formatThaiDate(period.end)}` : '-',
    ),
    metaItemHtml('จำนวน', `${readings.length} รายการ`),
    metaItemHtml('สร้างเมื่อ', formatThaiDateTime(now)),
  ].join('');

  // Fixed layout: the numeric columns stay compact and notes absorb the rest,
  // instead of the browser widening columns around whichever note is longest.
  const colgroup = `
    <colgroup>
      <col style="width: 20%" />
      <col style="width: 9%" />
      <col style="width: 9%" />
      <col style="width: 9%" />
      <col style="width: 14%" />
      ${withRecorder ? '<col style="width: 15%" />' : ''}
      <col />
    </colgroup>
  `;

  const columnCount = withRecorder ? 7 : 6;

  const rows = readings.length
    ? readings
        .map(
          (reading) => `
        <tr>
          <td>${escapeHtml(formatThaiDateTime(reading.measuredAt))}</td>
          <td class="num">${escapeHtml(reading.systolic)}</td>
          <td class="num">${escapeHtml(reading.diastolic)}</td>
          <td class="num">${escapeHtml(reading.pulse)}</td>
          <td>${statusChipHtml(reading.status)}</td>
          ${withRecorder ? `<td>${escapeHtml(recordedByLabel(reading))}</td>` : ''}
          <td>${escapeHtml(reading.notes ?? '')}</td>
        </tr>
      `,
        )
        .join('')
    : // Both callers refuse to export an empty set, so this is a guard rather
      // than a flow — but a valid one-page document beats a table with a
      // header and nothing under it if one ever gets here.
      `<tr><td class="empty-note" colspan="${columnCount}">ไม่มีข้อมูลในช่วงที่เลือก</td></tr>`;

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>${pdfShellStyles}</style>
      </head>
      <body>
        <header class="report-header">
          <img class="report-logo" src="${REPORT_LOGO_DATA_URI}" alt="" />
          <div>
            <h1 class="report-title">${escapeHtml(REPORT_TITLE)}</h1>
            <p class="report-subtitle">${APP_NAME}</p>
          </div>
        </header>
        <ul class="report-meta">${metaItems}</ul>
        <table>
          ${colgroup}
          <thead>
            <tr>
              <th>วันที่-เวลา</th>
              <th class="num">SYS</th>
              <th class="num">DIA</th>
              <th class="num">ชีพจร</th>
              <th>สถานะ</th>
              ${withRecorder ? '<th>บันทึกโดย</th>' : ''}
              <th>หมายเหตุ</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
        <footer class="report-footer">
          <span>สร้างโดยแอป ${APP_NAME} • ${escapeHtml(formatThaiDateTime(now))}</span>
          <span>เอกสารนี้สร้างจากข้อมูลที่ผู้ใช้บันทึก ไม่ใช่เอกสารวินิจฉัยทางการแพทย์</span>
        </footer>
      </body>
    </html>
  `;
}

// ── Whose data is this ────────────────────────────────────────────────────

export type ExportSubjectUser = {
  role: string;
  firstname?: string | null;
  lastname?: string | null;
};

export type ExportSubjectPatient = {
  firstname?: string | null;
  lastname?: string | null;
};

/**
 * The name that goes in the report header and the filename.
 *
 * **This is the one that attributes blood pressure to a person, so it is not
 * "the logged-in user".** When a caregiver is viewing an active patient, the
 * readings on screen are that patient's — `useReadings` queries with their id
 * — so the document has to carry the patient's name. Getting this wrong files
 * one person's medical data under another person's name.
 *
 * Falls back to the signed-in user, then to `undefined`, which drops the name
 * segment from the filename entirely rather than labelling the file with a
 * guess.
 */
export function resolveExportSubjectName(
  user: ExportSubjectUser | null | undefined,
  activePatient: ExportSubjectPatient | null | undefined,
): string | undefined {
  if (user?.role === 'caregiver' && activePatient) {
    const name = `${activePatient.firstname ?? ''} ${activePatient.lastname ?? ''}`.trim();
    if (name) return name;
  }

  if (!user) return undefined;
  const name = `${user.firstname ?? ''} ${user.lastname ?? ''}`.trim();
  return name || undefined;
}
