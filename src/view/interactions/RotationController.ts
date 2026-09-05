interface RotationView {
    currentMode: string;
    getRotationState(): boolean;
    setRotationState(rotated: boolean): void;
    applyRotationToNumberSquares(svg: SVGSVGElement, rotated: boolean): void;
    renderScope: {
        register: (cb: () => void) => void;
        registerDomEvent: (el: HTMLElement, event: string, handler: (ev: Event) => void) => void;
    };
}

export function getRotationStepDegrees(segmentCount: number): number {
    return segmentCount > 0 ? 360 / segmentCount : 120;
}

export function setupRotationController(view: RotationView, svg: SVGSVGElement): void {
    const rotatable = svg.querySelector('#timeline-rotatable');
    const toggle = svg.querySelector('#rotation-toggle');
    const arrowUp = svg.querySelector('#rotation-arrow-up');
    const arrowDown = svg.querySelector('#rotation-arrow-down');
    
    if (!rotatable || !toggle || !arrowUp || !arrowDown) {
        // Rotation elements not found - this is expected if the timeline hasn't rendered yet
        return;
    }

    let rotated = view.getRotationState();

    const applyRotation = () => {
        const segmentCount = parseInt(svg.getAttribute('data-segment-count') || svg.getAttribute('data-num-acts') || '3', 10);
        const angle = getRotationStepDegrees(segmentCount);

        if (rotated) {
            rotatable.setAttribute('transform', `rotate(-${angle})`);
            arrowUp.classList.add('is-hidden');
            arrowDown.classList.remove('is-hidden');
        } else {
            rotatable.removeAttribute('transform');
            arrowUp.classList.remove('is-hidden');
            arrowDown.classList.add('is-hidden');
        }
        svg.setAttribute('data-rotated', rotated ? 'true' : 'false');
        view.applyRotationToNumberSquares(svg, rotated);

        const counterSelectors = [
            '.color-key-center',
            '.target-date-tick',
            '.target-date-marker'
        ];
        counterSelectors.forEach((sel) => {
            const nodes = svg.querySelectorAll(sel);
            nodes.forEach((node) => {
                const el = node as SVGGraphicsElement;
                if (!el.closest('#timeline-rotatable')) return;
                const t = el.getAttribute('transform') || '';
                const base = t.replace(/\s*rotate\([^)]*\)/g, '').trim();
                if (rotated) {
                    el.setAttribute('transform', `${base} rotate(${angle})`.trim());
                } else {
                    el.setAttribute('transform', base);
                }
            });
        });
    };

    applyRotation();
    
    // Register click handler on the toggle button
    const clickHandler = (e: Event) => {
        e.stopPropagation();
        
        // Check if rotation is allowed in current mode
        // Allow rotation in 'allscenes' and 'mainplot', disable in 'gossamer'
        if (view.currentMode === 'gossamer') {
            return;
        }
        
        rotated = !rotated;
        view.setRotationState(rotated);
        applyRotation();
    };
    
    view.renderScope.registerDomEvent(toggle as unknown as HTMLElement, 'click', clickHandler);
}
