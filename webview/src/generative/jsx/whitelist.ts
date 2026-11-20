/**
 * The whitelist a generated view is rendered against, and what is filtered out.
 *
 * Split from `ArtifactView` only because a module that exports components may not
 * also export constants without breaking fast refresh — this is the same contract,
 * read the component file for how it is applied.
 */
import {
  Alert,
  AlertDescription,
  ArtifactBox,
  AlertTitle,
  Badge,
  BarChart,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  InertText,
  LineChart,
  PieChart,
  PlacesMap,
  Progress,
  Separator,
  Stat,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from './primitives';

/**
 * The whitelist, by the exact tag name the model writes.
 *
 * `a` and `button` are mapped rather than blacklisted: blacklisting drops the
 * children with the tag, and losing the words inside a link is worse than losing
 * the link.
 */
export const COMPONENTS = {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Badge,
  Alert,
  AlertTitle,
  AlertDescription,
  Separator,
  Stat,
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
  BarChart,
  LineChart,
  PieChart,
  PlacesMap,
  Progress,
  a: InertText,
  button: InertText,
  // The model's own layout box, marked so the CSS can find it — see ArtifactBox.
  div: ArtifactBox,
};

/** The names the model may use — logged when it reaches for something else. */
export const ARTIFACT_COMPONENT_NAMES = Object.keys(COMPONENTS);

/**
 * Attributes stripped before they reach an element.
 *
 * `on*` and `dangerouslySetInnerHTML` are the injection surface. `style` is too
 * (`url(...)`, and a fixed-position overlay on top of the chat). `class`/
 * `className` go for the reasons in `primitives.tsx` — Tailwind never emits a
 * class it did not see in source, and the model's colours are not theme-aware.
 */
export const BLACKLISTED_ATTRS = [
  /^on.+/i,
  /^dangerouslySetInnerHTML$/i,
  /^style$/i,
  /^class$/i,
  /^className$/i,
];

/** Tags that load, submit or take input — none of which a generated view does. */
export const BLACKLISTED_TAGS = [
  'script',
  'style',
  'link',
  'meta',
  'base',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'select',
  'textarea',
  'img',
  'picture',
  'source',
  'video',
  'audio',
  'canvas',
  'svg',
];
