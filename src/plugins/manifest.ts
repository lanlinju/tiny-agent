import { z } from 'zod';

/** Runtime validation for a plugin's `plugin.json` manifest. */
export const PluginManifestSchema = z.object({
  name: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'plugin name must be lowercase kebab-case'),
  version: z.string().min(1),
  description: z.string().optional(),
  permissions: z.array(z.string().min(1)).optional(),
  entry: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

export function parsePluginManifest(input: unknown): z.infer<typeof PluginManifestSchema> {
  return PluginManifestSchema.parse(input);
}
