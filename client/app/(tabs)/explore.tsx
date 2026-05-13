import { useAppStore } from '@/store/use-app-store';
import { getFontClass } from '@/utils/font-scale';
import { Text, View } from 'react-native';

export default function Explore() {
  const fontSizePreference = useAppStore((s) => s.fontSizePreference);
  const bodyClassName = getFontClass(fontSizePreference, {
    small: 'text-sm',
    medium: 'text-base',
    large: 'text-lg',
    xlarge: 'text-xl',
  });

  return (
    <View>
      <Text className={bodyClassName}>Explore</Text>
    </View>
  );
}
