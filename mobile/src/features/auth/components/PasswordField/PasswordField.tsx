import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, TouchableOpacity } from 'react-native';

import { useColors } from '@/lib/theme';

import { TextField, type TextFieldProps } from '../TextField';

/** Text field with a show/hide toggle. */
export function PasswordField(props: Omit<TextFieldProps, 'secureTextEntry' | 'right'>) {
  const c = useColors();
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      autoCapitalize="none"
      autoCorrect={false}
      {...props}
      secureTextEntry={!visible}
      right={
        <TouchableOpacity
          onPress={() => setVisible((v) => !v)}
          hitSlop={8}
          style={styles.eye}
          accessibilityRole="button"
          accessibilityLabel={visible ? t('auth.hidePassword') : t('auth.showPassword')}
        >
          <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={20} color={c.muted} />
        </TouchableOpacity>
      }
    />
  );
}

const styles = StyleSheet.create({
  eye: { paddingHorizontal: 14, height: '100%', justifyContent: 'center' },
});
