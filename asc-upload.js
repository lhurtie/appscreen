// App Store Connect upload UI.
//
// Feature-detects the /api/asc backend (present only when the app runs in the
// Node container, not on the static GitHub Pages build). When available, it
// reveals the "Upload to App Store Connect" button and drives the upload dialog.
//
// Reuses globals from app.js: `state`, `canvas`, `updateCanvas`, `showAppAlert`.

(function () {
    'use strict';

    // Default mapping from the generator's output-size keys to Apple's
    // screenshotDisplayType enum. Mirrors DISPLAY_TYPE_BY_DEVICE in server/asc.js.
    const DISPLAY_TYPE_BY_DEVICE = {
        'iphone-6.9': 'APP_IPHONE_67',
        'iphone-6.7': 'APP_IPHONE_67',
        'iphone-6.5': 'APP_IPHONE_65',
        'iphone-5.5': 'APP_IPHONE_55',
        'ipad-12.9': 'APP_IPAD_PRO_3GEN_129',
        'ipad-11': 'APP_IPAD_PRO_3GEN_11',
    };

    let currentVersions = [];

    function $(id) {
        return document.getElementById(id);
    }

    function setStatus(message, kind) {
        const el = $('asc-upload-status');
        if (!el) return;
        el.textContent = message || '';
        el.style.color =
            kind === 'error' ? '#ff453a' : kind === 'success' ? '#34c759' : 'var(--text-secondary)';
    }

    async function apiGet(url) {
        const res = await fetch(url);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
        return data;
    }

    // ---- Feature detection ------------------------------------------------

    async function initAscUpload() {
        const btn = $('asc-upload-btn');
        if (!btn) return;
        try {
            const status = await apiGet('/api/asc/status');
            if (status.configured) {
                btn.hidden = false;
                wireEvents();
            }
        } catch {
            // No backend (e.g. static hosting) -> leave the button hidden.
        }
    }

    // ---- Dialog population -------------------------------------------------

    async function openDialog() {
        const modal = $('asc-upload-modal');
        if (!modal) return;

        // Preselect the display type that matches the current output size.
        const dtSelect = $('asc-displaytype-select');
        const mapped = DISPLAY_TYPE_BY_DEVICE[state.outputDevice];
        if (mapped && dtSelect) dtSelect.value = mapped;

        modal.classList.add('visible');
        setStatus('');

        const appSelect = $('asc-app-select');
        appSelect.innerHTML = '<option value="">Loading apps…</option>';
        try {
            const { apps } = await apiGet('/api/asc/apps');
            if (!apps.length) {
                appSelect.innerHTML = '<option value="">No apps found</option>';
                return;
            }
            appSelect.innerHTML =
                '<option value="">Select an app…</option>' +
                apps
                    .map(
                        (a) =>
                            `<option value="${a.id}">${escapeHtml(a.name)}${
                                a.bundleId ? ` (${escapeHtml(a.bundleId)})` : ''
                            }</option>`
                    )
                    .join('');
        } catch (err) {
            appSelect.innerHTML = '<option value="">Failed to load apps</option>';
            setStatus(err.message, 'error');
        }
    }

    function closeDialog() {
        const modal = $('asc-upload-modal');
        if (modal) modal.classList.remove('visible');
    }

    async function onAppChange() {
        const appId = $('asc-app-select').value;
        const versionSelect = $('asc-version-select');
        const localeSelect = $('asc-locale-select');
        localeSelect.disabled = true;
        localeSelect.innerHTML = '<option value="">Select a version first</option>';
        currentVersions = [];

        if (!appId) {
            versionSelect.disabled = true;
            versionSelect.innerHTML = '<option value="">Select an app first</option>';
            return;
        }

        versionSelect.disabled = true;
        versionSelect.innerHTML = '<option value="">Loading versions…</option>';
        try {
            const { versions } = await apiGet(`/api/asc/apps/${encodeURIComponent(appId)}/versions`);
            currentVersions = versions;
            if (!versions.length) {
                versionSelect.innerHTML = '<option value="">No versions found</option>';
                return;
            }
            versionSelect.innerHTML =
                '<option value="">Select a version…</option>' +
                versions
                    .map((v, i) => {
                        const label = `${v.versionString || v.versionId} — ${v.appStoreState}${
                            v.editable ? '' : ' (read-only)'
                        }`;
                        return `<option value="${i}"${v.editable ? '' : ' disabled'}>${escapeHtml(
                            label
                        )}</option>`;
                    })
                    .join('');
            versionSelect.disabled = false;
        } catch (err) {
            versionSelect.innerHTML = '<option value="">Failed to load versions</option>';
            setStatus(err.message, 'error');
        }
    }

    function onVersionChange() {
        const idx = $('asc-version-select').value;
        const localeSelect = $('asc-locale-select');
        const version = currentVersions[idx];
        if (!version) {
            localeSelect.disabled = true;
            localeSelect.innerHTML = '<option value="">Select a version first</option>';
            return;
        }
        if (!version.locales.length) {
            localeSelect.disabled = true;
            localeSelect.innerHTML = '<option value="">No languages on this version</option>';
            return;
        }
        localeSelect.innerHTML = version.locales
            .map((l) => `<option value="${l.id}">${escapeHtml(l.locale)}</option>`)
            .join('');
        localeSelect.disabled = false;
    }

    // ---- Rendering & upload ----------------------------------------------

    async function renderSelected(scope) {
        const originalIndex = state.selectedIndex;
        const indices =
            scope === 'current'
                ? [state.selectedIndex]
                : state.screenshots.map((_, i) => i);

        const images = [];
        for (const i of indices) {
            state.selectedIndex = i;
            updateCanvas();
            // Give 3D / async rendering a moment to settle, matching exportAll.
            await new Promise((r) => setTimeout(r, 80));
            const dataUrl = canvas.toDataURL('image/png');
            images.push({
                fileName: `screenshot-${i + 1}.png`,
                base64: dataUrl.replace(/^data:image\/png;base64,/, ''),
            });
        }

        state.selectedIndex = originalIndex;
        updateCanvas();
        return images;
    }

    async function startUpload() {
        if (!state.screenshots.length) {
            setStatus('Upload a screenshot first.', 'error');
            return;
        }

        const localizationId = $('asc-locale-select').value;
        const screenshotDisplayType = $('asc-displaytype-select').value;
        const scope = document.querySelector('input[name="asc-scope"]:checked')?.value || 'all';

        if (!localizationId) {
            setStatus('Select an app, an editable version and a language.', 'error');
            return;
        }

        const startBtn = $('asc-upload-start');
        startBtn.disabled = true;
        setStatus('Rendering screenshots…');

        try {
            const images = await renderSelected(scope);
            setStatus(`Uploading ${images.length} screenshot(s) to App Store Connect…`);

            const res = await fetch('/api/asc/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ localizationId, screenshotDisplayType, images }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);

            const results = data.results || [];
            const okCount = results.filter((r) => r.ok).length;
            const failed = results.filter((r) => !r.ok);

            if (!failed.length) {
                setStatus(`Uploaded ${okCount} screenshot(s) successfully.`, 'success');
                await showAppAlert(
                    `Uploaded ${okCount} screenshot(s) to App Store Connect.`,
                    'success'
                );
                closeDialog();
            } else {
                const detail = failed.map((f) => `• ${f.fileName}: ${f.error}`).join('\n');
                setStatus(
                    `${okCount} succeeded, ${failed.length} failed. See details below.`,
                    'error'
                );
                await showAppAlert(
                    `Uploaded ${okCount}, failed ${failed.length}:\n${detail}`,
                    'error'
                );
            }
        } catch (err) {
            setStatus(err.message, 'error');
            await showAppAlert(`Upload failed: ${err.message}`, 'error');
        } finally {
            startBtn.disabled = false;
        }
    }

    // ---- Wiring -----------------------------------------------------------

    function escapeHtml(str) {
        return String(str).replace(
            /[&<>"']/g,
            (c) =>
                ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
        );
    }

    let wired = false;
    function wireEvents() {
        if (wired) return;
        wired = true;

        $('asc-upload-btn').addEventListener('click', openDialog);
        $('asc-upload-close').addEventListener('click', closeDialog);
        $('asc-upload-cancel').addEventListener('click', closeDialog);
        $('asc-upload-modal').addEventListener('click', (e) => {
            if (e.target.id === 'asc-upload-modal') closeDialog();
        });
        $('asc-app-select').addEventListener('change', onAppChange);
        $('asc-version-select').addEventListener('change', onVersionChange);
        $('asc-upload-start').addEventListener('click', startUpload);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAscUpload);
    } else {
        initAscUpload();
    }
})();
