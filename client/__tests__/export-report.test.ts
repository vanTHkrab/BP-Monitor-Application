import { BloodPressureReading } from "@/types";
import { formatFileDate, formatThaiDate, formatThaiDateTime } from "@/utils/date-format";
import {
  CSV_BOM,
  REPORT_LOGO_DATA_URI,
  buildExportFileName,
  buildReadingsCsv,
  buildReadingsPdfHtml,
  getReadingsPeriod,
  resolveExportSubjectName,
  sanitizeFileNameSegment,
} from "@/utils/export-report";

const reading = (overrides: Partial<BloodPressureReading> = {}): BloodPressureReading => ({
  id: "r-1",
  userId: "u-1",
  systolic: 118,
  diastolic: 76,
  pulse: 72,
  measuredAt: new Date(2026, 6, 10, 21, 52), // 10 Jul 2026 21:52 local time
  status: "normal",
  ...overrides,
});

describe("date-format", () => {
  const d = new Date(2026, 6, 10, 21, 52);

  it("formats Thai date-time with Buddhist year and abbreviated month", () => {
    expect(formatThaiDateTime(d)).toBe("10 ก.ค. 2569 21:52");
  });

  it("formats Thai date without time", () => {
    expect(formatThaiDate(new Date(2026, 0, 5))).toBe("5 ม.ค. 2569");
  });

  it("zero-pads hours and minutes", () => {
    expect(formatThaiDateTime(new Date(2026, 11, 31, 8, 5))).toBe("31 ธ.ค. 2569 08:05");
  });

  it("formats compact Gregorian file dates", () => {
    expect(formatFileDate(d)).toBe("20260710");
  });

  it("returns a placeholder for invalid input", () => {
    expect(formatThaiDateTime("not-a-date")).toBe("-");
    expect(formatFileDate("not-a-date")).toBe("unknown");
  });
});

describe("getReadingsPeriod", () => {
  it("returns min/max measuredAt", () => {
    const period = getReadingsPeriod([
      reading({ measuredAt: new Date(2026, 6, 10) }),
      reading({ measuredAt: new Date(2026, 5, 1) }),
      reading({ measuredAt: new Date(2026, 6, 2) }),
    ]);
    expect(period?.start).toEqual(new Date(2026, 5, 1));
    expect(period?.end).toEqual(new Date(2026, 6, 10));
  });

  it("returns null for an empty set", () => {
    expect(getReadingsPeriod([])).toBeNull();
  });
});

describe("buildExportFileName", () => {
  const readings = [
    reading({ measuredAt: new Date(2026, 5, 1) }),
    reading({ measuredAt: new Date(2026, 6, 10) }),
  ];

  it("says whose report and what period", () => {
    expect(buildExportFileName({ dataType: "readings", readings, userName: "สมชาย ใจดี" })).toBe(
      "BP-Report_สมชาย-ใจดี_20260601-20260710",
    );
  });

  it("omits the name when anonymized", () => {
    expect(
      buildExportFileName({ dataType: "readings", readings, userName: "สมชาย", anonymize: true }),
    ).toBe("BP-Report_20260601-20260710");
  });

  it("sanitizes filesystem-unsafe characters", () => {
    expect(sanitizeFileNameSegment('a/b\\c:d*e?"f<g>h|i j')).toBe("abcdefghi-j");
  });
});

