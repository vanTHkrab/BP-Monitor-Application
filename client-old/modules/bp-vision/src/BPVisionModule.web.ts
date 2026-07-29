import { registerWebModule, NativeModule } from 'expo';

import { BPVisionModuleEvents } from './BPVision.types';

class BPVisionModule extends NativeModule<BPVisionModuleEvents> {
  PI = Math.PI;
  async setValueAsync(value: string): Promise<void> {
    this.emit('onChange', { value });
  }
  hello() {
    return 'Hello world! 👋';
  }
}

export default registerWebModule(BPVisionModule, 'BPVisionModule');
