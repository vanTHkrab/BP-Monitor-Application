import { cssInterop } from 'nativewind';
import type { PropsWithChildren, ReactElement } from 'react';
import { ScrollView, View } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { useColorScheme } from '@/hooks/use-color-scheme';

cssInterop(View, { className: 'style' });

type Props = PropsWithChildren<{
  headerImage: ReactElement;
  headerBackgroundColor: { dark: string; light: string };
}>;

export default function ParallaxScrollView({
  children,
  headerImage,
  headerBackgroundColor,
}: Props) {
  const colorScheme = useColorScheme() ?? 'light';

  return (
    <ScrollView
      className="flex-1 bg-white dark:bg-[#0B1220]"
      scrollEventThrottle={16}>
      <View
        className="h-[250px] overflow-hidden"
        style={{ backgroundColor: headerBackgroundColor[colorScheme] }}
      >
        {headerImage}
      </View>
      <ThemedView className="flex-1 p-8 gap-4 overflow-hidden">{children}</ThemedView>
    </ScrollView>
  );
}
