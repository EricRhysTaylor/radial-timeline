export type InquiryDomEventRegistrar = (
    element: HTMLElement | undefined,
    event: string,
    handler: (event: Event) => void,
    options?: boolean | AddEventListenerOptions
) => void;

export type InquirySvgEventRegistrar = (
    element: SVGElement | undefined,
    event: string,
    handler: (event: Event) => void,
    options?: boolean | AddEventListenerOptions
) => void;

export function bindInquiryDesktopShellEvents(args: {
    registerDomEvent: InquiryDomEventRegistrar;
    registerSvgEvent: InquirySvgEventRegistrar;
    contentEl: HTMLElement;
    scopeToggleButton?: SVGGElement;
    apiSimulationButton?: SVGGElement;
    helpToggleButton?: SVGGElement;
    artifactButton?: SVGGElement;
    engineBadgeGroup?: SVGGElement;
    glyphHit?: SVGRectElement;
    flowRingHit?: SVGCircleElement;
    depthRingHit?: SVGCircleElement;
    modeIconToggleHit?: SVGRectElement;
    navPrevButton?: SVGGElement;
    navNextButton?: SVGGElement;
    onBackgroundClick: (event: MouseEvent) => void;
    onScopeToggle: () => void;
    onApiSimulation: () => void;
    onHelpToggle: () => void;
    onArtifactEnter: () => void;
    onArtifactLeave: () => void;
    onArtifactClick: () => void;
    onEngineEnter: () => void;
    onEngineLeave: () => void;
    onEngineClick: () => void;
    onGlyphClick: () => void;
    onFlowRingClick: () => void;
    onDepthRingClick: () => void;
    onModeIconClick: () => void;
    onModeIconEnter: () => void;
    onModeIconLeave: () => void;
    onModeIconKeydown: (event: KeyboardEvent) => void;
    onGlyphEnter: () => void;
    onGlyphLeave: () => void;
    onFlowRingEnter: () => void;
    onFlowRingLeave: () => void;
    onDepthRingEnter: () => void;
    onDepthRingLeave: () => void;
    onNavPrev: () => void;
    onNavNext: () => void;
}): void {
    args.registerDomEvent(args.contentEl, 'click', (event: Event) => {
        args.onBackgroundClick(event as MouseEvent);
    }, { capture: true });

    args.registerSvgEvent(args.scopeToggleButton, 'click', () => args.onScopeToggle());
    args.registerSvgEvent(args.apiSimulationButton, 'click', () => args.onApiSimulation());
    args.registerSvgEvent(args.helpToggleButton, 'click', () => args.onHelpToggle());
    args.registerSvgEvent(args.artifactButton, 'pointerenter', () => args.onArtifactEnter());
    args.registerSvgEvent(args.artifactButton, 'pointerleave', () => args.onArtifactLeave());
    args.registerSvgEvent(args.artifactButton, 'click', () => args.onArtifactClick());
    args.registerSvgEvent(args.engineBadgeGroup, 'pointerenter', () => args.onEngineEnter());
    args.registerSvgEvent(args.engineBadgeGroup, 'pointerleave', () => args.onEngineLeave());
    args.registerSvgEvent(args.engineBadgeGroup, 'click', () => args.onEngineClick());
    args.registerSvgEvent(args.glyphHit, 'click', () => args.onGlyphClick());
    args.registerSvgEvent(args.flowRingHit, 'click', () => args.onFlowRingClick());
    args.registerSvgEvent(args.depthRingHit, 'click', () => args.onDepthRingClick());
    args.registerSvgEvent(args.glyphHit, 'pointerenter', () => args.onGlyphEnter());
    args.registerSvgEvent(args.glyphHit, 'pointerleave', () => args.onGlyphLeave());
    args.registerSvgEvent(args.flowRingHit, 'pointerenter', () => args.onFlowRingEnter());
    args.registerSvgEvent(args.flowRingHit, 'pointerleave', () => args.onFlowRingLeave());
    args.registerSvgEvent(args.depthRingHit, 'pointerenter', () => args.onDepthRingEnter());
    args.registerSvgEvent(args.depthRingHit, 'pointerleave', () => args.onDepthRingLeave());
    args.registerSvgEvent(args.navPrevButton, 'click', () => args.onNavPrev());
    args.registerSvgEvent(args.navNextButton, 'click', () => args.onNavNext());

    if (!args.modeIconToggleHit) return;
    args.registerSvgEvent(args.modeIconToggleHit, 'click', () => args.onModeIconClick());
    args.registerSvgEvent(args.modeIconToggleHit, 'pointerenter', () => args.onModeIconEnter());
    args.registerSvgEvent(args.modeIconToggleHit, 'pointerleave', () => args.onModeIconLeave());
    args.registerSvgEvent(args.modeIconToggleHit, 'keydown', (event: Event) => {
        args.onModeIconKeydown(event as KeyboardEvent);
    });
}

export function bindInquiryPreviewPanelEvents(args: {
    registerSvgEvent: InquirySvgEventRegistrar;
    previewGroup?: SVGGElement;
    onClick: (event: MouseEvent) => void;
}): void {
    args.registerSvgEvent(args.previewGroup, 'click', (event: Event) => {
        args.onClick(event as MouseEvent);
    });
}

