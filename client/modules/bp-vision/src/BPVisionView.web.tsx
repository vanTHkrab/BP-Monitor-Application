import * as React from 'react';

import { BPVisionViewProps } from './BPVision.types';

export default function BPVisionView(props: BPVisionViewProps) {
  return (
    <div>
      <iframe
        style={{ flex: 1 }}
        src={props.url}
        onLoad={() => props.onLoad({ nativeEvent: { url: props.url } })}
      />
    </div>
  );
}
