import { describe, expect, it } from 'vitest';
import { adaptPandocLayoutToTemplateProfile, adaptPandocLayoutsToPublishingModel } from './publishingModel';

describe('publishingModel adapter', () => {
    it('preserves stable ids when adapting layouts to profiles', () => {
        const model = adaptPandocLayoutsToPublishingModel([
            {
                id: 'bundled-fiction-signature-literary',
                name: 'Signature Literary',
                preset: 'novel',
                path: 'rt_signature_literary.tex',
                bundled: true,
                hasSceneOpenerHeadingOptions: true,
            },
        ]);

        expect(model.assets).toHaveLength(1);
        expect(model.assets[0].id).toBe('bundled-fiction-signature-literary::asset');
        expect(model.profiles).toHaveLength(1);
        expect(model.profiles[0].id).toBe('bundled-fiction-signature-literary');
        expect(model.profiles[0].legacyLayoutId).toBe('bundled-fiction-signature-literary');
        expect(model.profiles[0].assetId).toBe('bundled-fiction-signature-literary::asset');
        expect(model.profiles[0].origin).toBe('built-in');
        expect(model.profiles[0].tier).toBe('pro');
        expect(model.profiles[0].templateKind).toBe('book');
    });

    it('infers non-novel output intents without collapsing preset truth', () => {
        const screenplay = adaptPandocLayoutToTemplateProfile({
            id: 'bundled-screenplay',
            name: 'Screenplay',
            preset: 'screenplay',
            path: 'screenplay_template.tex',
            bundled: true,
        });
        const podcast = adaptPandocLayoutToTemplateProfile({
            id: 'bundled-podcast',
            name: 'Podcast Script',
            preset: 'podcast',
            path: 'podcast_template.tex',
            bundled: true,
        });

        expect(screenplay.usageContexts).toEqual(['screenplay']);
        expect(screenplay.outputIntent).toBe('screenplay-pdf');
        expect(screenplay.tier).toBe('pro');
        expect(screenplay.templateKind).toBe('screenplay');
        expect(podcast.usageContexts).toEqual(['podcast']);
        expect(podcast.outputIntent).toBe('podcast-script');
        expect(podcast.tier).toBe('pro');
        expect(podcast.templateKind).toBe('podcast');
    });
});
