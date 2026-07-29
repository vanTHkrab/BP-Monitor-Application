// Pure builders for the data-export feature: CSV bodies, PDF report HTML,
// and export filenames. No Expo / file-system imports here — everything is
// deterministic and unit-testable. File I/O and the share sheet live in
// `utils/export-data.ts`.

import { Colors, Theme, getStatusColor, getStatusText } from '@/constants/colors';
import { BloodPressureReading, CommunityPost, PatientSummary } from '@/types';
import { formatFileDate, formatThaiDate, formatThaiDateTime } from '@/utils/date-format';

/**
 * UTF-8 byte-order mark. Excel (Windows) sniffs it to decode CSV as UTF-8;
 * without it Thai text renders as mojibake. Harmless for other consumers.
 */
export const CSV_BOM = '\uFEFF';

const APP_NAME = 'BP Monitor';

// Inline copy of assets/images/logo.svg (1.7 KB). Embedded as a string so
// the PDF HTML needs no runtime asset resolution (expo-print renders HTML in
// an isolated WebView with no bundle access); a data URI keeps the SVG's
// gradients/filters scoped to the <img> document. Keep in sync with the
// asset if the logo is redesigned.
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

// System Thai-capable font stack: Noto Sans Thai on Android, Thonburi on
// iOS. No webfont loading — the PDF must render offline.
const PDF_FONT_STACK = "'Sarabun', 'Noto Sans Thai', 'Thonburi', 'Helvetica Neue', Arial, sans-serif";

export const csvEscape = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

export const escapeHtml = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

/** Earliest / latest measurement in the export set. Null when empty. */
export const getReadingsPeriod = (
  readings: BloodPressureReading[],
): { start: Date; end: Date } | null => {
  let start: Date | null = null;
  let end: Date | null = null;
  for (const r of readings) {
    const t = r.measuredAt instanceof Date ? r.measuredAt : new Date(r.measuredAt);
    if (Number.isNaN(t.getTime())) continue;
    if (!start || t < start) start = t;
    if (!end || t > end) end = t;
  }
  return start && end ? { start, end } : null;
};

const hasAttribution = (readings: BloodPressureReading[]): boolean =>
  readings.some((r) => r.recordedBy?.name);

// Self-entered rows show "ผู้ป่วย" when the attribution column is present,
// so mixed reports are unambiguous.
const recordedByLabel = (r: BloodPressureReading): string => r.recordedBy?.name || 'ผู้ป่วย';

// ─── Filenames ────────────────────────────────────────────────────────────

/**
 * Filesystem-safe name segment: strips reserved characters, collapses
 * whitespace into dashes. Thai characters are kept — both iOS and Android
 * (incl. SAF) use UTF-8 filenames.
 */
