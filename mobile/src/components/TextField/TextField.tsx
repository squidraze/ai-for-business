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
  /** Small text at the right under the field (e.g. a "120/4000" counter). */
  counter?: string;
  /** Turns the counter red (e.g. over the limit). */
  counterError?: boolean;
  ref?: Ref<TextInputRef>;
};

export function TextField({
  label,
  error,
  right,
  counter,
  counterError,
  multiline,
  style,
  onFocus,
  onBlur,
  ref,
  ...rest
}: TextFieldProps) {
  const c = useColors();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? c.danger : focused ? c.primary : c.border;
  return (
    <View style={styles.wrap}>
      {label ? <Text style={[styles.label, { color: error ? c.danger : c.muted }]}>{label}</Text> : null}
      <View
        style={[
          styles.box,
          multiline ? styles.boxMultiline : null,
          { backgroundColor: c.inputBg, borderColor },
        ]}
      >
        <TextInput
          ref={ref}
          placeholderTextColor={c.muted}
          accessibilityLabel={label}
          multiline={multiline}
          textAlignVertical={multiline ? 'top' : undefined}
          {...rest}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[styles.input, multiline ? styles.inputMultiline : null, { color: c.text }, style]}
        />
        {right}
      </View>
      {error || counter ? (
        <View style={styles.below}>
          <Text style={[styles.error, { color: c.danger }]} accessibilityLiveRegion="polite">
            {error ?? ''}
          </Text>
          {counter ? (
            <Text style={[styles.counter, { color: counterError ? c.danger : c.muted }]}>{counter}</Text>
          ) : null}
        </View>
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
  boxMultiline: { height: undefined, minHeight: 120, maxHeight: 260, alignItems: 'stretch' },
  input: { flex: 1, height: '100%', paddingHorizontal: 14, fontSize: 16 },
  inputMultiline: { height: undefined, paddingTop: 12, paddingBottom: 12, lineHeight: 21 },
  below: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 6 },
  error: { flex: 1, fontSize: 13 },
  counter: { fontSize: 12, marginLeft: 8 },
});
