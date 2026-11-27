import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Check } from 'lucide-react-native';

import { SwipeableBottomSheet } from '@/components/SwipeableBottomSheet';
import { useColors } from '@/lib/theme';

export interface PickerOption {
  id: string;
  label: string;
}

interface PickerSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  options: PickerOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * A sheet listing a handful of named options with a check on the chosen one,
 * closing itself once a row is picked. Anything with this shape — one pick
 * from a short list of names — belongs here.
 */
export function PickerSheet({
  isOpen,
  onClose,
  title,
  options,
  selectedId,
  onSelect,
}: PickerSheetProps) {
  if (!isOpen) return null;

  return (
    <SwipeableBottomSheet isOpen={isOpen} onClose={onClose}>
      {({ close }) => (
        <View className="pb-8 pt-1">
          <Text className="mb-2 text-center text-[18px] font-semibold text-zinc-900 dark:text-zinc-50">
            {title}
          </Text>

          {options.map((option, index) => (
            <PickerRow
              key={option.id}
              label={option.label}
              isActive={option.id === selectedId}
              isLast={index === options.length - 1}
              onPress={() => {
                onSelect(option.id);
                close();
              }}
            />
          ))}
        </View>
      )}
    </SwipeableBottomSheet>
  );
}

function PickerRow({
  label,
  isActive,
  isLast,
  onPress,
}: {
  label: string;
  isActive: boolean;
  isLast: boolean;
  onPress: () => void;
}) {
  const { primary } = useColors();

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityState={{ selected: isActive }}
      accessibilityLabel={label}
      className={`flex-row items-center gap-3 py-4 ${
        isLast ? '' : 'border-b border-zinc-200 dark:border-zinc-800'
      }`}
    >
      <Text numberOfLines={1} className="flex-1 text-[17px] text-zinc-900 dark:text-zinc-50">
        {label}
      </Text>
      {isActive ? <Check size={22} color={primary} /> : null}
    </TouchableOpacity>
  );
}
