import { describe, expect, it } from 'vitest';
import { resolveActiveRoleTemplate } from './roleTemplate';

describe('resolveActiveRoleTemplate', () => {
    it('resolves the active role template from canonical aiSettings only', () => {
        const plugin = {
            settings: {}
        } as any;

        const result = resolveActiveRoleTemplate(plugin, {
            roleTemplateId: 'canonical',
            roleTemplates: [
                { id: 'legacy', name: 'Legacy', prompt: 'Legacy prompt', isBuiltIn: false },
                { id: 'canonical', name: 'Canonical', prompt: 'Canonical prompt', isBuiltIn: true }
            ]
        } as any);

        expect(result.name).toBe('Canonical');
        expect(result.prompt).toBe('Canonical prompt');
    });
});
