import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { WORKFLOW_VIDEO_GO_BASE, WORKFLOW_VIDEOS, workflowVideoUrl, type WorkflowVideoKey } from './workflowVideos';

const keys = Object.keys(WORKFLOW_VIDEOS) as WorkflowVideoKey[];

describe('workflow videos', () => {
    it('open through registered, counted /go/ links, one slug per video', () => {
        const slugs = keys.map(key => WORKFLOW_VIDEOS[key].goSlug).filter((slug): slug is string => slug !== null);
        for (const slug of slugs) expect(slug).toMatch(/^rt-video-[a-z0-9-]+$/);
        expect(new Set(slugs).size).toBe(slugs.length);
    });

    it('link nowhere until the video is published', () => {
        for (const key of keys) {
            const slug = WORKFLOW_VIDEOS[key].goSlug;
            expect(workflowVideoUrl(key)).toBe(slug === null ? null : `${WORKFLOW_VIDEO_GO_BASE}${slug}`);
        }
    });

    it('have an English title for every video', () => {
        for (const key of keys) expect(t(WORKFLOW_VIDEOS[key].titleKey)).not.toMatch(/^\[missing:/);
    });
});
