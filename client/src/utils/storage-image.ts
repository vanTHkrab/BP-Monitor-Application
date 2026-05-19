// The gateway now returns short-lived signed GET URLs for every stored
// image (avatars, BP photos, etc.) — see
// server/app/api-gateway/src/storage/storage.service.ts → signImageKey.
// There's nothing to rewrite client-side any more; this helper stays as
// a thin pass-through so existing callsites keep compiling without churn.
export const toDisplayImageUri = (uri?: string | null) => uri ?? undefined;
