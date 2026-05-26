/**
 * SVG overlay that draws the on-device YOLO detections over the camera
 * preview viewport. Consumes the output of `useLivePreflight` and maps box
 * coordinates from picture-pixel space to viewport-pixel space.
 *
 * Coordinate math: expo-camera's CameraView uses cover-fit by default — the
 * sensor frame is scaled to FILL the viewport, cropping the longer axis.
 * We mirror that here so a box near the centre of the picture lands near
 * the centre of the viewport regardless of aspect-ratio mismatch.
 */
import React from 'react';
import Svg, { G, Rect, Text as SvgText } from 'react-native-svg';

import {
  FIELD_CLASS_IDS,
  MONITOR_CLASS_IDS,
  type Detection,
} from '@/lib/yolo/types';

interface LivePreflightOverlayProps {
  detections: readonly Detection[];
  /** Pixel dims of the picture the detections live in. */
  pictureWidth: number;
  pictureHeight: number;
  /** Pixel dims of the on-screen viewport (CameraView container). */
  viewportWidth: number;
  viewportHeight: number;
}

const MONITOR_SET = new Set<number>(MONITOR_CLASS_IDS);
const FIELD_SET = new Set<number>(FIELD_CLASS_IDS);

export function LivePreflightOverlay({
  detections,
  pictureWidth,
  pictureHeight,
  viewportWidth,
  viewportHeight,
}: LivePreflightOverlayProps) {
  if (
    !detections.length ||
    pictureWidth <= 0 ||
    pictureHeight <= 0 ||
    viewportWidth <= 0 ||
    viewportHeight <= 0
  ) {
    return null;
  }

  // Cover-fit: scale so the *smaller* picture-to-viewport ratio fits,
  // letting the *larger* axis overflow (which the viewport clips). That's
  // what CameraView does for its preview, so this keeps overlay boxes
  // aligned with what the user actually sees.
  const scale = Math.max(viewportWidth / pictureWidth, viewportHeight / pictureHeight);
  const displayedW = pictureWidth * scale;
  const displayedH = pictureHeight * scale;
  const offsetX = (viewportWidth - displayedW) / 2;
  const offsetY = (viewportHeight - displayedH) / 2;

  return (
    <Svg
      width={viewportWidth}
      height={viewportHeight}
      style={{ position: 'absolute', top: 0, left: 0 }}
      pointerEvents="none"
    >
      {detections.map((d, i) => {
        const x = d.x1 * scale + offsetX;
        const y = d.y1 * scale + offsetY;
        const w = (d.x2 - d.x1) * scale;
        const h = (d.y2 - d.y1) * scale;

        const isMonitor = MONITOR_SET.has(d.cls);
        const isField = FIELD_SET.has(d.cls);
        const stroke = isMonitor ? '#22C55E' : isField ? '#FBBF24' : '#94A3B8';
        const strokeWidth = isMonitor ? 3 : 2;

        return (
          <G key={`${d.cls}-${i}`}>
            <Rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill="none"
              stroke={stroke}
              strokeWidth={strokeWidth}
              rx={4}
              ry={4}
            />
            <SvgText
              x={x + 4}
              y={y + 14}
              fontSize={10}
              fontWeight="bold"
              fill={stroke}
              stroke="black"
              strokeWidth={0.5}
            >
              {`${d.className} ${(d.confidence * 100).toFixed(0)}%`}
            </SvgText>
          </G>
        );
      })}
    </Svg>
  );
}
