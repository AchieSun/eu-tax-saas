/**
 * Minimal local declaration for Vite's `import.meta.glob`.
 *
 * The full `vite/client` typings are not hoisted into `node_modules/` (vinxi
 * pulls vite via its own dependency tree), so we declare only what we need
 * for the W4 forms loader. This is sufficient for the `eager + query:'?raw'
 * + import:'default'` shape we use in src/forms/load.ts.
 *
 * See: https://vitejs.dev/guide/features.html#glob-import
 */

interface ImportMeta {
  glob<T = unknown>(
    pattern: string | string[],
    options: {
      eager: true;
      query: '?raw';
      import: 'default';
    },
  ): Record<string, T>;

  glob<T = unknown>(
    pattern: string | string[],
    options?: {
      eager?: boolean;
      query?: string;
      import?: string;
    },
  ): Record<string, T>;
}
