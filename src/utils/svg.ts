/**
 * SVG Utility functions
 */

/**
 * Format a number for SVG coordinates to reduce file size
 * Limits precision to 2 decimal places and removes trailing zeros
 */
export function formatNumber(n: number): string {
    return Number(n.toFixed(2)).toString();
}

/**
 * Escape XML special characters in a string
 */
export function escapeXml(unsafe: string | null | undefined): string {
    if (!unsafe) return '';
    return unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
        }
        return c;
    });
}
