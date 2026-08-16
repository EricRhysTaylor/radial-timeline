import { systemFolderPath } from '../utils/systemFolder';

export const INQUIRY_VIEW_TYPE = 'radial-inquiry';
export const INQUIRY_VIEW_DISPLAY_TEXT = 'Inquiry';
export const DEFAULT_INQUIRY_ARTIFACT_FOLDER = systemFolderPath('Inquiry', 'Briefing');
export const DEFAULT_INQUIRY_HISTORY_LIMIT = 30;
export const INQUIRY_SCHEMA_VERSION = 1;
export const INQUIRY_MAX_OUTPUT_TOKENS = 16000; // Fallback only; runtime uses PROVIDER_MAX_OUTPUT_TOKENS per provider
export const INQUIRY_CANONICAL_ESTIMATE_QUESTION = 'Analyze corpus-level flow and depth quality.';
