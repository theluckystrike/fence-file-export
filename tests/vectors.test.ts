import { describe, expect, it } from 'vitest';
import vectors from './vectors/fence-file-export.json';
import { planExport, preflight, writeTargets, type Target, type Plan } from '../src/export';
import { memoryVault } from './vault';

describe('Golden acceptance vectors', () => {
	it('has at least 20 cases', () => expect(vectors.cases.length).toBeGreaterThanOrEqual(20));
	for (const c of vectors.cases) it(c.name, async () => {
		const row = c as { function?: string; args: unknown[]; expected: unknown };
		if (row.function === 'preflight') {
			const [plan, entries] = row.args as [Plan, Record<string, 'file' | 'folder'>];
			expect(preflight(plan, memoryVault(entries))).toEqual(row.expected);
		} else if (row.function === 'writeTargets') {
			const [targets, entries, fail] = row.args as [Target[], Record<string, 'file' | 'folder'>, string[]];
			const vault = memoryVault(entries, fail);
			expect(await writeTargets(targets, vault)).toEqual(row.expected);
		} else {
			const [source, folder, config] = row.args as [string, string, string];
			expect(planExport(source, folder, config)).toEqual(row.expected);
		}
	});
});
