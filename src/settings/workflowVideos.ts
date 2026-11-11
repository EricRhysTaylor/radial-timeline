/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Workflow videos
 * ---------------
 * Short videos that show one workflow from start to finish, linked from the
 * settings, dialogs and wiki pages they explain. A link opens the video in the
 * browser through a registered /go/ link, so a video can be replaced without
 * a release. A video with no slug isn't published yet, and nothing links to it.
 * Plan and publishing steps: docs/engineering/plans/workflow-videos-plan.md
 */

export type WorkflowVideoKey = 'pdf-export' | 'community-share';

interface WorkflowVideo {
    /** The registered /go/ slug (`rt-video-…`) once the video is live; null until then. */
    goSlug: string | null;
    /** Translation key for the video's title, read in the link's tooltip. */
    titleKey: string;
}

export const WORKFLOW_VIDEOS: Record<WorkflowVideoKey, WorkflowVideo> = {
    'pdf-export': { goSlug: null, titleKey: 'ui.workflowVideos.pdfExport' },
    'community-share': { goSlug: null, titleKey: 'ui.workflowVideos.communityShare' },
};

export const WORKFLOW_VIDEO_GO_BASE = 'https://community.radialtimeline.com/go/';

/** The video's link, or null while it isn't published. */
export function workflowVideoUrl(key: WorkflowVideoKey): string | null {
    const slug = WORKFLOW_VIDEOS[key].goSlug;
    return slug ? `${WORKFLOW_VIDEO_GO_BASE}${slug}` : null;
}
