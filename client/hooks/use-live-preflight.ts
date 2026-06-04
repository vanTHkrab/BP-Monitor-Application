/**
 * Live BP-monitor detection for the camera preview.
 *
 * Strategy: while the user is framing a shot (no captured image yet), poll
 * `takePictureAsync` at a fixed cadence, run the same on-device YOLO that
 * `services/preflight-detection.service.ts` uses, and surface the result so
 * a sibling overlay component can draw boxes over the live preview.
 *
 * This is intentionally NOT real-time (1-2 fps) — expo-camera lacks a frame
 * processor API, so we trade smoothness for not having to migrate to
 * react-native-vision-camera. See client/CLAUDE.md → "On-device pre-flight"
 * for the broader feature notes.
 *
 * Concurrency: a single in-flight guard prevents the loop from queuing
 * captures faster than they complete. If a cycle (capture + inference)
 * takes longer than the polling interval, the next tick simply skips.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { CameraView } from 'expo-camera';

import { detectInImage } from '@/lib/yolo/detect';
import { isYoloAvailable } from '@/lib/yolo/session';
import { logWarn } from '@/store/shared/log';
import type { Detection } from '@/lib/yolo/types';

export interface LivePreflightFrame {
  detections: Detection[];
  /** Pixel dimensions of the snapshot the detections live in. */
  pictureWidth: number;
  pictureHeight: number;
  /** Timing for the most recent cycle — handy for dev overlay / sanity check. */
  metrics: {
    captureMs: number;
    inferenceMs: number;
    totalMs: number;
  };
}

export interface UseLivePreflightOptions {
  cameraRef: RefObject<CameraView | null>;
  /** Master on/off — typically `isCameraReady && !capturedImage && !modalOpen`. */
  enabled: boolean;
  /** Default 500ms (~2 fps). Lower than capture+inference time has no effect
   *  — the in-flight guard skips overlapping ticks. */
  intervalMs?: number;
}

export function useLivePreflight(opts: UseLivePreflightOptions): LivePreflightFrame | null {
  const { cameraRef, enabled, intervalMs = 500 } = opts;
  const [frame, setFrame] = useState<LivePreflightFrame | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      // Clear the overlay when the loop is disabled (e.g. after capture so
      // the static cropped preview doesn't have stale live boxes drawn on
      // top of it).
      setFrame(null);
      return;
    }

    // Don't even spin up the loop if YOLO isn't available on this runtime
    // (Expo Go). The static preflight handles the fallback elsewhere; this
    // hook just bows out silently so the camera UI works.
    if (!isYoloAvailable()) {
      logWarn(
        'live-preflight',
        'on-device YOLO unavailable on this runtime (likely Expo Go); skipping live overlay',
      );
      return;
    }

    let stopped = false;
    let handle: ReturnType<typeof setInterval> | null = null;

    const stopLoop = () => {
      if (handle !== null) {
        clearInterval(handle);
        handle = null;
      }
    };

    const tick = async () => {
      if (stopped || inFlightRef.current) return;
      if (!cameraRef.current) return;
      inFlightRef.current = true;

      const t0 = Date.now();
      try {
        // skipProcessing + low quality + no shutter sound keep this cheap.
        // We don't need a high-res frame for detection — the YOLO input is
        // 512x512 anyway.
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.4,
          skipProcessing: true,
          shutterSound: false,
          exif: false,
        });
        if (!photo || stopped) return;

        const t1 = Date.now();
        const { detections, metrics } = await detectInImage({
          imageUri: photo.uri,
          sourceWidth: photo.width,
          sourceHeight: photo.height,
        });
        if (stopped) return;

        setFrame({
          detections,
          pictureWidth: photo.width,
          pictureHeight: photo.height,
          metrics: {
            captureMs: t1 - t0,
            inferenceMs: metrics.inferenceMs,
            totalMs: Date.now() - t0,
          },
        });
      } catch (err) {
        // Fatal ORT/native errors will fail every tick — log once and stop
        // the loop so we don't spam logs at 2 fps. Transient camera errors
        // are bundled in here too; user can leave + return to retry.
        logWarn('live-preflight', 'tick failed — stopping live overlay', err);
        stopped = true;
        stopLoop();
      } finally {
        inFlightRef.current = false;
      }
    };

    // Fire once immediately so the overlay populates before the first
    // interval, then settle into the cadence.
    void tick();
    handle = setInterval(tick, intervalMs);

    return () => {
      stopped = true;
      stopLoop();
    };
  }, [enabled, cameraRef, intervalMs]);

  return frame;
}
