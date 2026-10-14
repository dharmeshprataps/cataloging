/**
 * All user-facing strings live here, so the bot's tone can be tuned in one place
 * without touching control flow. Written for a busy designer on a phone:
 * short lines, explicit next actions, no jargon.
 */

export const COPY = {
  greeting: [
    "Hi! I'm your catalog studio. 📸",
    '',
    'Send me photos of a garment (flat, on a hanger, or on a mannequin) and',
    "I'll show you what it looks like worn by a model — no photoshoot needed.",
    '',
    'Tip: send 2–3 photos from different angles for the most accurate result.',
  ].join('\n'),

  help: [
    'How this works:',
    '',
    '1. Send me 1–3 photos of one garment.',
    '2. Tell me the vibe — model, pose, background, lighting. Or just say',
    '   "studio, white background" and I\'ll fill in the rest.',
    "3. I'll show you the brief, then generate the shot.",
    '4. Reply 1 to approve, 2 to change something, 3 for variations.',
    '',
    'You can also send "sku <your-code>" to tag the item, and "cancel" to stop.',
  ].join('\n'),

  needImages: [
    'Sure — send me the photo(s) of the garment you want to style.',
    '1–3 angles works best.',
  ].join('\n'),

  gotImagesNoBrief: (count: number) =>
    [
      `Got ${count === 1 ? 'your photo' : `${count} photos`}. ✅`,
      '',
      'Now describe the shot you want. For example:',
      '"women\'s dress, outdoor daytime, model walking, warm natural light, 4:5"',
      '',
      "Or just say \"clean studio, white background\" and I'll choose sensible defaults.",
    ].join('\n'),

  gotAdditionalImages: (count: number) =>
    `Added ${count} more photo${count === 1 ? '' : 's'}. Tell me when to generate, or say "go".`,

  confirmBrief: (lines: string[]) =>
    [
      "Here's the brief I'll use:",
      '',
      ...lines.map((l) => `• ${l}`),
      '',
      'Reply *go* to generate, or tell me what to change.',
    ].join('\n'),

  generating: (n: number) =>
    n === 1
      ? 'On it — generating your shot. This takes ~15–30 seconds. ⏳'
      : `On it — generating ${n} variations. This takes a minute or so. ⏳`,

  reviewPrompt: (remaining: number) =>
    [
      'Here it is. 👍',
      '',
      '1️⃣ Approve — save to catalog',
      '2️⃣ Change something — e.g. "2, make the light warmer"',
      '3️⃣ More variations — different poses and angles',
      '4️⃣ Show the brief',
      '5️⃣ Cancel',
      '',
      `${remaining} generations left in this item.`,
    ].join('\n'),

  approved: (sku: string | null, title: string) =>
    [
      `Saved to your catalog. ✅`,
      sku ? `SKU: ${sku}` : 'No SKU set — reply "sku <code>" next time to tag items.',
      `Item: ${title}`,
      '',
      'Send a photo of the next garment and I\'ll start a fresh item.',
    ].filter(Boolean).join('\n'),

  cancelled: 'Cancelled. Send a photo whenever you want to start again.',

  youreWelcome: [
    'Glad you like it! 👍',
    '',
    'Reply 1 to save it, 2 to change something, or 3 for more variations.',
  ].join('\n'),

  regenerateFailed: 'Sorry — that generation failed. Reply *2* to try again with a tweak, or *3* for variations.',

  contentPolicy:
    'The image model declined that one (it can happen with certain poses or descriptions).\n\nReply *2* and describe the change, and I\'ll adjust the brief.',

  busyGenerating: 'Still working on the previous shot — one moment. ⏳',

  generationCap: (max: number) =>
    `We've hit the ${max}-generation limit for this item. Reply *1* to save the best one, or *5* to cancel and start fresh.`,

  noOutputYet: 'I don\'t have a shot to work from yet. Send me garment photos to begin.',

  detailsOnlyInReview: 'Nothing to review yet — send me photos of a garment to get started.',

  unrecognised: [
    "I didn't catch that. You can:",
    '• send a garment photo',
    '• describe the shot you want',
    '• reply 1 approve / 2 change / 3 variations',
    '• reply "help" for the full guide',
  ].join('\n'),

  error: 'Something went wrong on my side. Please try that again.',
} as const;

/** Renders the brief as scannable bullets for confirmation. */
export function briefToLines(brief: {
  garment: string;
  model: string;
  pose: string;
  setting: string;
  lighting: string;
  mood: string;
  aspectRatio: string;
}): string[] {
  return [
    `Garment: ${brief.garment}`,
    `Model: ${brief.model}`,
    `Pose: ${brief.pose}`,
    `Setting: ${brief.setting}`,
    `Lighting: ${brief.lighting}`,
    `Mood: ${brief.mood}`,
    `Format: ${brief.aspectRatio}`,
  ];
}
