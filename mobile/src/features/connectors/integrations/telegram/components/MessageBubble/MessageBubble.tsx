import { FileText, Image, Mic, Smile, Video, type LucideIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { timeOfDay } from '@/lib/format';
import { useColors } from '@/lib/theme';

import type { TelegramMediaKind, TelegramMessage } from '../../telegram.api';

const MEDIA_ICONS: Record<TelegramMediaKind, LucideIcon> = {
  photo: Image,
  video: Video,
  document: FileText,
  voice: Mic,
  sticker: Smile,
};

/** One message bubble; `showSender` adds the author's name (groups). */
export function MessageBubble({ message, showSender }: { message: TelegramMessage; showSender: boolean }) {
  const c = useColors();
  const { t } = useTranslation();
  const out = !!message.out;
  const MediaIcon = message.media ? MEDIA_ICONS[message.media] : undefined;
  const fg = out ? c.bubbleOutText : c.text;

  return (
    <View style={[styles.row, { justifyContent: out ? 'flex-end' : 'flex-start' }]}>
      <View
        style={[
          styles.bubble,
          out
            ? { backgroundColor: c.bubbleOut, borderBottomRightRadius: 4 }
            : {
                backgroundColor: c.bubbleIn,
                borderBottomLeftRadius: 4,
                borderColor: c.border,
                borderWidth: StyleSheet.hairlineWidth,
              },
        ]}
      >
        {showSender && message.sender_name ? (
          <Text style={[styles.sender, { color: c.primary }]} numberOfLines={1}>
            {message.sender_name}
          </Text>
        ) : null}
        {MediaIcon && message.media ? (
          <View style={styles.media}>
            <MediaIcon size={16} color={fg} />
            <Text style={[styles.mediaText, { color: fg }]}>{t(`telegram.media.${message.media}`)}</Text>
          </View>
        ) : null}
        {message.text ? <Text style={[styles.text, { color: fg }]}>{message.text}</Text> : null}
        <Text style={[styles.time, { color: out ? 'rgba(255,255,255,0.75)' : c.muted }]}>
          {timeOfDay(message.date)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', marginVertical: 2 },
  bubble: { maxWidth: '80%', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 7 },
  sender: { fontSize: 13, fontWeight: '600', marginBottom: 2 },
  text: { fontSize: 16, lineHeight: 21 },
  time: { fontSize: 11, alignSelf: 'flex-end', marginTop: 2 },
  media: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  mediaText: { fontSize: 14, fontStyle: 'italic', marginLeft: 5 },
});
