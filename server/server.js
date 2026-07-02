// Static file server for the App Store Screenshot Generator plus the
// /api/asc/* backend used to upload screenshots to App Store Connect.
//
// Replaces the previous nginx-only container so a single Node process can both
// serve the frontend and perform the server-side App Store Connect upload flow.

const path = require('path');
const express = require('express');
const { createRouter } = require('./asc');

const app = express();

const PORT = parseInt(process.env.PORT || '3000', 10);
// Frontend files live one level up from this server directory.
const STATIC_ROOT = process.env.STATIC_ROOT || path.join(__dirname, '..');

app.use(express.json({ limit: '60mb' }));

// Security headers mirroring the previous nginx.conf configuration.
app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

// Health check (kept path-compatible with the old container).
app.get('/health', (req, res) => {
    res.type('text/plain').send('healthy\n');
});

// App Store Connect API routes.
app.use('/api/asc', createRouter());

// Static frontend with long-lived caching for immutable assets.
app.use(
    express.static(STATIC_ROOT, {
        setHeaders(res, filePath) {
            if (/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?|ttf|eot|glb)$/i.test(filePath)) {
                res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            }
        },
    })
);

// SPA-style fallback: unknown non-API GET routes serve index.html.
app.get(/^(?!\/api\/).*/, (req, res) => {
    res.sendFile(path.join(STATIC_ROOT, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`appscreen server listening on port ${PORT}`);
    console.log(`serving static files from ${STATIC_ROOT}`);
});
