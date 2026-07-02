// App Store Connect API client + Express router.
//
// Handles everything that cannot run in the browser:
//   * ES256 JWT signing with the private .p8 key (never sent to the client)
//   * Talking to https://api.appstoreconnect.apple.com (no CORS from the browser)
//   * The screenshot upload flow: reserve -> PUT uploadOperations -> md5 -> commit
//
// Docs: https://developer.apple.com/documentation/appstoreconnectapi/uploading-assets-to-app-store-connect

const crypto = require('crypto');
const fs = require('fs');
const express = require('express');

const API_BASE = 'https://api.appstoreconnect.apple.com';

// App Store version states in which screenshots may still be edited.
const EDITABLE_STATES = new Set([
    'PREPARE_FOR_SUBMISSION',
    'METADATA_REJECTED',
    'REJECTED',
    'DEVELOPER_REJECTED',
    'INVALID_BINARY',
]);

// Map the generator's output-size keys to Apple's screenshotDisplayType enum.
// Used as a default in the UI; the user can still override the display type.
const DISPLAY_TYPE_BY_DEVICE = {
    'iphone-6.9': 'APP_IPHONE_67',
    'iphone-6.7': 'APP_IPHONE_67',
    'iphone-6.5': 'APP_IPHONE_65',
    'iphone-5.5': 'APP_IPHONE_55',
    'ipad-12.9': 'APP_IPAD_PRO_3GEN_129',
    'ipad-11': 'APP_IPAD_PRO_3GEN_11',
};

// -------------------------------------------------------------------------
// Credentials & JWT
// -------------------------------------------------------------------------

function getConfig() {
    const issuerId = process.env.ASC_ISSUER_ID || '';
    const keyId = process.env.ASC_KEY_ID || '';

    let privateKey = '';
    const keyPath = process.env.ASC_PRIVATE_KEY_PATH || '';
    if (keyPath && fs.existsSync(keyPath)) {
        privateKey = fs.readFileSync(keyPath, 'utf8');
    } else if (process.env.ASC_PRIVATE_KEY) {
        // Allow the key to be passed inline with literal "\n" sequences.
        privateKey = process.env.ASC_PRIVATE_KEY.replace(/\\n/g, '\n');
    }

    return { issuerId, keyId, privateKey };
}

function isConfigured() {
    const { issuerId, keyId, privateKey } = getConfig();
    return Boolean(issuerId && keyId && privateKey.includes('PRIVATE KEY'));
}

function base64url(input) {
    return Buffer.from(input)
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

function generateToken() {
    const { issuerId, keyId, privateKey } = getConfig();
    if (!issuerId || !keyId || !privateKey) {
        throw new HttpError(500, 'App Store Connect credentials are not configured on the server.');
    }

    const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        iss: issuerId,
        iat: now,
        exp: now + 15 * 60, // <= 20 min required by Apple
        aud: 'appstoreconnect-v1',
    };

    const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;

    let signature;
    try {
        const keyObject = crypto.createPrivateKey(privateKey);
        // ieee-p1363 => raw R||S concatenation, which is what JWS ES256 expects.
        signature = crypto.sign('sha256', Buffer.from(signingInput), {
            key: keyObject,
            dsaEncoding: 'ieee-p1363',
        });
    } catch (err) {
        throw new HttpError(500, `Could not sign JWT with the provided .p8 key: ${err.message}`);
    }

    return `${signingInput}.${base64url(signature)}`;
}

// -------------------------------------------------------------------------
// HTTP helpers
// -------------------------------------------------------------------------

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

async function apiFetch(path, options = {}) {
    const token = generateToken();
    const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
    const headers = {
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
    };
    if (options.body && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, { ...options, headers });

    if (res.status === 204) return null;

    const text = await res.text();
    let json = null;
    if (text) {
        try {
            json = JSON.parse(text);
        } catch {
            // Non-JSON response (e.g. from the asset upload storage endpoints).
        }
    }

    if (!res.ok) {
        const detail =
            json && json.errors && json.errors.length
                ? json.errors.map((e) => e.detail || e.title).join('; ')
                : text || res.statusText;
        throw new HttpError(res.status, detail);
    }

    return json;
}

// -------------------------------------------------------------------------
// App Store Connect operations
// -------------------------------------------------------------------------

async function listApps() {
    const json = await apiFetch('/v1/apps?limit=200&fields[apps]=name,bundleId');
    return (json.data || []).map((app) => ({
        id: app.id,
        name: app.attributes?.name || '(unnamed)',
        bundleId: app.attributes?.bundleId || '',
    }));
}

