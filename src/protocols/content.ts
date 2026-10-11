import { z } from 'zod';

/** Text block inside a multimodal message. */
export const TextPartSchema = z
  .object({
    type: z.literal('text'),
    text: z.string(),
  })
  .strict();

/** Image block inside a multimodal message; `data` is base64-encoded bytes. */
export const ImagePartSchema = z
  .object({
    type: z.literal('image'),
    data: z.string().min(1),
    mimeType: z.string().min(1),
  })
  .strict();

/**
 * Message content block shared by `core` and LLM providers.
 *
 * Text and image parts are the only shapes both sides need to agree on; the
 * provider adapts them to its own wire format. Keeping this in `protocols`
 * means a new part type is a protocol change, not a provider-only detail.
 */
export const ContentPartSchema = z.discriminatedUnion('type', [
  TextPartSchema,
  ImagePartSchema,
]);

export type TextPart = z.infer<typeof TextPartSchema>;
export type ImagePart = z.infer<typeof ImagePartSchema>;
export type ContentPart = z.infer<typeof ContentPartSchema>;

/** Validate unknown input as an image content part. */
export function parseImagePart(input: unknown): ImagePart {
  return ImagePartSchema.parse(input);
}
