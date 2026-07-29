import { requireNativeView } from 'expo';
import * as React from 'react';

import { BPVisionViewProps } from './BPVision.types';

const NativeView: React.ComponentType<BPVisionViewProps> =
  requireNativeView('BPVision');

export default function BPVisionView(props: BPVisionViewProps) {
  return <NativeView {...props} />;
}