async function listVersionsWithLocalizations(appId) {
    const versionsJson = await apiFetch(
        `/v1/apps/${encodeURIComponent(appId)}/appStoreVersions?limit=50` +
            '&fields[appStoreVersions]=versionString,appStoreState,platform'
    );

    const versions = [];
    for (const v of versionsJson.data || []) {
        const state = v.attributes?.appStoreState || '';
        const locJson = await apiFetch(
            `/v1/appStoreVersions/${v.id}/appStoreVersionLocalizations` +
                '?limit=200&fields[appStoreVersionLocalizations]=locale'
        );
        versions.push({
            versionId: v.id,
            versionString: v.attributes?.versionString || '',
            platform: v.attributes?.platform || '',
            appStoreState: state,
            editable: EDITABLE_STATES.has(state),
            locales: (locJson.data || []).map((l) => ({
                id: l.id,
                locale: l.attributes?.locale || '',
            })),
        });
    }
    return versions;
}

async function findOrCreateScreenshotSet(localizationId, displayType) {
    const existing = await apiFetch(
        `/v1/appStoreVersionLocalizations/${encodeURIComponent(localizationId)}/appScreenshotSets` +
            '?limit=50&fields[appScreenshotSets]=screenshotDisplayType'
    );
    const match = (existing.data || []).find(
        (s) => s.attributes?.screenshotDisplayType === displayType
    );
    if (match) return match.id;

    const created = await apiFetch('/v1/appScreenshotSets', {
        method: 'POST',
        body: JSON.stringify({
            data: {
                type: 'appScreenshotSets',
                attributes: { screenshotDisplayType: displayType },
                relationships: {
                    appStoreVersionLocalization: {
                        data: { type: 'appStoreVersionLocalizations', id: localizationId },
                    },
                },
            },
        }),
    });
    return created.data.id;
}

async function uploadOneScreenshot(setId, fileName, buffer) {
    // 1. Reserve the screenshot -> receive uploadOperations.
    const reservation = await apiFetch('/v1/appScreenshots', {
        method: 'POST',
        body: JSON.stringify({
            data: {
                type: 'appScreenshots',
                attributes: { fileName, fileSize: buffer.length },
                relationships: {
                    appScreenshotSet: { data: { type: 'appScreenshotSets', id: setId } },
                },
            },
        }),
    });

    const screenshotId = reservation.data.id;
    const operations = reservation.data.attributes?.uploadOperations || [];

    // 2. Upload each part to Apple's asset storage.
    for (const op of operations) {
        const headers = {};
        for (const h of op.requestHeaders || []) headers[h.name] = h.value;
        const part = buffer.subarray(op.offset, op.offset + op.length);
        const res = await fetch(op.url, {
            method: op.method || 'PUT',
            headers,
            body: part,
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new HttpError(res.status, `Upload of part failed (${res.status}): ${body}`);
        }
    }

    // 3. Commit with the whole-file MD5 checksum.
    const checksum = crypto.createHash('md5').update(buffer).digest('hex');
    await apiFetch(`/v1/appScreenshots/${screenshotId}`, {
        method: 'PATCH',
        body: JSON.stringify({
            data: {
                type: 'appScreenshots',
                id: screenshotId,
                attributes: { uploaded: true, sourceFileChecksum: checksum },
            },
        }),
    });

    return screenshotId;
}

// -------------------------------------------------------------------------
// Router
// -------------------------------------------------------------------------

function createRouter() {
    const router = express.Router();

    const wrap = (handler) => async (req, res) => {
        try {
            await handler(req, res);
        } catch (err) {
            const status = err instanceof HttpError ? err.status : 500;
            res.status(status).json({ error: err.message || 'Unknown error' });
        }
    };

    router.get('/status', (req, res) => {
        res.json({ configured: isConfigured() });
    });

    router.get(
        '/apps',
        wrap(async (req, res) => {
            res.json({ apps: await listApps() });
        })
    );

    router.get(
        '/apps/:appId/versions',
        wrap(async (req, res) => {
            res.json({ versions: await listVersionsWithLocalizations(req.params.appId) });
        })
    );

    router.post(
        '/upload',
        wrap(async (req, res) => {
            const { localizationId, screenshotDisplayType, images } = req.body || {};
            if (!localizationId || !screenshotDisplayType || !Array.isArray(images) || !images.length) {
                throw new HttpError(400, 'localizationId, screenshotDisplayType and images[] are required.');
            }

            const setId = await findOrCreateScreenshotSet(localizationId, screenshotDisplayType);

            const results = [];
            for (const img of images) {
                const fileName = img.fileName || 'screenshot.png';
                try {
                    const buffer = Buffer.from(img.base64 || '', 'base64');
                    if (!buffer.length) throw new Error('Empty image data.');
                    const id = await uploadOneScreenshot(setId, fileName, buffer);
                    results.push({ fileName, ok: true, id });
                } catch (err) {
                    results.push({ fileName, ok: false, error: err.message || 'Upload failed' });
                }
            }

            res.json({ setId, results });
        })
    );

    return router;
}

module.exports = { createRouter, isConfigured, DISPLAY_TYPE_BY_DEVICE };
