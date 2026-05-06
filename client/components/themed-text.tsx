import { Text, type TextProps } from 'react-native';

import { useThemeColor } from '@/hooks/use-theme-color';
import { useAppStore } from '@/store/useAppStore';
import { getFontNumber } from '@/utils/font-scale';

export type ThemedTextProps = TextProps & {
  lightColor?: string;
  darkColor?: string;
  type?: 'default' | 'title' | 'defaultSemiBold' | 'subtitle' | 'link';
  className?: string;
};

export function ThemedText({
  style,
  lightColor,
  darkColor,
  type = 'default',
  className,
  ...rest
}: ThemedTextProps) {
  const color = useThemeColor({ light: lightColor, dark: darkColor }, 'text');
  const fontSizePreference = useAppStore((s) => s.fontSizePreference);

  const fontSize =
    type === 'title'
      ? getFontNumber(fontSizePreference, { xsmall: 24, small: 28, medium: 32, large: 38, xlarge: 42 })
      : type === 'subtitle'
        ? getFontNumber(fontSizePreference, { xsmall: 16, small: 18, medium: 20, large: 24, xlarge: 28 })
        : getFontNumber(fontSizePreference, { xsmall: 12, small: 14, medium: 16, large: 18, xlarge: 20 });

  const lineHeight =
    type === 'title'
      ? getFontNumber(fontSizePreference, { xsmall: 30, small: 34, medium: 38, large: 44, xlarge: 48 })
      : type === 'link'
        ? getFontNumber(fontSizePreference, { xsmall: 20, small: 24, medium: 30, large: 34, xlarge: 38 })
        : getFontNumber(fontSizePreference, { xsmall: 18, small: 22, medium: 24, large: 28, xlarge: 32 });

  const typeClassName =
    type === 'title'
      ? 'font-bold'
      : type === 'defaultSemiBold'
        ? 'font-semibold'
        : type === 'subtitle'
          ? 'font-bold'
          : '';

  const linkColorStyle = type === 'link' ? { color: '#0a7ea4' } : undefined;

  return (
    <Text
      style={[
        { color },
        { fontSize, lineHeight },
        linkColorStyle,
        style,
      ]}
      className={typeClassName + (className ? ` ${className}` : '')}
      {...rest}
    />
  );
}
