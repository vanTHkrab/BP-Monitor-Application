// Wire-contract pub/sub channels owned by server/CLAUDE.md
// (gateway ↔ ai-service: `analyze_bp_image` / `analyze_bp_image.reply`).
//
// Kept in a tiny standalone module so both server actions (which bundle the
// ioredis client) AND client components (which must not bundle ioredis) can
// import these strings safely.
export const AI_REQUEST_CHANNEL = "analyze_bp_image";
export const AI_REPLY_CHANNEL = "analyze_bp_image.reply";
