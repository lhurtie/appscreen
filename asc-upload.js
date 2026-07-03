// App Store Connect upload UI.
//
// Feature-detects the /api/asc backend (present only when the app runs in the
// Node container, not on the static GitHub Pages build). The button is always
// visible; without a configured backend it explains the required setup instead
// of opening the upload dialog.
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

    // 'configured'   -> backend reachable and credentials present
    // 'unconfigured' -> backend reachable but ASC_* env vars missing
    // 'none'         -> no backend (static hosting, e.g. GitHub Pages)
    let backendState = 'none';

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

    let credentialSource = null; // 'ui' | 'env' | null

    async function refreshStatus() {
        try {
            const status = await apiGet('/api/asc/status');
            backendState = status.configured ? 'configured' : 'unconfigured';
            credentialSource = status.source || null;
        } catch {
            backendState = 'none';
            credentialSource = null;
        }
    }

    async function initAscUpload() {
        const btn = $('asc-upload-btn');
        if (!btn) return;
        wireEvents();
        await refreshStatus();
    }

    // ---- View switching inside the modal -----------------------------------

    function showCredentialsView() {
        $('asc-credentials-view').style.display = '';
        $('asc-upload-view').style.display = 'none';
        $('asc-upload-start').style.display = 'none';
        $('asc-credentials-delete').style.display = credentialSource === 'ui' ? '' : 'none';
        setCredStatus('');
    }

    function showUploadView() {
        $('asc-credentials-view').style.display = 'none';
        $('asc-upload-view').style.display = '';
        $('asc-upload-start').style.display = '';
    }

    function setCredStatus(message, kind) {
        const el = $('asc-credentials-status');
        if (!el) return;
        el.textContent = message || '';
        el.style.color =
            kind === 'error' ? '#ff453a' : kind === 'success' ? '#34c759' : 'var(--text-secondary)';
    }

    async function saveCredentials() {
        const issuerId = $('asc-issuer-input').value.trim();
        const keyId = $('asc-keyid-input').value.trim();
        const privateKey = $('asc-p8-input').value.trim();

        if (!issuerId || !keyId || !privateKey) {
            setCredStatus('Please fill in Issuer ID, Key ID and the .p8 key.', 'error');
            return;
        }

        const saveBtn = $('asc-credentials-save');
        saveBtn.disabled = true;
        setCredStatus('Saving…');
        try {
            const res = await fetch('/api/asc/credentials', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ issuerId, keyId, privateKey }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);

            backendState = 'configured';
            credentialSource = 'ui';
            $('asc-p8-input').value = '';
            setCredStatus('Credentials saved.', 'success');
            showUploadView();
            await loadApps();
        } catch (err) {
            setCredStatus(err.message, 'error');
        } finally {
            saveBtn.disabled = false;
        }
    }

    async function deleteSavedCredentials() {
        try {
            const res = await fetch('/api/asc/credentials', { method: 'DELETE' });
            const data = await res.json().catch(() => ({}));
            backendState = data.configured ? 'configured' : 'unconfigured';
            credentialSource = data.source || null;
            setCredStatus('Saved credentials removed.', 'success');
            $('asc-credentials-delete').style.display = 'none';
        } catch (err) {
            setCredStatus(err.message, 'error');
        }
    }

    function loadP8File(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            $('asc-p8-input').value = String(reader.result || '').trim();
        };
        reader.readAsText(file);
    }

    // ---- Dialog population -------------------------------------------------

    async function openDialog() {
        if (backendState === 'none') {
            // Re-check once: the backend may have come up since page load.
            await refreshStatus();
        }
        if (backendState === 'none') {
            await showAppAlert(
                'App Store Connect upload needs the Docker/NAS deployment.<br><br>' +
                    'This page is served statically without the upload backend. ' +
                    'Run the app via <code>docker-compose.nas.yml</code> (see the ' +
                    '"NAS Deployment" section in the README) and open it from there.',
                'info'
            );
            return;
        }

        const modal = $('asc-upload-modal');
        if (!modal) return;

        // Preselect the display type that matches the current output size.
        const dtSelect = $('asc-displaytype-select');
        const mapped = DISPLAY_TYPE_BY_DEVICE[state.outputDevice];
        if (mapped && dtSelect) dtSelect.value = mapped;

        modal.classList.add('visible');
        setStatus('');

        if (backendState === 'unconfigured') {
            showCredentialsView();
            return;
        }

        showUploadView();
        await loadApps();
    }

    async function loadApps() {
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

        // Credentials view
        $('asc-edit-credentials').addEventListener('click', (e) => {
            e.preventDefault();
            showCredentialsView();
        });
        $('asc-credentials-save').addEventListener('click', saveCredentials);
        $('asc-credentials-delete').addEventListener('click', deleteSavedCredentials);
        $('asc-p8-browse').addEventListener('click', () => $('asc-p8-file').click());
        $('asc-p8-file').addEventListener('change', (e) => loadP8File(e.target.files[0]));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAscUpload);
    } else {
        initAscUpload();
    }
})();
