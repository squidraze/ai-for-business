/**
 * Mock generative-UI data — a stand-in for what the backend publishes over
 * Centrifugo as `ai.tool_call`, so the whole render path can be exercised with no
 * backend and no `ai:` channel grant.
 *
 * Each entry mirrors the real payload: `{ tool, args }`. `buildDemoParts()` turns
 * them into assistant message parts (interleaved with a little text) — exactly
 * how a real turn arrives, minus the wire. Backs the dev-only `/ui`, `/ui-demo`
 * and `/demo` commands.
 */
import type { MessagePart } from '@/chat/types';

import type { ToolArgs, ToolName } from './registry';

type MockToolCall = { [K in ToolName]: { tool: K; args: ToolArgs[K] } }[ToolName];

/** One of each block, with realistic-looking args. This is the catalog. */
export const MOCK_TOOL_CALLS: MockToolCall[] = [
  {
    tool: 'render_shipment_card',
    args: {
      id: 'ST-4821',
      status: 'in_transit',
      origin: 'Chicago, IL',
      destination: 'Dallas, TX',
      driver: 'M. Reeves',
      eta: 'Tomorrow, 14:30',
      progress: 62,
    },
  },
  {
    tool: 'render_waypoints_timeline',
    args: {
      stops: [
        { name: 'Chicago DC', address: '1200 W Fulton St', time: 'Mon 08:00', done: true },
        { name: 'St. Louis Hub', address: '400 Market St', time: 'Mon 19:40', done: true },
        { name: 'Little Rock', address: '2100 Cantrell Rd', time: 'Tue 06:15', done: false },
        { name: 'Dallas DC', address: '900 S Lamar St', time: 'Tue 14:30', done: false },
      ],
    },
  },
  {
    tool: 'render_stats',
    args: {
      title: 'Last week',
      items: [
        { label: 'Delivered', value: '128', delta: 12 },
        { label: 'On-time', value: '94%', delta: 3 },
        { label: 'Delayed', value: '7', delta: -18 },
      ],
    },
  },
  {
    tool: 'render_bar_chart',
    args: {
      title: 'Deliveries by day',
      unit: 'loads',
      data: [
        { label: 'Mon', value: 22 },
        { label: 'Tue', value: 30 },
        { label: 'Wed', value: 18 },
        { label: 'Thu', value: 27 },
        { label: 'Fri', value: 34 },
      ],
    },
  },
  {
    tool: 'render_table',
    args: {
      title: 'Active shipments',
      columns: ['ID', 'Route', 'Status', 'ETA'],
      rows: [
        ['ST-4821', 'Chicago → Dallas', 'In transit', 'Tue 14:30'],
        ['ST-4822', 'Denver → Phoenix', 'Delayed', 'Wed 09:10'],
        ['ST-4823', 'Miami → Atlanta', 'Delivered', '—'],
      ],
    },
  },
  {
    tool: 'render_alert',
    args: {
      level: 'warning',
      title: 'Shipment ST-4822 is delayed',
      message: 'Weather on I-70 pushed the ETA back by ~2 hours. The customer has been notified.',
    },
  },
  {
    tool: 'render_contact_card',
    args: {
      name: 'Marcus Reeves',
      role: 'Driver · Truck 118',
      phone: '+1 (312) 555-0142',
      initials: 'MR',
    },
  },
];

/**
 * Build a single assistant turn that shows every block once, with a line of text
 * before it — the shape a real generative-UI turn takes.
 */
export function buildDemoParts(): MessagePart[] {
  const toolCall = (toolName: string, args: unknown, i: number): MessagePart => ({
    type: 'tool-call',
    toolCallId: `demo-${i}`,
    toolName,
    args,
  });

  return [
    {
      type: 'text',
      text: 'Generative-UI blocks — the backend picks one and fills its args:',
    },
    ...MOCK_TOOL_CALLS.map((call, i) => toolCall(call.tool, call.args, i)),
    {
      type: 'text',
      text: 'And this is how a block reaches the app it lives in:',
    },
    toolCall('render_aui_showcase', {}, MOCK_TOOL_CALLS.length),
  ];
}
