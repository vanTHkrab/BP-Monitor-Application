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
      ? getFontNumber(fontSizePreference, { small: 28, medium: 32, large: 38 })
      : type === 'subtitle'
        ? getFontNumber(fontSizePreference, { small: 18, medium: 20, large: 24 })
        : getFontNumber(fontSizePreference, { small: 14, medium: 16, large: 18 });

  const lineHeight =
    type === 'title'
      ? getFontNumber(fontSizePreference, { small: 34, medium: 38, large: 44 })
      : type === 'link'
        ? getFontNumber(fontSizePreference, { small: 24, medium: 30, large: 34 })
        : getFontNumber(fontSizePreference, { small: 22, medium: 24, large: 28 });

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
