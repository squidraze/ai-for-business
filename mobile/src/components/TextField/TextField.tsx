import { useState, type ComponentRef, type ReactNode, type Ref } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { useColors } from '@/lib/theme';

/** The instance behind a TextInput ref (focus, blur…). */
export type TextInputRef = ComponentRef<typeof TextInput>;

export type TextFieldProps = TextInputProps & {
  label?: string;
  /** Inline error under the field; also turns the border red. */
  error?: string | null;
  /** Element inside the field on the right (e.g. the password eye). */
  right?: ReactNode;
  ref?: Ref<TextInputRef>;
};

export function TextField({ label, error, right, style, onFocus, onBlur, ref, ...rest }: TextFieldProps) {
  const c = useColors();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? c.danger : focused ? c.primary : c.border;
  return (
    <View style={styles.wrap}>
      {label ? <Text style={[styles.label, { color: error ? c.danger : c.muted }]}>{label}</Text> : null}
      <View style={[styles.box, { backgroundColor: c.inputBg, borderColor }]}>
        <TextInput
          ref={ref}
          placeholderTextColor={c.muted}
          accessibilityLabel={label}
          {...rest}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[styles.input, { color: c.text }, style]}
        />
        {right}
      </View>
      {error ? (
        <Text style={[styles.error, { color: c.danger }]} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: { fontSize: 13, marginBottom: 6, fontWeight: '500' },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
  },
  input: { flex: 1, height: '100%', paddingHorizontal: 14, fontSize: 16 },
  error: { fontSize: 13, marginTop: 6 },
});
