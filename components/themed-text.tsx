import { Text, type TextProps } from 'react-native';

import { useThemeColor } from '@/hooks/use-theme-color';

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

  const typeClassName =
    type === 'title'
      ? 'text-[32px] font-bold leading-8'
      : type === 'defaultSemiBold'
        ? 'text-base leading-6 font-semibold'
        : type === 'subtitle'
          ? 'text-xl font-bold'
          : type === 'link'
            ? 'text-base leading-[30px]'
            : 'text-base leading-6';

  const linkColorStyle = type === 'link' ? { color: '#0a7ea4' } : undefined;

  return (
    <Text
      style={[
        { color },
        linkColorStyle,
        style,
      ]}
      className={typeClassName + (className ? ` ${className}` : '')}
      {...rest}
    />
  );
}
