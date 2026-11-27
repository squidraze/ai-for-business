import { Text, View } from 'react-native';

/** A deal stage or a lead status: a small brand-tinted pill. */
export function StagePill({ label }: { label?: string | null }) {
  if (!label) return null;
  return (
    <View className="max-w-[200px] self-start rounded-full bg-primary/15 px-2 py-0.5">
      <Text className="text-xs font-semibold text-primary" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}
