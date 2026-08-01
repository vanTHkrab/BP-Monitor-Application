/**
 * The feed's three category tabs.
 *
 * A segmented row, not a scrolling pill strip: there are exactly three and
 * there will not be more without a schema change, so they all fit and the
 * user never has to discover a tab by scrolling sideways.
 */
import { Pressable, Text, View } from 'react-native';

import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';

import { POST_CATEGORIES, categoryLabel } from '../lib/categories';
import type { PostCategory } from '../types';

export type CategoryTabsProps = {
  value: PostCategory;
  onChange: (category: PostCategory) => void;
};

export function CategoryTabs({ value, onChange }: CategoryTabsProps) {
  const colors = useTheme();
  const fontScale = useFontScale();

  return (
    <View
      className="mx-4 mb-3 flex-row rounded-2xl p-1"
      style={{ backgroundColor: colors['surface-muted'] }}
      accessibilityRole="tablist"
    >
      {POST_CATEGORIES.map((category) => {
        const isSelected = category === value;

        return (
          <Pressable
            key={category}
            testID={`community-tab-${category}`}
            onPress={() => onChange(category)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isSelected }}
            className="flex-1 items-center justify-center rounded-xl px-2"
            style={{
              minHeight: 44,
              backgroundColor: isSelected ? colors.surface : 'transparent',
            }}
          >
            <Text
              numberOfLines={1}
              className={isSelected ? 'font-bold' : 'font-medium'}
              style={{
                fontSize: Math.round(14 * fontScale),
                color: isSelected ? colors.primary : colors['text-secondary'],
              }}
            >
              {categoryLabel(category)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
