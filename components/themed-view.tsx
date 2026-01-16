import { View, type ViewProps } from 'react-native';
import { styled } from 'nativewind';

import { useThemeColor } from '@/hooks/use-theme-color';

export type ThemedViewProps = ViewProps & {
  lightColor?: string;
  darkColor?: string;
  className?: string;
};

const StyledView = styled(View);

export function ThemedView({ style, lightColor, darkColor, className, ...otherProps }: ThemedViewProps) {
  const backgroundColor = useThemeColor({ light: lightColor, dark: darkColor }, 'background');

  return (
    <StyledView
      className={className}
      style={[{ backgroundColor }, style]}
      {...otherProps}
    />
  );
}