describe("buildReadingsCsv", () => {
  it("starts with a UTF-8 BOM so Excel decodes Thai text", () => {
    const csv = buildReadingsCsv([reading()]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(CSV_BOM).toBe("﻿");
  });

  it("renders readable Thai dates and status text", () => {
    const csv = buildReadingsCsv([reading()]);
    expect(csv).toContain("10 ก.ค. 2569 21:52");
    expect(csv).toContain("ปกติ");
    expect(csv).not.toContain("2026-07-10T"); // no raw ISO timestamps
  });

  it("omits the recorded-by column when all rows are self-entered", () => {
    const csv = buildReadingsCsv([reading()]);
    expect(csv).not.toContain("บันทึกโดย");
  });

  it("adds the recorded-by column when any row has attribution", () => {
    const csv = buildReadingsCsv([
      reading(),
      reading({ id: "r-2", recordedBy: { id: "c-1", name: "สมหญิง ดูแลดี" } }),
    ]);
    expect(csv).toContain("บันทึกโดย (Recorded By)");
    expect(csv).toContain("สมหญิง ดูแลดี");
    expect(csv).toContain("ผู้ป่วย"); // self-entered rows are labelled explicitly
  });

  it("strips identifiers when anonymized", () => {
    const csv = buildReadingsCsv(
      [reading({ imageUri: "s3://bucket/key.jpg", recordedBy: { id: "c-1", name: "X" } })],
      true,
    );
    expect(csv).not.toContain("r-1");
    expect(csv).not.toContain("s3://bucket/key.jpg");
    expect(csv).not.toContain("บันทึกโดย");
  });
});

describe("buildReadingsPdfHtml", () => {
  it("embeds the app logo as an SVG data URI", () => {
    const html = buildReadingsPdfHtml([reading()], "สมชาย ใจดี");
    expect(REPORT_LOGO_DATA_URI.startsWith("data:image/svg+xml;utf8,")).toBe(true);
    expect(html).toContain(REPORT_LOGO_DATA_URI);
  });

  it("renders header with title, patient name, period and generated date", () => {
    const html = buildReadingsPdfHtml(
      [reading({ measuredAt: new Date(2026, 5, 1) }), reading({ id: "r-2" })],
      "สมชาย ใจดี",
    );
    expect(html).toContain("รายงานค่าความดันโลหิต");
    expect(html).toContain("สมชาย ใจดี");
    expect(html).toContain("1 มิ.ย. 2569 – 10 ก.ค. 2569");
    expect(html).toContain("2 รายการ");
    expect(html).toContain("สร้างเมื่อ");
  });

  it("renders table rows with formatted dates and status color chips", () => {
    const html = buildReadingsPdfHtml([reading({ notes: "หลังตื่นนอน" })], "สมชาย");
    expect(html).toContain("10 ก.ค. 2569 21:52");
    expect(html).toContain("หลังตื่นนอน");
    expect(html).toContain("status-chip");
    expect(html).toContain("#27AE60"); // Colors.status.normal from constants/colors
    expect(html).not.toContain("2026-07-10T");
  });

  it("escapes HTML in user-controlled fields", () => {
    const html = buildReadingsPdfHtml([reading({ notes: '<img src=x onerror="a">' })], "<b>x</b>");
    expect(html).not.toContain('<img src=x onerror="a">');
    expect(html).not.toContain("<b>x</b>");
  });

  it("shows the recorded-by column only when attributed rows exist", () => {
    const withoutAttribution = buildReadingsPdfHtml([reading()], "สมชาย");
    expect(withoutAttribution).not.toContain("บันทึกโดย");

    const withAttribution = buildReadingsPdfHtml(
      [reading({ recordedBy: { id: "c-1", name: "สมหญิง ดูแลดี" } })],
      "สมชาย",
    );
    expect(withAttribution).toContain("บันทึกโดย");
    expect(withAttribution).toContain("สมหญิง ดูแลดี");
  });
});

describe("resolveExportSubjectName", () => {
  const patients = [
    { id: "p-1", firstname: "สมชาย", lastname: "ใจดี", phone: "0812345678" },
  ];

  it("uses the active patient's name for caregivers", () => {
    expect(
      resolveExportSubjectName({ role: "caregiver", firstname: "A", lastname: "B" }, "p-1", patients),
    ).toBe("สมชาย ใจดี");
  });

  it("falls back to the user's own name", () => {
    expect(
      resolveExportSubjectName({ role: "patient", firstname: "สมศรี", lastname: "มีสุข" }, null, []),
    ).toBe("สมศรี มีสุข");
  });

  it("falls back to the caregiver's name when the patient is unknown", () => {
    expect(
      resolveExportSubjectName({ role: "caregiver", firstname: "A", lastname: "B" }, "missing", patients),
    ).toBe("A B");
  });

  it("returns undefined when there is no user", () => {
    expect(resolveExportSubjectName(null, null, [])).toBeUndefined();
  });
});
