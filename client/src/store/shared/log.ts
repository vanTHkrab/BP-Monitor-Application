// Dev-only logger so silent catch blocks no longer swallow errors in
// development while staying quiet in production builds.
export const logWarn = (
  scope: string,
  message: string,
  error?: unknown,
  details?: Record<string, unknown>,
) => {
  if (!__DEV__) return;
  const errorDetails =
    error instanceof Error
      ? { name: error.name, message: error.message }
      : error
        ? { error }
        : {};
  console.warn(`[${scope}] ${message}`, { ...details, ...errorDetails });
};

export const communityDebug = (
  message: string,
  details?: Record<string, unknown>,
) => {
  if (!__DEV__) return;
  console.log(`[Community] ${message}`, details ?? {});
};

export const communityWarn = (
  message: string,
  error?: unknown,
  details?: Record<string, unknown>,
) => logWarn("Community", message, error, details);

export const cameraDebug = (
  message: string,
  details?: Record<string, unknown>,
) => {
  if (!__DEV__) return;
  console.log(`[Camera] ${message}`, details ?? {});
};