export const sanitizeFileNameSegment = (value: string): string =>
  value
    .replace(/[\\/:*?"<>|#%&{}$!'`@+=,;]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

export interface ExportFileNameOptions {
  dataType: 'readings' | 'posts';
  readings: BloodPressureReading[];
  userName?: string | null;
  anonymize?: boolean;
}

/**
 * Base filename (no extension): says WHOSE data and WHAT period.
 * e.g. `BP-Report_สมชาย-ใจดี_20260601-20260710`.
 * The name segment is omitted when anonymized or unknown.
 */
export const buildExportFileName = ({
  dataType,
  readings,
  userName,
  anonymize = false,
}: ExportFileNameOptions): string => {
  const nameSegment = !anonymize && userName ? sanitizeFileNameSegment(userName) : '';

  if (dataType === 'posts') {
    const parts = ['BP-Posts', nameSegment, formatFileDate(new Date())];
    return parts.filter(Boolean).join('_');
  }

  const period = getReadingsPeriod(readings);
  const periodSegment = period
    ? `${formatFileDate(period.start)}-${formatFileDate(period.end)}`
    : formatFileDate(new Date());
  const parts = ['BP-Report', nameSegment, periodSegment];
  return parts.filter(Boolean).join('_');
};

// ─── CSV ──────────────────────────────────────────────────────────────────

export const buildReadingsCsv = (
  readings: BloodPressureReading[],
  anonymize = false,
): string => {
  const withRecorder = !anonymize && hasAttribution(readings);

  const header = [
    ...(anonymize ? [] : ['ID']),
    'วันที่-เวลา (Date-Time)',
    'ค่าบน SYS (mmHg)',
    'ค่าล่าง DIA (mmHg)',
    'ชีพจร (Pulse)',
    'สถานะ (Status)',
    ...(withRecorder ? ['บันทึกโดย (Recorded By)'] : []),
    'หมายเหตุ (Notes)',
    ...(anonymize ? [] : ['รูปภาพ (Image)']),
  ];

  const rows = readings.map((r) => [
    ...(anonymize ? [] : [r.id]),
    formatThaiDateTime(r.measuredAt),
    r.systolic,
    r.diastolic,
    r.pulse,
    getStatusText(r.status),
    ...(withRecorder ? [recordedByLabel(r)] : []),
    r.notes ?? '',
    ...(anonymize ? [] : [r.imageUri ?? '']),
  ]);

  return (
    CSV_BOM + [header.join(','), ...rows.map((row) => row.map(csvEscape).join(','))].join('\n')
  );
};

export const buildPostsCsv = (posts: CommunityPost[], anonymize = false): string => {
  const header = anonymize
    ? ['หมวดหมู่ (Category)', 'เนื้อหา (Content)', 'ถูกใจ (Likes)', 'ความคิดเห็น (Comments)', 'วันที่ (Created At)']
    : ['ID', 'User ID', 'ชื่อผู้ใช้ (User)', 'หมวดหมู่ (Category)', 'เนื้อหา (Content)', 'ถูกใจ (Likes)', 'ความคิดเห็น (Comments)', 'วันที่ (Created At)'];
  const rows = posts.map((p) =>
    anonymize
      ? [p.category, p.content, p.likes, p.comments, formatThaiDateTime(p.createdAt)]
      : [
          p.id,
          p.userId,
          p.userName,
          p.category,
          p.content,
          p.likes,
          p.comments,
          formatThaiDateTime(p.createdAt),
        ],
  );

  return (
    CSV_BOM + [header.join(','), ...rows.map((row) => row.map(csvEscape).join(','))].join('\n')
  );
};

// ─── PDF HTML ─────────────────────────────────────────────────────────────

// Print is always the light palette regardless of in-app theme.
const PDF_COLORS = {
  text: Theme.light.textPrimary,
  textMuted: Theme.light.textSecondary,
  accent: Colors.secondary.purple,
  zebra: Colors.background.lightGray,
  border: Colors.border.light,
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

const pdfHeaderHtml = (title: string): string => `
  <header class="report-header">
    <img class="report-logo" src="${REPORT_LOGO_DATA_URI}" alt="" />
    <div>
      <h1 class="report-title">${escapeHtml(title)}</h1>
      <p class="report-subtitle">${APP_NAME}</p>
    </div>
  </header>
`;

const pdfFooterHtml = (generatedAt: Date): string => `
  <footer class="report-footer">
    <span>สร้างโดยแอป ${APP_NAME} • ${escapeHtml(formatThaiDateTime(generatedAt))}</span>
    <span>เอกสารนี้สร้างจากข้อมูลที่ผู้ใช้บันทึก ไม่ใช่เอกสารวินิจฉัยทางการแพทย์</span>
  </footer>
`;

const metaItemHtml = (label: string, value: string): string =>
  `<li><span class="label">${escapeHtml(label)}</span>${escapeHtml(value)}</li>`;

const statusChipHtml = (status: BloodPressureReading['status']): string => {
  const color = getStatusColor(status);
  // 12% alpha tint of the status token — derived, not a new palette value.
  return `<span class="status-chip" style="color: ${color}; background: ${color}1F;">${escapeHtml(getStatusText(status))}</span>`;
};

export const buildReadingsPdfHtml = (
  readings: BloodPressureReading[],
  userName?: string | null,
  anonymize = false,
): string => {
  const generatedAt = new Date();
  const period = getReadingsPeriod(readings);
  const withRecorder = !anonymize && hasAttribution(readings);

  const metaItems = [
    ...(!anonymize ? [metaItemHtml('ผู้ป่วย', userName || '-')] : []),
    metaItemHtml(
      'ช่วงข้อมูล',
      period ? `${formatThaiDate(period.start)} – ${formatThaiDate(period.end)}` : '-',
    ),
    metaItemHtml('จำนวน', `${readings.length} รายการ`),
    metaItemHtml('สร้างเมื่อ', formatThaiDateTime(generatedAt)),
  ].join('');

  // Fixed-layout column widths: numbers stay compact, notes absorb the rest.
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

  const rows = readings
    .map(
      (r) => `
        <tr>
          <td>${escapeHtml(formatThaiDateTime(r.measuredAt))}</td>
          <td class="num">${escapeHtml(r.systolic)}</td>
          <td class="num">${escapeHtml(r.diastolic)}</td>
          <td class="num">${escapeHtml(r.pulse)}</td>
          <td>${statusChipHtml(r.status)}</td>
          ${withRecorder ? `<td>${escapeHtml(recordedByLabel(r))}</td>` : ''}
          <td>${escapeHtml(r.notes ?? '')}</td>
        </tr>
      `,
    )
    .join('');

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>${pdfShellStyles}</style>
      </head>
      <body>
        ${pdfHeaderHtml('รายงานค่าความดันโลหิต')}
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
        ${pdfFooterHtml(generatedAt)}
      </body>
    </html>
  `;
};

export const buildPostsPdfHtml = (
  posts: CommunityPost[],
  userName?: string | null,
  anonymize = false,
): string => {
  const generatedAt = new Date();

  const metaItems = [
    ...(!anonymize ? [metaItemHtml('ผู้ใช้', userName || '-')] : []),
    metaItemHtml('จำนวน', `${posts.length} โพสต์`),
    metaItemHtml('สร้างเมื่อ', formatThaiDateTime(generatedAt)),
  ].join('');

  const rows = posts
    .map(
      (p) => `
        <tr>
          ${anonymize ? '' : `<td>${escapeHtml(p.userName)}</td>`}
          <td>${escapeHtml(p.category)}</td>
          <td>${escapeHtml(p.content)}</td>
          <td class="num">${escapeHtml(p.likes)}</td>
          <td class="num">${escapeHtml(p.comments)}</td>
          <td>${escapeHtml(formatThaiDateTime(p.createdAt))}</td>
        </tr>
      `,
    )
    .join('');

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>${pdfShellStyles}</style>
      </head>
      <body>
        ${pdfHeaderHtml('รายงานโพสต์ชุมชน')}
        <ul class="report-meta">${metaItems}</ul>
        <table>
          <thead>
            <tr>
              ${anonymize ? '' : '<th>ผู้ใช้</th>'}
              <th>หมวดหมู่</th>
              <th>เนื้อหา</th>
              <th class="num">ถูกใจ</th>
              <th class="num">ความคิดเห็น</th>
              <th>วันที่</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
        ${pdfFooterHtml(generatedAt)}
      </body>
    </html>
  `;
};

// ─── Subject-name resolution ──────────────────────────────────────────────

interface ExportSubjectUser {
  role?: string;
  firstname?: string;
  lastname?: string;
}

/**
 * Whose data is being exported. When a caregiver is viewing an active
 * patient, the store's `readings` belong to that patient (fetchReadings
 * passes `activePatientId`), so the report must carry the patient's name —
 * not the caregiver's. Falls back to the logged-in user's name.
 */
export const resolveExportSubjectName = (
  user: ExportSubjectUser | null | undefined,
  activePatientId: string | null | undefined,
  myPatients: PatientSummary[],
): string | undefined => {
  if (user?.role === 'caregiver' && activePatientId) {
    const patient = myPatients.find((p) => p.id === activePatientId);
    if (patient) {
      const name = `${patient.firstname} ${patient.lastname}`.trim();
      if (name) return name;
    }
  }
  if (!user) return undefined;
  const name = `${user.firstname ?? ''} ${user.lastname ?? ''}`.trim();
  return name || undefined;
};
