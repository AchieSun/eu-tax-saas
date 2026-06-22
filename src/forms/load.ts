/**
 * YAML form-mapping loader.
 *
 * Uses Vite's `import.meta.glob` to embed every `*.yml` under `app/src/forms/`
 * at build time. This works both in:
 *   - vitest (Vite-powered transformer)
 *   - the production Workers bundle (wrangler/vinxi → Vite)
 *
 * Path convention for production mappings:
 *     app/src/forms/<COUNTRY>/<YEAR>/<form>.yml      e.g. DE/2024/mantelbogen.yml
 *
 * Fixture / test mappings live under:
 *     app/src/forms/__fixtures__/<name>.yml
 * They are explicitly excluded from `loadAllMappings()` so the ingest CLI never
 * accidentally writes test data into D1.
 *
 * `ImportMeta.glob` is declared in `src/types/vite-glob.d.ts`.
 */

import { parse as parseYaml } from 'yaml';
import { type FormMapping, FormMappingSchema } from './types';

// `import.meta.glob` with `query: '?raw'` + `import: 'default'` returns each
// matched file's raw string contents (eagerly, at module init).
const yamlModules = import.meta.glob<string>('./**/*.yml', {
  eager: true,
  query: '?raw',
  import: 'default',
});

const isFixturePath = (path: string) => path.includes('/__fixtures__/');

/**
 * Parse a YAML string into a validated `FormMapping`.
 *
 * Throws `ZodError` on schema violation (e.g. missing citation,
 * unknown transform, invalid country code).
 *
 * Exported for testability + direct use from the ingest CLI.
 */
export function parseFormMapping(yamlContent: string): FormMapping {
  const raw = parseYaml(yamlContent);
  return FormMappingSchema.parse(raw);
}

/**
 * Look up a specific production mapping by `(country, year, form)`.
 *
 * Returns `null` when no matching YAML is embedded. Throws if a matching
 * YAML exists but is malformed (fail loud — bad data must never reach D1).
 */
export function loadFormMapping(country: string, year: number, form: string): FormMapping | null {
  const path = `./${country}/${year}/${form}.yml`;
  const content = yamlModules[path];
  if (!content) return null;
  return parseFormMapping(content);
}

/**
 * Load every production mapping (i.e. excluding `__fixtures__/`).
 *
 * Used by the T1.4 ingest CLI and admin tooling. Throws with an annotated
 * message identifying the offending file when any YAML fails validation.
 */
export function loadAllMappings(): FormMapping[] {
  const results: FormMapping[] = [];
  for (const [path, content] of Object.entries(yamlModules)) {
    if (isFixturePath(path)) continue;
    try {
      results.push(parseFormMapping(content));
    } catch (e) {
      throw new Error(`Failed to parse ${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return results;
}

/**
 * Expose raw fixture YAML strings keyed by their basename (without `.yml`).
 *
 * **Testing only.** Production code must never branch on fixture presence.
 */
export function loadFixtureMappings(): Record<string, string> {
  const fixtures: Record<string, string> = {};
  for (const [path, content] of Object.entries(yamlModules)) {
    if (!isFixturePath(path)) continue;
    const name = path.split('/__fixtures__/')[1]?.replace(/\.yml$/, '') ?? path;
    fixtures[name] = content;
  }
  return fixtures;
}
