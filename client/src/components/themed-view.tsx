import { View, type ViewProps } from 'react-native';
import { cssInterop } from 'nativewind';

import type { SemanticColorName } from '@/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedViewProps = ViewProps & {
  lightColor?: string;
  darkColor?: string;
  type?: SemanticColorName;
  className?: string;
};

export function ThemedView({ style, lightColor, darkColor, type, ...otherProps }: ThemedViewProps) {
  const theme = useTheme();

  return (
      <View
          style={[{ backgroundColor: theme[type ?? 'background'] }, style]}
          {...otherProps}
      />
  );
}

cssInterop(ThemedView, { className: 'style' });