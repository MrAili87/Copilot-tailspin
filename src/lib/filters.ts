/**
 * Pure helpers for turning category/publisher names into URL-safe slugs and for
 * reading filter selections back out of a query string.
 *
 * This module is intentionally dependency-free: it is imported both by Astro
 * frontmatter (build time) and by the client-side filtering script on the home
 * page, so it must not pull in anything Node-specific.
 */

/**
 * Convert a display name into a lowercase, URL-safe slug.
 *
 * Deterministic by design — static builds generate filter routes from these
 * slugs, so the same name must always produce the same path.
 *
 * @param value - Display name to convert (for example a category name).
 * @returns The slugified value, or an empty string when nothing usable remains.
 */
export function slugify(value: string): string {
    return value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Parse a comma-separated filter query parameter into a list of slugs.
 *
 * @param value - Raw query parameter value, or `null` when the parameter is absent.
 * @returns Trimmed, de-duplicated, non-empty slugs in the order they appeared.
 */
export function parseFilterParam(value: string | null): string[] {
    if (!value) {
        return [];
    }

    const seen = new Set<string>();
    for (const part of value.split(',')) {
        const slug = part.trim().toLowerCase();
        if (slug) {
            seen.add(slug);
        }
    }
    return [...seen];
}

/**
 * Build the query string that represents the current filter selection.
 *
 * @param categorySlugs - Selected category slugs.
 * @param publisherSlugs - Selected publisher slugs.
 * @returns A query string beginning with `?`, or an empty string when nothing is selected.
 */
export function buildFilterQuery(categorySlugs: string[], publisherSlugs: string[]): string {
    const params = new URLSearchParams();
    if (categorySlugs.length > 0) {
        params.set('category', categorySlugs.join(','));
    }
    if (publisherSlugs.length > 0) {
        params.set('publisher', publisherSlugs.join(','));
    }
    const query = params.toString();
    return query ? `?${query}` : '';
}
