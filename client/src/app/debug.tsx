/** Dev-only entry point — see the row's __DEV__ gate in app/(tabs)/menu.tsx. */
import { ScreenPlaceholder } from '@/components/screen-placeholder';

export default function DebugScreen() {
  return (
    <ScreenPlaceholder
      title="Debug · ข้อมูลในแอป"
      note="client-old's debug tool is a whole mini-app (diff / file / sqlite / storage / store / uploads inspectors) — porting the tabbed shell first is a separate task from this screen."
      portedFrom="client-old/app/debug/"
    />
  );
}
