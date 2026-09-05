import { setIcon } from 'obsidian';
import { tooltip } from '../../utils/tooltip';
import type { InquiryZone } from '../state';

export type InquiryBriefingSessionItemRefs = {
    item: HTMLDivElement;
    updateButton: HTMLButtonElement;
    openButton?: HTMLButtonElement;
};

export function renderInquiryBriefingSessionItem(args: {
    container: HTMLElement;
    zoneId: InquiryZone;
    isRehydrateTarget: boolean;
    isActive: boolean;
    questionLabel: string;
    metaText: string;
    status: string;
    blocked: boolean;
    pendingEditsApplied: boolean;
    pendingEditsEmpty: boolean;
    pendingEditsTooltip?: string;
    autoPopulateEnabled: boolean;
    fieldLabel: string;
    hasBriefPath: boolean;
}): InquiryBriefingSessionItemRefs {
    const item = args.container.createDiv({ cls: 'ert-inquiry-briefing-item' });
    item.classList.add(`is-zone-${args.zoneId}`);
    if (args.isRehydrateTarget) {
        item.classList.add('is-rehydrate-target');
    }
    if (args.isActive) {
        item.classList.add('is-active');
    }

    const textRow = item.createDiv({ cls: 'ert-inquiry-briefing-row ert-inquiry-briefing-row--text' });
    const main = textRow.createDiv({ cls: 'ert-inquiry-briefing-main' });
    main.createDiv({ cls: 'ert-inquiry-briefing-title-row', text: args.questionLabel });
    main.createDiv({ cls: 'ert-inquiry-briefing-meta', text: args.metaText });

    const actionRow = item.createDiv({ cls: 'ert-inquiry-briefing-row ert-inquiry-briefing-row--actions' });
    const statusEl = actionRow.createDiv({
        cls: `ert-inquiry-briefing-status ert-inquiry-briefing-status--${args.status}`,
        text: args.status
    });
    statusEl.setAttribute('aria-label', `History status: ${args.status}`);

    const actionGroup = actionRow.createDiv({ cls: 'ert-inquiry-briefing-actions' });
    const isError = args.status === 'error';
    const pendingLabel = args.pendingEditsTooltip || (args.blocked
        ? 'Inquiry is blocked'
        : args.pendingEditsApplied
            ? `${args.fieldLabel} already updated`
            : isError
                ? 'No pending edits (run failed)'
                : args.pendingEditsEmpty
                    ? 'No pending edits'
                    : (args.autoPopulateEnabled ? `Update ${args.fieldLabel}` : `Write to ${args.fieldLabel}`));
    const updateButton = actionGroup.createEl('button', {
        cls: 'ert-inquiry-briefing-update',
        attr: {
            'aria-label': pendingLabel
        }
    });
    const pendingIcon = args.pendingEditsApplied ? 'check' : (args.pendingEditsEmpty || isError) ? 'minus' : 'plus';
    setIcon(updateButton, pendingIcon);
    updateButton.disabled = args.blocked || args.pendingEditsEmpty || isError || args.pendingEditsApplied;
    tooltip(updateButton, pendingLabel, 'top');
    if (args.pendingEditsApplied) {
        updateButton.classList.add('is-applied');
    }
    if (args.pendingEditsEmpty || isError) {
        updateButton.classList.add('is-empty');
    }

    let openButton: HTMLButtonElement | undefined;
    if (args.hasBriefPath) {
        openButton = actionGroup.createEl('button', {
            cls: 'ert-inquiry-briefing-open',
            attr: { 'aria-label': 'Open saved brief' }
        });
        setIcon(openButton, 'file-text');
        openButton.disabled = args.blocked;
    }

    return {
        item,
        updateButton,
        openButton
    };
}
