import { formatNumber } from '../../utils/svg';

export function arcPath(radius: number, startAngle: number, endAngle: number): string {
  return `
    M ${formatNumber(radius * Math.cos(startAngle))} ${formatNumber(radius * Math.sin(startAngle))}
    A ${formatNumber(radius)} ${formatNumber(radius)} 0 0 1 ${formatNumber(radius * Math.cos(endAngle))} ${formatNumber(radius * Math.sin(endAngle))}
  `;
}