export function bindInquiryMobileGateEvents(args: {
    registerDomEvent: InquiryDomEventRegistrar;
    openFolderButton: HTMLButtonElement;
    openLatestButton: HTMLButtonElement;
    onOpenFolder: () => void;
    onOpenLatest: () => void;
}): void {
    args.registerDomEvent(args.openFolderButton, 'click', () => args.onOpenFolder());
    args.registerDomEvent(args.openLatestButton, 'click', () => args.onOpenLatest());
}

export function bindInquiryBriefingPanelEvents(args: {
    registerDomEvent: InquiryDomEventRegistrar;
    briefingPanelEl?: HTMLDivElement;
    briefingClearButton?: HTMLButtonElement;
    briefingResetButton?: HTMLButtonElement;
    briefingPurgeButton?: HTMLButtonElement;
    briefingSaveStateButton?: HTMLButtonElement;
    briefingRestoreButton?: HTMLButtonElement;
    onClearClick: (event: MouseEvent) => void;
    onResetClick: (event: MouseEvent) => void;
    onPurgeClick: (event: MouseEvent) => void;
    onSaveStateClick: (event: MouseEvent) => void;
    onRestoreClick: (event: MouseEvent) => void;
    onPointerEnter: () => void;
    onPointerLeave: () => void;
}): void {
    args.registerDomEvent(args.briefingClearButton, 'click', (event: Event) => args.onClearClick(event as MouseEvent));
    args.registerDomEvent(args.briefingResetButton, 'click', (event: Event) => args.onResetClick(event as MouseEvent));
    args.registerDomEvent(args.briefingPurgeButton, 'click', (event: Event) => args.onPurgeClick(event as MouseEvent));
    args.registerDomEvent(args.briefingSaveStateButton, 'click', (event: Event) => args.onSaveStateClick(event as MouseEvent));
    args.registerDomEvent(args.briefingRestoreButton, 'click', (event: Event) => args.onRestoreClick(event as MouseEvent));
    args.registerDomEvent(args.briefingPanelEl, 'pointerenter', () => args.onPointerEnter());
    args.registerDomEvent(args.briefingPanelEl, 'pointerleave', () => args.onPointerLeave());
}

export function bindInquiryEnginePanelEvents(args: {
    registerDomEvent: InquiryDomEventRegistrar;
    enginePanelEl?: HTMLDivElement;
    onPointerEnter: () => void;
    onPointerLeave: () => void;
}): void {
    args.registerDomEvent(args.enginePanelEl, 'pointerenter', () => args.onPointerEnter());
    args.registerDomEvent(args.enginePanelEl, 'pointerleave', () => args.onPointerLeave());
}

export function bindInquiryEngineActionButtons(args: {
    registerDomEvent: InquiryDomEventRegistrar;
    settingsButton: HTMLButtonElement;
    logButton: HTMLButtonElement;
    onSettingsClick: (event: MouseEvent) => void;
    onLogClick: (event: MouseEvent) => void;
}): void {
    args.registerDomEvent(args.settingsButton, 'click', (event: Event) => args.onSettingsClick(event as MouseEvent));
    args.registerDomEvent(args.logButton, 'click', (event: Event) => args.onLogClick(event as MouseEvent));
}

export function bindInquiryBriefingSessionItemEvents(args: {
    registerDomEvent: InquiryDomEventRegistrar;
    item: HTMLDivElement;
    updateButton: HTMLButtonElement;
    openButton?: HTMLButtonElement;
    onItemClick: () => void;
    onUpdateClick: (event: MouseEvent) => void;
    onOpenClick?: (event: MouseEvent) => void;
}): void {
    args.registerDomEvent(args.updateButton, 'click', (event: Event) => args.onUpdateClick(event as MouseEvent));
    if (args.openButton && args.onOpenClick) {
        args.registerDomEvent(args.openButton, 'click', (event: Event) => args.onOpenClick?.(event as MouseEvent));
    }
    args.registerDomEvent(args.item, 'click', () => args.onItemClick());
}

export function bindInquiryZonePodEvents(args: {
    registerSvgEvent: InquirySvgEventRegistrar;
    zoneEl: SVGGElement;
    onClick: (event: MouseEvent) => void;
    onContextMenu?: (event: MouseEvent) => void;
    onPointerEnter: () => void;
    onPointerLeave: () => void;
}): void {
    args.registerSvgEvent(args.zoneEl, 'click', (event: Event) => args.onClick(event as MouseEvent));
    if (args.onContextMenu) {
        args.registerSvgEvent(args.zoneEl, 'contextmenu', (event: Event) => {
            event.preventDefault();
            args.onContextMenu?.(event as MouseEvent);
        });
    }
    args.registerSvgEvent(args.zoneEl, 'pointerenter', () => args.onPointerEnter());
    args.registerSvgEvent(args.zoneEl, 'pointerleave', () => args.onPointerLeave());
}

export function bindInquiryDetailsToggleEvent(args: {
    registerSvgEvent: InquirySvgEventRegistrar;
    detailsToggle?: SVGGElement;
    onClick: () => void;
}): void {
    args.registerSvgEvent(args.detailsToggle, 'click', () => args.onClick());
}
