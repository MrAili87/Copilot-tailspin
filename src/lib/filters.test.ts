import { describe, it, expect } from 'vitest';
import { slugify, parseFilterParam, buildFilterQuery } from './filters';

describe('slugify', () => {
    it.each([
        ['Strategy', 'strategy'],
        ['Card Games', 'card-games'],
        ['DevMasters Inc.', 'devmasters-inc'],
        ['  Ops Interactive  ', 'ops-interactive'],
        ['Role/Playing & Fun', 'role-playing-fun'],
        ['Café Games', 'cafe-games'],
        ['---', ''],
        ['', ''],
    ])('converts %j to %j', (input: string, expected: string) => {
        expect(slugify(input)).toBe(expected);
    });

    it('is deterministic for the same input', () => {
        expect(slugify('Puzzle Masters')).toBe(slugify('Puzzle Masters'));
    });
});

describe('parseFilterParam', () => {
    it.each([
        [null, []],
        ['', []],
        ['   ', []],
        ['strategy', ['strategy']],
        ['strategy,puzzle', ['strategy', 'puzzle']],
        [' strategy , puzzle ', ['strategy', 'puzzle']],
        ['strategy,strategy', ['strategy']],
        ['Strategy,PUZZLE', ['strategy', 'puzzle']],
        ['strategy,,puzzle', ['strategy', 'puzzle']],
    ])('parses %j into %j', (input: string | null, expected: string[]) => {
        expect(parseFilterParam(input)).toEqual(expected);
    });
});

describe('buildFilterQuery', () => {
    it('returns an empty string when nothing is selected', () => {
        expect(buildFilterQuery([], [])).toBe('');
    });

    it('includes only the groups that have selections', () => {
        expect(buildFilterQuery(['strategy'], [])).toBe('?category=strategy');
        expect(buildFilterQuery([], ['github-games'])).toBe('?publisher=github-games');
    });

    it('combines both groups with comma-separated values', () => {
        expect(buildFilterQuery(['strategy', 'puzzle'], ['github-games'])).toBe(
            '?category=strategy%2Cpuzzle&publisher=github-games',
        );
    });

    it('round-trips through parseFilterParam', () => {
        const query = buildFilterQuery(['strategy', 'puzzle'], ['github-games']);
        const params = new URLSearchParams(query);
        expect(parseFilterParam(params.get('category'))).toEqual(['strategy', 'puzzle']);
        expect(parseFilterParam(params.get('publisher'))).toEqual(['github-games']);
    });
});
