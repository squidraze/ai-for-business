import React from 'react';

import { AnimatedSwitch } from '@/components/AnimatedSwitch';

import { ProfileRow, type RowIcon } from '../ProfileRow';

export type SettingsRowProps = {
  icon: RowIcon;
  label: string;
  subtitle?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
};

/** One toggle row of the preferences card (ported from rooler `SettingsRow`). */
export function SettingsRow({ icon, label, subtitle, value, onChange, disabled }: SettingsRowProps) {
  return (
    <ProfileRow
      icon={icon}
      label={label}
      subtitle={subtitle}
      trailing={
        <AnimatedSwitch
          value={value}
          onValueChange={onChange}
          disabled={disabled}
        />
      }
    />
  );
}
