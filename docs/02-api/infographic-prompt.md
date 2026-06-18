# Infographic Design Prompt — BP Monitor (สิ่งประดิษฐ์/นวัตกรรม Competition, A4 Portrait)

Use this prompt with an AI image/design tool (e.g. Claude with image generation,
Midjourney, Canva Magic Design) to produce a competition submission infographic.
Fill in the bracketed `[...]` fields with your actual entry data before generating.

---

## Prompt

```
Design a professional A4 portrait (210mm × 297mm, 2480×3508px @300dpi)
infographic poster for a Thai national invention/innovation competition
submission. The subject is "BP Monitor" — a mobile + AI system that lets
patients capture a photo of a digital blood-pressure monitor display and
automatically extracts systolic, diastolic, and pulse readings via a
YOLO + OCR pipeline, syncing the data to a clinician-facing dashboard.

LAYOUT (top to bottom):

1. HEADER BAND (top ~12% of page)
   - Left-aligned, in a single horizontal row: (a) โลโก้กระทรวงการอุดมศึกษา
     วิทยาศาสตร์ วิจัยและนวัตกรรม (อว.), (b) โลโก้สำนักงานการวิจัยแห่งชาติ (วช.),
     (c) โลโก้สถาบันการศึกษาที่สังกัด [INSTITUTION LOGO], (d) โลโก้หน่วยงาน
     สนับสนุน/หน่วยงานร่วมประดิษฐ์คิดค้น (ถ้ามี) [PARTNER ORG LOGO]
   - Logos sized evenly (~80-100px height each), white background strip,
     thin divider line beneath the band.

2. TITLE BLOCK (~10% of page)
   - ชื่อผลงาน: "[EXACT PROJECT TITLE FROM SUBMISSION FORM]"
     — large bold Thai-supporting display font, centered, 2 lines max.
   - Optional subtitle/tagline in smaller weight below.

3. HERO IMAGE (~22% of page)
   - One clear, high-quality product/result photo: a smartphone camera
     pointed at a digital BP monitor display, with an on-screen bounding
     box overlay around the detected display and extracted numbers
     (sys/dia/pulse) shown as a clean callout card beside the phone.
   - Soft drop shadow, rounded-corner device mockup frame.

4. TECHNIQUE / TECHNOLOGY SECTION (~25% of page)
   - Heading: "เทคนิค/วิธีการ/เทคโนโลยี"
   - 3–4 icon + short-label steps in a horizontal or zigzag flow:
     [1] ถ่ายภาพจอวัด (Expo RN mobile capture)
     → [2] ตรวจจับตำแหน่งจอด้วย YOLOv12n (on-device pre-flight + ai-service)
     → [3] OCR อ่านตัวเลข 7-segment (OpenCV preprocessing + digit recognition)
     → [4] ส่งผลขึ้นระบบ/แดชบอร์ดแบบ Offline-first sync (GraphQL + SQLite queue)
   - Use simple flat icons (camera, AI chip/brain, magnifying glass over
     digits, cloud-sync arrows) connected by arrows.

5. BENEFITS SECTION (~16% of page)
   - Heading: "ประโยชน์ของผลงาน"
   - 3–4 short bullet points with icons, e.g.: ลดความผิดพลาดจากการจดบันทึกมือ,
     ผู้ป่วยสูงอายุใช้งานง่าย, แพทย์ติดตามค่าความดันได้ต่อเนื่องแบบเรียลไทม์,
     ทำงานได้แม้ไม่มีอินเทอร์เน็ต (offline-first)
   - Compact 2x2 or vertical icon+text grid, lighter background tint.

6. FOOTER BAND (~8% of page)
   - เจ้าของผลงาน: [FULL NAME(S)]
   - หน่วยงาน: [INSTITUTION/DEPARTMENT NAME]
   - อีเมลติดต่อ: [CONTACT EMAIL]
   - Small QR code (optional) linking to a demo video or repo, right-aligned.

VISUAL STYLE:
- Color palette: sky-blue to deep-blue gradient (#72DDF4 → #35B8E8 → #1898D4)
  as the primary accent, with a soft purple secondary accent (#7E57C2 →
  #5E35B1) for highlights/CTAs, white (#FFFFFF) and light blue-gray
  (#EBF5FB) backgrounds, dark slate (#2C3E50) for body text headings.
- Clean, modern medical/health-tech aesthetic — rounded cards, soft
  shadows, generous white space, no clutter.
- Typography: a clean geometric sans-serif that supports Thai script
  (e.g. Noto Sans Thai / IBM Plex Sans Thai / Sarabun) for body text,
  bolder weight for headings.
- Maintain strict top-to-bottom reading flow appropriate for judges
  skimming in under 30 seconds: title → image → how it works → why it
  matters → who made it.
- All Thai text must render with correct tone marks and proper line
  breaking (avoid breaking mid-word).
- Leave a 10mm safe margin on all sides for print bleed.

OUTPUT: single A4 portrait page, print-ready 300dpi, vector-style flat
illustration (not photorealistic) for the icon/diagram elements, but the
hero image area should look like a real photo composite.
```

---

## Fields to fill in before use

| Placeholder | What to provide |
| --- | --- |
| `[INSTITUTION LOGO]` | โลโก้สถาบันการศึกษาที่สังกัด (ไฟล์แยก ไม่ใช่ส่วนหนึ่งของ prompt ข้อความ) |
| `[PARTNER ORG LOGO]` | โลโก้หน่วยงานสนับสนุน ถ้ามี — ถ้าไม่มีให้ลบบรรทัดนี้ออกจาก prompt |
| `[EXACT PROJECT TITLE FROM SUBMISSION FORM]` | ชื่อผลงานตามแบบฟอร์มเสนอผลงานจริง |
| `[FULL NAME(S)]` | ชื่อเจ้าของผลงานทุกคน |
| `[INSTITUTION/DEPARTMENT NAME]` | ชื่อหน่วยงาน/สถาบัน/ภาควิชา |
| `[CONTACT EMAIL]` | อีเมลที่ติดต่อได้ |

**Note:** Logo files themselves (อว., วช., สถาบัน, หน่วยงานร่วม) must be supplied
as actual image assets to the design tool — a text prompt alone cannot generate
official government/institution logos accurately. Place official logo PNG/SVG
files alongside this prompt when feeding it into an image-generation tool, or
composite them in post (e.g. Canva/Figma) after generating the base layout.
