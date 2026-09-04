/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Rasterise a self-contained SVG string to PNG bytes via an <img> and a
 * canvas. Shared by the timeline PNG export and the APR PNG export.
 */

/**
 * @param scale Device-pixel multiplier applied to width/height (1 = as drawn).
 */
export async function rasterizeSvgToPng(svgString: string, width: number, height: number, scale = 1): Promise<ArrayBuffer> {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        throw new Error('PNG export is unavailable in this environment.');
    }
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Failed to load SVG for PNG rendering.'));
            img.src = objectUrl;
        });
        // decode() blocks until the SVG image document is fully ready to
        // paint — including its embedded @font-face data-URI fonts, which
        // load inside the isolated image context and are not observable
        // via this document's FontFaceSet. Without it, drawImage can race
        // the font load and rasterize fallback glyphs.
        await image.decode();

        const targetWidth = Math.max(1, Math.round(width * scale));
        const targetHeight = Math.max(1, Math.round(height * scale));
        const canvas = activeWindow.createEl('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not initialize canvas context.');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

        const pngBlob = await new Promise<Blob | null>((resolve) => {
            canvas.toBlob((result) => resolve(result), 'image/png');
        });
        if (!pngBlob) {
            throw new Error('Canvas failed to produce PNG data.');
        }
        return pngBlob.arrayBuffer();
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}
