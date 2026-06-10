import { useAppStore } from '@/store/use-app-store';
import { fontPresetClass } from '@/utils/font-scale';
import { Text, View } from 'react-native';

export default function Explore() {
  const fontSizePreference = useAppStore((s) => s.fontSizePreference);
  const bodyClassName = fontPresetClass.body(fontSizePreference);

  return (
    <View>
      <Text className={bodyClassName}>Explore</Text>
    </View>
  );
}
