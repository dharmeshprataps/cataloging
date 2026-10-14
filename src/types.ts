import { z } from 'zod';

/** ---------------------------------------------------------------------------
 * Conversation state machine
 * ------------------------------------------------------------------------- */

export const STAGES = [
  'idle',
  'collecting_images',
  'collecting_brief',
  'confirm_brief',
  'generating',
  'review',
  'approved',
  'cancelled',
] as const;

export type Stage = (typeof STAGES)[number];

/** ---------------------------------------------------------------------------
 * Asset / generation vocabulary
 * ------------------------------------------------------------------------- */

export type AssetKind = 'uploaded' | 'generated';
export type ProductAssetRole = 'input' | 'hero' | 'alternate';
export type GenerationStatus = 'pending' | 'succeeded' | 'failed';
export type MessageDirection = 'inbound' | 'outbound';

/**
 * Aspect ratios accepted by the Gemini image response_format, per the SDK's
 * ImageResponseFormatAspectRatio union. Portrait ratios are the sensible
 * default for apparel.
 */
export const ASPECT_RATIOS = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
] as const;

export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const IMAGE_SIZES = ['512', '1K', '2K', '4K'] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

/** ---------------------------------------------------------------------------
 * Structured brief
 *
 * The brief is parsed from free-form WhatsApp text into this shape before any
 * image is generated. Confirming the brief up front is the cheapest way to
 * avoid spending money on a shot the user did not want.
 * ------------------------------------------------------------------------- */

export const BriefSchema = z.object({
  garment: z
    .string()
    .describe('What the garment is, e.g. "floral cotton midi wrap dress".')
    .default('the garment shown in the reference photos'),
  model: z
    .string()
    .describe(
      'The model to wear it: age range, build, skin tone, hair. Must be a synthetic person, never a real identifiable individual.',
    )
    .default('a young adult model with a natural, neutral look'),
  pose: z.string().default('standing naturally, weight on one leg, subtle three-quarter turn'),
  setting: z.string().default('a clean, softly lit studio with a plain light-grey backdrop'),
  lighting: z.string().default('soft diffused daylight, gentle shadows, even exposure'),
  mood: z.string().default('editorial catalog, calm and premium'),
  aspectRatio: z.enum(ASPECT_RATIOS).default('4:5'),
  imageSize: z.enum(IMAGE_SIZES).default('2K'),
  notes: z
    .string()
    .describe('Anything else the user explicitly asked for, or empty.')
    .default(''),
});

export type Brief = z.infer<typeof BriefSchema>;

export const BRIEF_JSON_SCHEMA = z.toJSONSchema(BriefSchema, {
  target: 'draft-7',
  io: 'output',
}) as Record<string, unknown>;

export function defaultBrief(partial: Partial<Brief> = {}): Brief {
  return BriefSchema.parse(partial);
}

/** ---------------------------------------------------------------------------
 * Channel-neutral inbound message
 * ------------------------------------------------------------------------- */

export type InboundAttachment = {
  /** Reference the channel can resolve to bytes later. */
  externalId: string;
  mime?: string;
};

export type InboundMessage = {
  /** Channel-scoped identifier of the sender. */
  externalContactId: string;
  displayName?: string;
  /** Channel message id, used for idempotency. */
  externalMessageId: string;
  receivedAt: Date;
  text?: string;
  attachments: InboundAttachment[];
  /** Interactive button/list reply id, already normalised across channels. */
  replyId?: string;
};

/**
 * Commands a user can trigger during the review stage.
 *
 * `regenerate` exists separately from `revise` so that a bare "go" (the same
 * word used to confirm a brief) means "shoot it again as-is", while free text
 * means "change this specific thing".
 */
export type ReviewCommand = 'approve' | 'revise' | 'regenerate' | 'variations' | 'details' | 'cancel';

export function parseReviewCommand(raw: string): ReviewCommand | undefined {
  const text = raw.trim().toLowerCase();
  if (!text) return undefined;

  const table: Record<string, ReviewCommand> = {
    '1': 'approve',
    approve: 'approve',
    ok: 'approve',
    'looks good': 'approve',
    love: 'approve',
    '2': 'revise',
    revise: 'revise',
    change: 'revise',
    edit: 'revise',
    '3': 'variations',
    variations: 'variations',
    vary: 'variations',
    more: 'variations',
    '4': 'details',
    details: 'details',
    '5': 'cancel',
    cancel: 'cancel',
    stop: 'cancel',
    // Repeat-the-same-thing aliases.
    go: 'regenerate',
    again: 'regenerate',
    redo: 'regenerate',
    regenerate: 'regenerate',
  };
  return table[text];
}

/** Thank-you and pleasantry replies that should not be read as instructions. */
export function isPleasantry(raw: string): boolean {
  return /^(thanks|thank you|ty|cheers|nice|cool|great|perfect|awesome|wow|👍|🙏)[.! ]*$/i.test(
    raw.trim(),
  );
}
