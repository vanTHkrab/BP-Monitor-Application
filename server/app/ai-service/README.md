# AI Service

FastAPI microservice ที่ทำหน้าที่วิเคราะห์รูปเครื่องวัดความดันโลหิตให้ NestJS
API gateway โดยรับ-ส่งงานผ่าน Redis pub/sub (ไม่ใช่ HTTP)

> **สถานะปัจจุบัน:** ยังเป็น *stub* — ตอบกลับด้วย mock readings เพื่อให้ปลายทาง
> request → analyze → submit ใน gateway ทดสอบได้ครบ pipeline งาน OCR จริง
> (YOLO + ssocr) อยู่ใน [PLAN.md](./PLAN.md)

---

## Quick start

```bash
cd server/app/ai-service
uv sync                              # ติดตั้ง dependencies จาก uv.lock
uv run fastapi dev main.py           # dev (auto-reload) ที่ port 8000
```

ตรวจว่ารันถูก:

```bash
curl -s http://localhost:8000/health
# {"status":"ok","service":"ai-service"}
```

> ต้องมี Redis รันอยู่ (default `redis://localhost:6379`) — service จะ
> subscribe ช่อง `analyze_bp_image` ตอน lifespan startup ถ้า Redis ล่มจะ
> log error แต่ HTTP `/health` ยังตอบได้

---

## Environment variables

| Var | บังคับ | หมายเหตุ |
| --- | --- | --- |
| `REDIS_URL` | – | default `redis://localhost:6379` |
| `LOG_LEVEL` | – | default `INFO` |

---

## Wire protocol (gateway ↔ ai-service)

ใช้ `@nestjs/microservices` Redis transport — ฝั่ง Python จึง subscribe/publish
ตามแพทเทิร์นของ NestJS:

| Channel | Direction | Payload shape |
| --- | --- | --- |
| `analyze_bp_image` | gateway → ai-service | `{ pattern, id, data: { jobId, userId, s3Key, mimeType } }` |
| `analyze_bp_image.reply` | ai-service → gateway | `{ id, response: { confidence, systolic, diastolic, pulse, roi_image_url, raw_text, error? }, isDisposed: true }` |

ถ้า error: reply เป็น `{ id, err: <message>, isDisposed: true }`

ห้ามเปลี่ยน channel name หรือ payload shape โดยไม่อัปเดตฝั่ง gateway
([api-gateway/src/ai/](../api-gateway/src/ai/)) พร้อมกัน

---

## Project layout

```text
ai-service/
├── main.py                         # FastAPI entry shim (re-exports ai_service.main)
├── src/
│   └── ai_service/
│       ├── __init__.py
│       └── main.py                 # FastAPI app + Redis listener (stub OCR)
├── tests/
│   └── test_main.py                # pytest-asyncio tests for handler + reply
├── pyproject.toml                  # uv-managed deps
├── uv.lock
├── Dockerfile
├── PLAN.md                         # roadmap for real OCR pipeline
└── CLAUDE.md                       # AI-assisted edits guideline
```

---

## Scripts

```bash
uv run fastapi dev main.py         # dev (auto-reload)
uv run fastapi run main.py         # production-style
uv run pytest                      # tests
uv run pytest tests/test_main.py   # single file
```

---

## Troubleshooting

| อาการ | สาเหตุที่พบบ่อย |
| --- | --- |
| Boot log "AI service ready" ไม่ขึ้น | Redis เชื่อมไม่ได้ — เช็ค `REDIS_URL` |
| Gateway timeout บน `analyzeBPImage` | service ไม่ได้ subscribe ทัน หรือไม่มี Redis broker — restart ทั้งคู่ |
| `Discarding non-JSON message` | publisher ฝั่งอื่นส่ง payload ผิด format — ตรวจว่า gateway version ตรงกัน |

---

## เอกสารที่เกี่ยวข้อง

- [CLAUDE.md](./CLAUDE.md) — guideline สำหรับ AI-assisted edits
- [PLAN.md](./PLAN.md) — roadmap: real OCR (YOLO + ssocr) pipeline
- [api-gateway README](../api-gateway/README.md) — gateway side ของ pipeline
- Root [CLAUDE.md](../../../CLAUDE.md) — guideline ระดับ monorepo
