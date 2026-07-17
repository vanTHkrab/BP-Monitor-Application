import { NativeModule, requireNativeModule } from 'expo';

import { BPVisionModuleEvents } from './BPVision.types';

declare class BPVisionModule extends NativeModule<BPVisionModuleEvents> {
  PI: number;
  hello(): string;
  setValueAsync(value: string): Promise<void>;
}

// This call loads the native module object from the JSI.
export default requireNativeModule<BPVisionModule>('BPVision');
