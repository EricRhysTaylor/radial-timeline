import { formatNumber } from '../../utils/svg';

type RotationToggleOptions = {
    numActs: number;
    actualOuterRadius: number;
};

export function renderRotationToggle({ numActs, actualOuterRadius }: RotationToggleOptions): string {
    const act2BaseAngle = (1 * 2 * Math.PI) / numActs - Math.PI / 2;
    const arrowRadius = actualOuterRadius + 46;
    const arrowAngleAdjust = -(0.60 * Math.PI) / 180;
    const arrowAngle = act2BaseAngle + arrowAngleAdjust;
    const arrowX = formatNumber(arrowRadius * Math.cos(arrowAngle));
    const arrowY = formatNumber(arrowRadius * Math.sin(arrowAngle));
    const arrowRotateDeg = (act2BaseAngle + Math.PI / 2) * 180 / Math.PI - 90;

    return `
        <g id="rotation-toggle" class="rotation-toggle" transform="translate(${arrowX}, ${arrowY}) rotate(${formatNumber(arrowRotateDeg)})">
            <use id="rotation-arrow-up" class="arrow-icon" href="#icon-arrow-up-from-line" x="-14.4" y="-14.4" width="26" height="26" />
            <use id="rotation-arrow-down" class="arrow-icon is-hidden" href="#icon-arrow-down-from-line" x="-14.4" y="-14.4" width="26" height="26" />
            <rect x="-18" y="-18" width="36" height="36" fill="transparent" pointer-events="all">
                <title>Rotate timeline</title>
            </rect>
        </g>
    `;
}
