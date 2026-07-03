// Synthetic iOS status bar overlay.
//
// Composites a clean status bar (time 9:41, full signal/Wi-Fi, 100% battery,
// no carrier) plus the device's Dynamic Island / notch onto the uploaded
// screenshot BEFORE it is rendered. Because both the 2D canvas pipeline and the
// 3D texture consume the same image, compositing here covers both modes.
//
// The original status bar underneath is not painted over with a flat colour —
// its (often coloured/gradient) background is reconstructed by stretching the
// first clean pixel row from just below the bar upward, so the app's own colour
// is preserved. New indicators are drawn on top.
//
// Exposes `getScreenshotRenderImage(screenshot)` used by the render paths, and
// relies on the globals `state`, `getScreenshotImage`, `roundRect` from app.js.

(function () {
    'use strict';

    const DEFAULTS = { enabled: false, time: '9:41', style: 'auto', frame: 'auto' };

    // Per-device default frame type. Only Apple devices get a status bar.
    const FRAME_BY_DEVICE = {
        'iphone-6.9': 'island',
        'iphone-6.7': 'island',
        'iphone-6.5': 'notch',
        'iphone-5.5': 'bar',
        'ipad-12.9': 'bar',
        'ipad-11': 'bar',
    };

    // Cache composites per screenshot object (WeakMap => no serialization issues).
    const cache = new WeakMap();

    function getConfig() {
        return Object.assign({}, DEFAULTS, (typeof state !== 'undefined' && state.statusBar) || {});
    }

    function resolveFrame(outputDevice, frameSetting) {
        if (frameSetting && frameSetting !== 'auto') return frameSetting;
        return FRAME_BY_DEVICE[outputDevice] || 'none';
    }

    // ---- Public entry point ------------------------------------------------

    function getScreenshotRenderImage(screenshot) {
        const img = typeof getScreenshotImage === 'function'
            ? getScreenshotImage(screenshot)
            : screenshot && screenshot.image;
        if (!img || !img.width) return img;

        const cfg = getConfig();
        if (!cfg.enabled) return img;

        const frame = resolveFrame(state.outputDevice, cfg.frame);
        if (frame === 'none') return img;

        const key = [img.width, img.height, cfg.time, cfg.style, frame].join('|');
        const cached = cache.get(screenshot);
        if (cached && cached.key === key && cached.img === img) return cached.canvas;

        let canvas;
        try {
            canvas = compose(img, cfg, frame);
        } catch (err) {
            console.warn('Status bar compositing failed:', err);
            return img;
        }
        cache.set(screenshot, { key, canvas, img });
        return canvas;
    }

    // ---- Compositing -------------------------------------------------------

    function compose(img, cfg, frame) {
        const w = img.width;
        const h = img.height;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const c = canvas.getContext('2d');
        c.drawImage(img, 0, 0);

        const barH = Math.round(h * (frame === 'bar' ? 0.042 : 0.065));

        reconstructBackground(c, w, h, barH);

        let color;
        if (cfg.style === 'light') color = '#ffffff';
        else if (cfg.style === 'dark') color = '#000000';
        else color = averageLuminance(c, w, barH) < 0.5 ? '#ffffff' : '#000000';

        if (frame === 'island') drawIsland(c, w, barH);
        else if (frame === 'notch') drawNotch(c, w, barH);

        const cy = barH * (frame === 'bar' ? 0.5 : 0.46);
        drawTime(c, w, barH, cy, cfg.time || '9:41', color, frame);
        drawIndicators(c, w, barH, cy, color);

        return canvas;
    }

    // Stretch the first clean pixel row below the bar upward to erase the old
    // status bar while preserving the underlying (possibly coloured) background.
    function reconstructBackground(c, w, h, barH) {
        const sampleY = Math.min(barH, h - 1);
        const row = c.getImageData(0, sampleY, w, 1);
        const tmp = document.createElement('canvas');
        tmp.width = w;
        tmp.height = 1;
        tmp.getContext('2d').putImageData(row, 0, 0);
        c.imageSmoothingEnabled = false;
        c.drawImage(tmp, 0, 0, w, 1, 0, 0, w, barH);
        c.imageSmoothingEnabled = true;
    }

    function averageLuminance(c, w, barH) {
        const midY = Math.max(1, Math.round(barH * 0.5));
        const data = c.getImageData(0, midY, w, 1).data;
        let sum = 0;
        let n = 0;
        // Skip the centre third (Island/notch area) to avoid biasing dark.
        for (let x = 0; x < w; x++) {
            if (x > w * 0.35 && x < w * 0.65) continue;
            const i = x * 4;
            sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
            n++;
        }
        return n ? sum / n : 1;
    }

    // ---- Frame shapes ------------------------------------------------------

    function drawIsland(c, w, barH) {
        const iw = w * 0.30;
        const ih = barH * 0.42;
        const ix = (w - iw) / 2;
        const iy = barH * 0.24;
        c.fillStyle = '#000000';
        c.beginPath();
        roundRect(c, ix, iy, iw, ih, ih / 2);
        c.fill();
    }

    function drawNotch(c, w, barH) {
        const nw = w * 0.34;
        const nh = barH * 0.5;
        const r = nh * 0.4;
        const nx = (w - nw) / 2;
        c.fillStyle = '#000000';
        c.beginPath();
        c.moveTo(nx, 0);
        c.lineTo(nx + nw, 0);
        c.lineTo(nx + nw, nh - r);
        c.arcTo(nx + nw, nh, nx + nw - r, nh, r);
        c.lineTo(nx + r, nh);
        c.arcTo(nx, nh, nx, nh - r, r);
        c.closePath();
        c.fill();
    }

    // ---- Content -----------------------------------------------------------

    function drawTime(c, w, barH, cy, time, color, frame) {
        const fs = Math.round(barH * (frame === 'bar' ? 0.42 : 0.36));
        c.fillStyle = color;
        c.font = `600 ${fs}px -apple-system, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif`;
        c.textBaseline = 'middle';
        c.textAlign = 'center';
        // Centred within the left "ear".
        c.fillText(time, w * 0.135, cy);
    }

    function drawIndicators(c, w, barH, cy, color) {
        const marginX = w * 0.068;
        const iconH = barH * 0.30;
        const gap = iconH * 0.55;
        let xRight = w - marginX;
        xRight = drawBattery(c, xRight, cy, iconH, color) - gap;
        xRight = drawWifi(c, xRight, cy, iconH, color) - gap;
        drawSignal(c, xRight, cy, iconH, color);
    }

    function withAlpha(hex, a) {
        const n = parseInt(hex.slice(1), 16);
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
    }

    function drawSignal(c, xRight, cy, h, color) {
        const bars = 4;
        const bw = h * 0.24;
        const gap = h * 0.16;
        const totalW = bars * bw + (bars - 1) * gap;
        let x = xRight - totalW;
        const maxH = h * 1.05;
        c.fillStyle = color;
        for (let i = 0; i < bars; i++) {
            const bh = maxH * (0.42 + i * 0.19);
            c.beginPath();
            roundRect(c, x, cy + maxH / 2 - bh, bw, bh, bw * 0.3);
            c.fill();
            x += bw + gap;
        }
        return xRight - totalW;
    }

    function drawWifi(c, xRight, cy, h, color) {
        const size = h * 1.35;
        const cx = xRight - size / 2;
        const baseY = cy + h * 0.4;
        c.strokeStyle = color;
        c.fillStyle = color;
        c.lineCap = 'round';
        c.lineWidth = Math.max(1.5, h * 0.15);
        for (let i = 0; i < 3; i++) {
            const r = size * (0.2 + i * 0.2);
            c.beginPath();
            c.arc(cx, baseY, r, Math.PI * 1.25, Math.PI * 1.75);
            c.stroke();
        }
        c.beginPath();
        c.arc(cx, baseY, size * 0.07, 0, Math.PI * 2);
        c.fill();
        return xRight - size;
    }

    function drawBattery(c, xRight, cy, h, color) {
        const bw = h * 2.0;
        const bh = h * 0.98;
        const nubW = h * 0.11;
        const nubH = bh * 0.36;
        const bodyRight = xRight - nubW - Math.max(1.5, h * 0.08);
        const bx = bodyRight - bw;
        const by = cy - bh / 2;

        // Outline
        c.strokeStyle = withAlpha(color, 0.45);
        c.lineWidth = Math.max(1.5, h * 0.09);
        c.beginPath();
        roundRect(c, bx, by, bw, bh, bh * 0.32);
        c.stroke();

        // Positive terminal nub
        c.fillStyle = withAlpha(color, 0.45);
        c.beginPath();
        roundRect(c, bodyRight + Math.max(1.5, h * 0.05), cy - nubH / 2, nubW, nubH, nubW * 0.4);
        c.fill();

        // 100% fill
        const pad = Math.max(1.5, h * 0.13);
        c.fillStyle = color;
        c.beginPath();
        roundRect(c, bx + pad, by + pad, bw - 2 * pad, bh - 2 * pad, (bh - 2 * pad) * 0.3);
        c.fill();

        return bx;
    }

    // Expose the entry point globally.
    window.getScreenshotRenderImage = getScreenshotRenderImage;
})();
