import { Pencil, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';

import { AppTextInput } from '@/components/AppTextInput';
import { FormError } from '@/components/FormError';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SwipeableBottomSheet } from '@/components/SwipeableBottomSheet';
import { errorMessage } from '@/lib/api';
import { LABEL_TEXT, SECONDARY_LABEL_TEXT, useLabelColors } from '@/lib/screen';
import { useColors } from '@/lib/theme';

import type { AIConversation } from '../../chat.api';
import { useDeleteConversation, useRenameConversation } from '../../chat.hooks';

const MAX_TITLE_LENGTH = 100;

/** Neutral button overrides for {@link PrimaryButton} — a pair per theme. */
const NEUTRAL = {
  colorClassName: 'bg-gray-100 dark:bg-zinc-800',
  textClassName: 'text-black dark:text-white',
} as const;

type Mode = 'menu' | 'rename' | 'delete';

/**
 * Long-press actions for a conversation (rooler business `ChatActionsSheet`):
 * Rename swaps the menu for a text field + Save; Delete asks once, then removes
 * the chat. Both refresh the list. The parent mounts it only while a
 * conversation is selected, so every opening starts fresh.
 */
export function ChatActionsSheet({
  conversation,
  onClose,
}: {
  conversation: AIConversation;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const labelColors = useLabelColors();
  const rename = useRenameConversation();
  const remove = useDeleteConversation();

  const [mode, setMode] = useState<Mode>('menu');
  const [title, setTitle] = useState(conversation.title ?? '');
  const [error, setError] = useState<string | null>(null);

  const busy = rename.isPending || remove.isPending;
  const trimmed = title.trim();
  const renameDisabled = busy || !trimmed || trimmed === (conversation.title ?? '').trim();

  const switchMode = (next: Mode) => {
    setError(null);
    setMode(next);
  };

  const handleRename = async (close: () => void) => {
    if (renameDisabled) return;
    setError(null);
    try {
      await rename.mutateAsync({ uuid: conversation.uuid, title: trimmed.slice(0, MAX_TITLE_LENGTH) });
      close();
    } catch (e) {
      setError(errorMessage(e, t('chats.renameFailed')));
    }
  };

  const handleDelete = async (close: () => void) => {
    setError(null);
    try {
      await remove.mutateAsync(conversation.uuid);
      close();
    } catch (e) {
      setError(errorMessage(e, t('chats.deleteFailed')));
    }
  };

  const displayTitle = conversation.title?.trim() || t('chats.untitled');

  return (
    <SwipeableBottomSheet isOpen onClose={onClose}>
      {({ close }) =>
        mode === 'rename' ? (
          <View className="pb-2">
            <Text className={`mb-4 text-lg font-semibold ${LABEL_TEXT}`}>{t('chats.rename')}</Text>
            <FormError message={error} />
            <AppTextInput
              value={title}
              onChangeText={setTitle}
              placeholder={t('chats.untitled')}
              maxLength={MAX_TITLE_LENGTH}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => void handleRename(close)}
              containerClassName="mb-4"
            />
            <View className="flex-row gap-3">
              <PrimaryButton
                label={t('common.cancel')}
                size="sm"
                className="flex-1"
                {...NEUTRAL}
                iconColor={labelColors.label}
                disabled={busy}
                onPress={() => switchMode('menu')}
              />
              <PrimaryButton
                label={t('chats.save')}
                size="sm"
                className="flex-1"
                loading={rename.isPending}
                disabled={renameDisabled}
                onPress={() => void handleRename(close)}
              />
            </View>
          </View>
        ) : mode === 'delete' ? (
          <View className="pb-2">
            <Text className={`mb-1 text-lg font-semibold ${LABEL_TEXT}`}>{t('chats.deleteTitle')}</Text>
            <Text className={`mb-4 text-[15px] ${SECONDARY_LABEL_TEXT}`} numberOfLines={2}>
              {t('chats.deleteText', { title: displayTitle })}
            </Text>
            <FormError message={error} />
            <View className="flex-row gap-3">
              <PrimaryButton
                label={t('common.cancel')}
                size="sm"
                className="flex-1"
                {...NEUTRAL}
                iconColor={labelColors.label}
                disabled={busy}
                onPress={() => switchMode('menu')}
              />
              <PrimaryButton
                label={t('common.delete')}
                size="sm"
                className="flex-1"
                colorClassName="bg-red-600 dark:bg-red-500"
                loading={remove.isPending}
                onPress={() => void handleDelete(close)}
              />
            </View>
          </View>
        ) : (
          <View className="pb-2">
            <Text className={`mb-1 px-2 text-[15px] ${SECONDARY_LABEL_TEXT}`} numberOfLines={1}>
              {displayTitle}
            </Text>
            <TouchableOpacity
              onPress={() => switchMode('rename')}
              disabled={busy}
              activeOpacity={0.7}
              className="flex-row items-center px-2 py-4"
              accessibilityRole="button"
              accessibilityLabel={t('chats.rename')}
            >
              <View className="mr-4 h-10 w-10 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
                <Pencil size={20} color={labelColors.label} />
              </View>
              <Text className={`text-base font-medium ${LABEL_TEXT}`}>{t('chats.rename')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => switchMode('delete')}
              disabled={busy}
              activeOpacity={0.7}
              className="flex-row items-center px-2 py-4"
              accessibilityRole="button"
              accessibilityLabel={t('common.delete')}
            >
              <View className="mr-4 h-10 w-10 items-center justify-center rounded-full bg-red-50 dark:bg-zinc-800">
                {remove.isPending ? (
                  <ActivityIndicator size="small" color={c.danger} />
                ) : (
                  <Trash2 size={20} color={c.danger} />
                )}
              </View>
              <Text className="text-base font-medium text-red-600 dark:text-red-400">
                {t('common.delete')}
              </Text>
            </TouchableOpacity>
          </View>
        )
      }
    </SwipeableBottomSheet>
  );
}
