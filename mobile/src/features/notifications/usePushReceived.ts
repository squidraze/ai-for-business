import { useEffect, useRef } from 'react';

import { pushReceived, type PushData } from './events';

/** Calls `listener` for every push received in the foreground or tapped. */
export function usePushReceived(listener: (data: PushData) => void) {
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(() => pushReceived.subscribe((data) => latest.current(data)), []);
}
