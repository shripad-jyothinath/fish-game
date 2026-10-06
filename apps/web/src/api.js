/**
 * Fish.IO — website client layer.
 *
 * - Email/password session + cross-device save sync (accounts API)
 * - Match bridge: finished games are recorded and attested on Hedera (HCS)
 * - $GOLD rewards, wallet linking (proof-of-ownership transfer), NFT mints
 * - Global leaderboard
 *
 * Everything degrades gracefully: guests keep local progress, and with no
 * Hedera credentials on the server the game still records matches locally.
 */
(function () {
    'use strict';

    const SAVE_KEY = 'fishio_savedata_v4';
    const SYNC_DEBOUNCE_MS = 1500;

    let currentUser = null;
    let authMode = 'login';
    let syncTimer = null;
    let hederaStatus = null;
    let linkChallenge = null;

    // ===== tiny API helper =====
    // Absolute API base for split deployments (game on Vercel, API on the VPS).
    // Empty string = same-origin (local dev / all-in-one hosting).
    const API_BASE = String(window.FISHIO_API_BASE || '').replace(/\/+$/, '');

    async function request(path, { method = 'GET', body } = {}) {
        let res;
        try {
            res = await fetch(`${API_BASE}${path}`, {
                method,
                credentials: API_BASE ? 'include' : 'same-origin',
                headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
                body: body !== undefined ? JSON.stringify(body) : undefined,
            });
        } catch (err) {
            throw new Error('Cannot reach the account server. Start it with "npm run dev".');
        }
        const data = res.status === 204 ? null : await res.json().catch(() => null);
        if (!res.ok) {
            const isApiError = data && data.error && data.error.message;
            const error = new Error(
                isApiError || (res.status === 404 || res.status === 405
                    ? 'Cannot reach the account server. Start it with "npm run dev".'
                    : `Request failed (${res.status})`)
            );
            error.status = res.status;
            error.code = isApiError ? data.error.code : 'unknown';
            throw error;
        }
        return data;
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ===== session =====
    async function refreshSession() {
        try {
            const data = await request('/api/v1/auth/me');
            currentUser = data.user;
        } catch (err) {
            if (err.status === 401) currentUser = null;
            else throw err;
        }
        renderAccountBar();
        return currentUser;
    }

    // ===== save sync =====
    function readLocalSave() {
        try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { return null; }
    }

    function writeLocalSave(save) {
        try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); return true; } catch { return false; }
    }

    function applySave(save) {
        if (!writeLocalSave(save)) return;
        const sm = window.shopManager;
        if (sm && typeof sm.loadSaveData === 'function') {
            sm.loadSaveData();
            if (typeof updateMenuStats === 'function') updateMenuStats();
            if (typeof renderLevelChallenges === 'function') renderLevelChallenges();
            if (typeof updatePreviewFish === 'function') updatePreviewFish();
        }
        syncPlayerName();
    }

    async function pushSave() {
        const local = readLocalSave();
        if (!local) return;
        if (!local.savedAt) local.savedAt = Date.now();
        writeLocalSave(local);
        await request('/api/v1/me/save', { method: 'PUT', body: { save: local } });
    }

    async function pullSave() {
        const remote = await request('/api/v1/me/save');
        const local = readLocalSave();
        if (remote.save) {
            const remoteAt = remote.updatedAt || 0;
            const localAt = (local && local.savedAt) || 0;
            if (remoteAt >= localAt) {
                applySave(remote.save);
                showToast('Progress loaded from your account');
            } else {
                await pushSave();
                showToast('Local progress uploaded to your account');
            }
        } else if (local) {
            await pushSave();
            showToast('Progress saved to your account');
        } else {
            showToast('Account ready — progress will sync automatically');
        }
    }

    function scheduleSaveSync() {
        if (!currentUser) return;
        clearTimeout(syncTimer);
        syncTimer = setTimeout(() => { pushSave().catch(() => {}); }, SYNC_DEBOUNCE_MS);
    }

    function hookShopSave() {
        const sm = window.shopManager;
        if (!sm || sm.__fishioSynced) return;
        const original = sm.save.bind(sm);
        sm.save = function () {
            const result = original();
            scheduleSaveSync();
            return result;
        };
        sm.__fishioSynced = true;
    }

    // ===== account bar =====
    // While signed in, the account username is the player name: keep the save
    // and the menu input in sync (the input is locked so they can't drift).
    function syncPlayerName() {
        const sm = window.shopManager;
        if (!sm) return;
        const input = document.getElementById('playerNameInput');
        const label = document.getElementById('playerNameLabel');
        if (currentUser) {
            if (sm.playerName !== currentUser.username) {
                sm.playerName = currentUser.username;
                if (typeof sm.save === 'function') sm.save();
            }
            if (input) {
                input.value = currentUser.username;
                input.disabled = true;
                input.title = 'Your account name — sign in with another account to change it';
            }
            if (label) label.textContent = 'Player Name · account';
        } else if (input) {
            input.disabled = false;
            input.title = '';
            if (label) label.textContent = 'Player Name';
        }
    }

    function renderAccountBar() {
        const guest = document.getElementById('accountGuest');
        const user = document.getElementById('accountUser');
        if (!guest || !user) return;
        if (currentUser) {
            guest.classList.add('hidden');
            user.classList.remove('hidden');
            const name = document.getElementById('accountName');
            if (name) name.textContent = currentUser.username;
        } else {
            guest.classList.remove('hidden');
            user.classList.add('hidden');
        }
        syncPlayerName();
    }

    // ===== auth modal =====
    function openAuthModal(mode) {
        switchAuthTab(mode === 'register' ? 'register' : 'login');
        const modal = document.getElementById('authModal');
        if (modal) modal.classList.remove('hidden');
        renderHederaPanel();
        const email = document.getElementById('authEmail');
        if (email) email.focus();
    }

    function closeAuthModal() {
        const modal = document.getElementById('authModal');
        if (modal) modal.classList.add('hidden');
        clearAuthError();
    }

    function switchAuthTab(mode) {
        authMode = mode === 'register' ? 'register' : 'login';
        const isRegister = authMode === 'register';
        const tabLogin = document.getElementById('authTabLogin');
        const tabRegister = document.getElementById('authTabRegister');
        if (tabLogin) tabLogin.classList.toggle('active', !isRegister);
        if (tabRegister) tabRegister.classList.toggle('active', isRegister);
        const usernameField = document.getElementById('authUsernameField');
        if (usernameField) usernameField.classList.toggle('hidden', !isRegister);
        const title = document.getElementById('authTitle');
        if (title) title.textContent = isRegister ? 'CREATE ACCOUNT' : 'WELCOME BACK';
        const submit = document.getElementById('authSubmit');
        if (submit) {
            submit.disabled = false;
            submit.textContent = isRegister ? 'CREATE ACCOUNT' : 'LOG IN';
        }
        const password = document.getElementById('authPassword');
        if (password) password.setAttribute('autocomplete', isRegister ? 'new-password' : 'current-password');
        clearAuthError();
    }

    function showAuthError(message) {
        const el = document.getElementById('authError');
        if (!el) return;
        el.textContent = message;
        el.classList.remove('hidden');
    }

    function clearAuthError() {
        const el = document.getElementById('authError');
        if (!el) return;
        el.textContent = '';
        el.classList.add('hidden');
    }

    async function submitAuth(event) {
        event.preventDefault();
        const emailEl = document.getElementById('authEmail');
        const usernameEl = document.getElementById('authUsername');
        const passwordEl = document.getElementById('authPassword');
        const submit = document.getElementById('authSubmit');
        const email = emailEl ? emailEl.value.trim() : '';
        const username = usernameEl ? usernameEl.value.trim() : '';
        const password = passwordEl ? passwordEl.value : '';

        clearAuthError();
        if (!email || !password || (authMode === 'register' && !username)) {
            showAuthError('Please fill in all fields.');
            return;
        }

        if (submit) {
            submit.disabled = true;
            submit.textContent = authMode === 'register' ? 'CREATING…' : 'SIGNING IN…';
        }

        try {
            const path = authMode === 'register' ? '/api/v1/auth/register' : '/api/v1/auth/login';
            const body = authMode === 'register' ? { email, username, password } : { email, password };
            const data = await request(path, { method: 'POST', body });
            currentUser = data.user;
            closeAuthModal();
            renderAccountBar();
            if (passwordEl) passwordEl.value = '';
            await pullSave();
            await refreshGoldShop();
            showToast(`Welcome, ${currentUser.username}!`);
        } catch (err) {
            showAuthError(err.message);
        } finally {
            if (submit) {
                submit.disabled = false;
                submit.textContent = authMode === 'register' ? 'CREATE ACCOUNT' : 'LOG IN';
            }
        }
    }

    async function logout() {
        try { await request('/api/v1/auth/logout', { method: 'POST' }); } catch { /* already signed out */ }
        currentUser = null;
        linkChallenge = null;
        renderAccountBar();
        renderHederaPanel();
        void refreshGoldShop();
        showToast('Signed out — progress stays on this device');
    }

    // ===== Hedera: match bridge =====
    async function loadHederaStatus(force = false) {
        if (hederaStatus && !force) return hederaStatus;
        try { hederaStatus = await request('/api/v1/hedera/status'); } catch { hederaStatus = null; }
        return hederaStatus;
    }

    function receiptFooter(payload) {
        let html;
        if (payload && payload.receipt && payload.receipt.status === 'submitted') {
            const link = payload.receipt.hashscanUrl
                ? ` <a href="${escapeHtml(payload.receipt.hashscanUrl)}" target="_blank" rel="noopener">view on HashScan ↗</a>`
                : '';
            html = `<span class="hedera-badge">⛓ Hedera</span> match recorded (message #${payload.receipt.sequenceNumber})${link}`;
        } else if (payload && payload.receipt && payload.receipt.status === 'failed') {
            html = '<span class="hedera-badge warn">⛓ Hedera</span> receipt delayed — saved to your account';
        } else {
            html = '<span class="hedera-badge muted">⛓ Hedera</span> testnet not configured yet — match saved to your account';
        }
        if (payload && payload.reward && payload.reward.amount > 0) {
            html += ` · 🪙 +${payload.reward.amount} $GOLD pending`;
        }
        return html;
    }

    async function onMatchEnd(stats) {
        const targetId = stats.source === 'stage' ? 'hederaReceiptStage' : 'hederaReceipt';
        const target = document.getElementById(targetId) || document.getElementById('hederaReceipt');
        if (!target) return;
        target.classList.remove('hidden');

        if (!currentUser) {
            target.innerHTML =
                '<span class="hedera-badge muted">⛓ Hedera</span> ' +
                '<a href="#" onclick="openAuthModal(\'login\'); return false;">Sign in</a> to record matches on-chain and earn $GOLD';
            return;
        }

        target.textContent = '⛓ Recording match on Hedera…';
        try {
            const payload = await request('/api/v1/matches', {
                method: 'POST',
                body: {
                    mode: stats.mode,
                    score: stats.score,
                    kills: stats.kills,
                    level: stats.level,
                    gold: stats.gold,
                    food: stats.food,
                    chests: stats.chests,
                    kingTime: stats.kingTime,
                    durationMs: Math.round((stats.matchTime || 0) * 1000),
                },
            });
            target.innerHTML = receiptFooter(payload);
        } catch (err) {
            target.innerHTML = `<span class="hedera-badge warn">⛓ Hedera</span> could not record match (${escapeHtml(err.message)})`;
        }
    }

    window.fishMatchBridge = { onMatchEnd };

    // ===== Hedera: wallet link + gold + NFTs panel =====
    function unlockedCosmetics() {
        const sm = window.shopManager;
        if (!sm) return [];
        const out = [];
        (sm.unlockedFish || []).forEach((id) => window.FISH_SKINS && window.FISH_SKINS[id] && out.push({ id, type: 'fish', name: window.FISH_SKINS[id].name }));
        (sm.unlockedWeapons || []).forEach((id) => window.WEAPON_SKINS && window.WEAPON_SKINS[id] && out.push({ id, type: 'weapon', name: window.WEAPON_SKINS[id].name }));
        (sm.unlockedHats || []).forEach((id) => id !== 'none' && window.FISH_HATS && window.FISH_HATS[id] && out.push({ id, type: 'hat', name: window.FISH_HATS[id].name }));
        return out;
    }

    async function renderHederaPanel() {
        const panel = document.getElementById('hederaPanel');
        if (!panel) return;
        if (!currentUser) {
            panel.classList.add('hidden');
            return;
        }
        panel.classList.remove('hidden');
        panel.innerHTML = '<div class="hedera-muted">Loading Hedera status…</div>';

        const status = await loadHederaStatus(true);
        let gold = null;
        let link = null;
        let nfts = null;
        try {
            const results = await Promise.all([
                request('/api/v1/hedera/gold'),
                request('/api/v1/hedera/link'),
                request('/api/v1/hedera/nfts'),
            ]);
            gold = results[0];
            link = results[1];
            nfts = results[2];
        } catch {
            // panel still renders with what we have
        }

        const network = status ? status.network : 'testnet';
        const online = Boolean(status && status.online);
        const statusLabel = online ? `${network} · live` : `${network} · not configured`;
        const goldLine = gold
            ? `<b>${gold.paid}</b> claimed · <b>${gold.pending}</b> pending`
            : '—';

        let html = '';
        html += `<div class="hedera-head"><span class="hedera-badge">⛓ Hedera</span><span class="hedera-status ${online ? 'on' : 'off'}">${statusLabel}</span></div>`;
        html += `<div class="hedera-row"><span>$GOLD tokens</span><span>${goldLine}</span></div>`;

        if (link && link.linked) {
            const managed = link.link && link.link.method === 'custodial';
            html += `<div class="hedera-row"><span>Wallet</span><span class="hedera-account">${escapeHtml(link.link.accountId)}${managed ? ' · managed' : ''}</span></div>`;
            html += '<div class="hedera-actions">';
            if (gold && gold.pending > 0) {
                html += '<button class="hedera-btn primary" onclick="fishClaimGold()">Claim pending $GOLD</button>';
            }
            if (managed && link.custodial && link.custodial.exportable) {
                html += '<button class="hedera-btn" onclick="fishExportWallet()">Export key</button>';
            }
            if (!managed) {
                html += '<button class="hedera-btn" onclick="fishUnlinkWallet()">Unlink</button>';
            }
            html += '</div>';
            if (managed) {
                html += `<div class="hedera-actions">
                    <input class="hedera-input" id="hederaAccountInput" placeholder="0.0.yourOwnWallet">
                    <button class="hedera-btn" onclick="fishStartLink()">Link my own instead</button>
                </div>
                <div class="hedera-muted">Wallet created automatically for you. Linking your own (HashPack/Blade) takes over as the payout target.</div>`;
            }
        } else if (linkChallenge) {
            html += `<div class="hedera-steps">
                <div>1. In your Hedera wallet, send <b>0.00000001 HBAR</b> to <b>${escapeHtml(linkChallenge.instructions.accountId)}</b></div>
                <div>2. Set the memo to <code>${escapeHtml(linkChallenge.instructions.memo)}</code></div>
                <div>3. Wait a few seconds, then verify:</div>
            </div>
            <div class="hedera-actions">
                <input class="hedera-input" id="hederaAccountInput" placeholder="0.0.yourAccount" value="">
                <button class="hedera-btn primary" onclick="fishVerifyWallet()">Verify transfer</button>
                <button class="hedera-btn" onclick="fishCancelLink()">Cancel</button>
            </div>`;
        } else {
            html += `<div class="hedera-row"><span>Wallet</span><span>not linked</span></div>
            <div class="hedera-actions">
                <input class="hedera-input" id="hederaAccountInput" placeholder="0.0.yourAccount">
                <button class="hedera-btn primary" onclick="fishStartLink()">Link wallet</button>
            </div>
            <div class="hedera-muted">Linking is free (1 tinybar testnet transfer). $GOLD rewards accrue until you claim.</div>`;
        }

        const editions = nfts && nfts.editions ? nfts.editions : {};

        if (nfts && nfts.items && nfts.items.length > 0) {
            html += '<div class="hedera-subtitle">Your NFTs</div>';
            html += nfts.items.map((item) => {
                const edition = editions[item.itemId];
                const editionTag = edition
                    ? ` <span class="hedera-edition">🔥 ${edition.limit === 1 ? '1-of-1' : `limited ${edition.limit}`}</span>`
                    : '';
                const linkHtml = item.hashscanUrl
                    ? `<a href="${escapeHtml(item.hashscanUrl)}" target="_blank" rel="noopener">#${item.serial} ↗</a>`
                    : `<span class="hedera-muted">#${item.serial || '?'}</span>`;
                return `<div class="hedera-row"><span>${escapeHtml(item.name)}${editionTag}</span>${linkHtml}</div>`;
            }).join('');
        }

        if (online && link && link.linked) {
            const minted = new Set((nfts && nfts.items ? nfts.items : []).map((i) => i.itemId));
            const owned = unlockedCosmetics();
            const candidates = owned.filter((item) => {
                if (minted.has(item.id)) return false;
                const edition = editions[item.id];
                return !edition || edition.remaining > 0;
            });
            const soldOutOwned = owned.filter((item) => {
                const edition = editions[item.id];
                return edition && edition.remaining <= 0;
            });
            if (candidates.length > 0) {
                html += '<div class="hedera-subtitle">Mint an owned item as NFT</div>';
                html += `<div class="hedera-actions">
                    <select class="hedera-input" id="hederaMintSelect">${candidates.map((c) => {
                        const edition = editions[c.id];
                        const tag = edition ? ` — 🔥 ${edition.remaining}/${edition.limit} left` : '';
                        return `<option value="${escapeHtml(c.type)}:${escapeHtml(c.id)}">${escapeHtml(c.name)} (${c.type})${tag}</option>`;
                    }).join('')}</select>
                    <button class="hedera-btn primary" onclick="fishMintItem()">Mint NFT</button>
                </div>`;
            }
            if (soldOutOwned.length > 0) {
                html += `<div class="hedera-muted">Limited editions sold out: ${soldOutOwned.map((i) => escapeHtml(i.name)).join(', ')}</div>`;
            }
        }

        panel.innerHTML = html;
    }

    async function fishStartLink() {
        const input = document.getElementById('hederaAccountInput');
        const accountId = input ? input.value.trim() : '';
        if (!accountId) { showToast('Enter your Hedera account id first (0.0.…)'); return; }
        try {
            linkChallenge = await request('/api/v1/hedera/link/challenge', { method: 'POST', body: { accountId } });
            renderHederaPanel();
        } catch (err) {
            showToast(err.message);
        }
    }

    function fishCancelLink() {
        linkChallenge = null;
        renderHederaPanel();
    }

    async function fishVerifyWallet() {
        if (!linkChallenge) { showToast('Start the linking challenge first.'); return; }
        const input = document.getElementById('hederaAccountInput');
        const accountId = input ? input.value.trim() : '';
        try {
            await request('/api/v1/hedera/link/verify', {
                method: 'POST',
                body: { method: 'transfer', accountId, nonce: linkChallenge.nonce },
            });
            linkChallenge = null;
            showToast('Wallet linked!');
            renderHederaPanel();
        } catch (err) {
            showToast(err.message);
        }
    }

    async function fishUnlinkWallet() {
        try {
            await request('/api/v1/hedera/link', { method: 'DELETE' });
            showToast('Wallet unlinked');
            renderHederaPanel();
        } catch (err) {
            showToast(err.message);
        }
    }

    async function fishExportWallet() {
        const password = window.prompt('Confirm your account password to export the wallet private key:');
        if (!password) return;
        try {
            const result = await request('/api/v1/hedera/wallet/export', { method: 'POST', body: { password } });
            try {
                await navigator.clipboard.writeText(result.privateKeyDer);
                showToast(`Key for ${result.accountId} copied — import it into HashPack/Blade`);
            } catch {
                window.prompt(`Private key for ${result.accountId} (testnet — keep it safe):`, result.privateKeyDer);
            }
        } catch (err) {
            showToast(err.message);
        }
    }

    async function fishClaimGold() {
        try {
            const result = await request('/api/v1/hedera/gold/claim', { method: 'POST', body: {} });
            const link = result.hashscanUrl ? ` — <a href="${escapeHtml(result.hashscanUrl)}" target="_blank" rel="noopener">view on HashScan</a>` : '';
            showToast(`Claimed ${result.amount} $GOLD${result.method === 'airdrop' ? ' (airdrop)' : ''}`);
            const panel = document.getElementById('hederaPanel');
            if (panel) panel.insertAdjacentHTML('afterbegin', `<div class="hedera-claim-ok">🪙 ${result.amount} $GOLD sent${link}</div>`);
            renderHederaPanel();
        } catch (err) {
            showToast(err.message);
        }
    }

    async function fishMintItem() {
        const select = document.getElementById('hederaMintSelect');
        if (!select || !select.value) return;
        const [type, id] = select.value.split(':');
        const item = unlockedCosmetics().find((c) => c.id === id && c.type === type);
        try {
            showToast('Minting on Hedera…');
            const result = await request('/api/v1/hedera/nfts/mint', {
                method: 'POST',
                body: { itemId: id, itemType: type, name: item ? item.name : id, description: item ? `${item.name} — Fish.IO ${type}` : '' },
            });
            const link = result.item.hashscanUrl ? ` — <a href="${escapeHtml(result.item.hashscanUrl)}" target="_blank" rel="noopener">view NFT</a>` : '';
            showToast(`Minted ${result.item.name} #${result.item.serial}`);
            const panel = document.getElementById('hederaPanel');
            if (panel) panel.insertAdjacentHTML('afterbegin', `<div class="hedera-claim-ok">🖼 Minted <b>${escapeHtml(result.item.name)}</b> #${result.item.serial}${link}</div>`);
            renderHederaPanel();
        } catch (err) {
            showToast(err.message);
        }
    }

    // ===== global leaderboard =====
    async function openLeaderboard() {
        const modal = document.getElementById('leaderboardModal');
        if (!modal) return;
        modal.classList.remove('hidden');
        const body = document.getElementById('leaderboardBody');
        if (!body) return;
        body.innerHTML = '<div class="lb-empty">Loading…</div>';
        try {
            const data = await request('/api/v1/leaderboard');
            if (!data.entries || data.entries.length === 0) {
                body.innerHTML = '<div class="lb-empty">No matches recorded yet — be the first!</div>';
                return;
            }
            body.innerHTML = data.entries.map((entry) => {
                const receipt = entry.receiptUrl
                    ? `<a class="glb-receipt" href="${escapeHtml(entry.receiptUrl)}" target="_blank" rel="noopener" title="Hedera receipt">⛓</a>`
                    : '<span class="glb-receipt muted">—</span>';
                return `<div class="glb-row">
                    <span class="glb-rank">#${entry.rank}</span>
                    <span class="glb-name">${escapeHtml(entry.username)}</span>
                    <span class="glb-score">${entry.score}</span>
                    <span class="glb-kills">${entry.kills} 🎯</span>
                    <span class="glb-matches">${entry.matches} 🎮</span>
                    <span class="glb-link">${receipt}</span>
                </div>`;
            }).join('');
        } catch (err) {
            body.innerHTML = `<div class="lb-empty">${escapeHtml(err.message)}</div>`;
        }
    }

    function closeLeaderboard() {
        const modal = document.getElementById('leaderboardModal');
        if (modal) modal.classList.add('hidden');
    }

    // ===== toast =====
    function showToast(message) {
        let el = document.getElementById('fishToast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'fishToast';
            document.body.appendChild(el);
        }
        el.textContent = message;
        el.classList.add('show');
        clearTimeout(showToast._timer);
        showToast._timer = setTimeout(() => el.classList.remove('show'), 3200);
    }

    // ===== $GOLD shop (on-chain cosmetics) =====
    let goldShop = null;   // server catalog: { online, items: [{type,id,name,costGold,priceGold}] }
    let goldWallet = null; // last /hedera/gold snapshot (balance/pending)

    function entitlementsList() {
        const sm = window.shopManager;
        return {
            fish: sm && sm.unlockedFish,
            weapon: sm && sm.unlockedWeapons,
            hat: sm && sm.unlockedHats,
        };
    }

    function applyEntitlements(payload) {
        if (!payload || !Array.isArray(payload.items)) return false;
        const lists = entitlementsList();
        let changed = false;
        for (const ent of payload.items) {
            const list = lists[ent.type];
            if (Array.isArray(list) && !list.includes(ent.id)) {
                list.push(ent.id);
                changed = true;
            }
        }
        if (changed) {
            const sm = window.shopManager;
            if (sm && typeof sm.save === 'function') sm.save();
            if (typeof updateMenuStats === 'function') updateMenuStats();
        }
        return changed;
    }

    function renderGoldShopChrome() {
        const el = document.getElementById('shopGoldChain');
        if (!el) return;
        if (!currentUser) {
            el.textContent = '⛓ $GOLD: sign in to use';
            el.classList.add('muted');
            return;
        }
        el.classList.remove('muted');
        const balance = goldWallet && typeof goldWallet.balance === 'number' ? goldWallet.balance : null;
        const pending = goldWallet ? Math.round(goldWallet.pending || 0) : 0;
        el.textContent = `⛓ ${balance == null ? '—' : balance} $GOLD${pending > 0 ? ` · ${pending} pending` : ''}`;
    }

    async function refreshGoldShop() {
        if (currentUser) {
            const [shop, wallet, ents] = await Promise.all([
                request('/api/v1/hedera/shop').catch(() => null),
                request('/api/v1/hedera/gold').catch(() => null),
                request('/api/v1/me/entitlements').catch(() => null),
            ]);
            goldShop = shop;
            goldWallet = wallet;
            applyEntitlements(ents);
        } else {
            goldShop = null;
            goldWallet = null;
        }
        renderGoldShopChrome();
        if (typeof renderShopItems === 'function') {
            try { renderShopItems(); } catch { /* shop not open */ }
        }
    }

    function goldPriceFor(type, id) {
        if (!goldShop || !Array.isArray(goldShop.items)) return null;
        const item = goldShop.items.find((entry) => entry.type === type && entry.id === id);
        return item ? item.priceGold : null;
    }

    async function purchaseWithGold(type, id) {
        const result = await request('/api/v1/hedera/shop/purchase', { method: 'POST', body: { type, id } });
        if (result && result.entitlement) applyEntitlements({ items: [result.entitlement] });
        await refreshGoldShop();
        return result;
    }

    // ===== boot =====
    function init() {
        hookShopSave();
        loadHederaStatus().catch(() => {});
        refreshSession()
            .then(async (user) => {
                if (user) {
                    try { await pullSave(); } catch { /* keep playing offline */ }
                }
                try { await refreshGoldShop(); } catch { /* shop unavailable */ }
            })
            .catch(() => { /* API down: play as guest */ });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // globals used by inline handlers in index.html
    window.openAuthModal = openAuthModal;
    window.closeAuthModal = closeAuthModal;
    window.switchAuthTab = switchAuthTab;
    window.submitAuth = submitAuth;
    window.fishLogout = logout;
    window.fishToast = showToast;
    window.openLeaderboard = openLeaderboard;
    window.closeLeaderboard = closeLeaderboard;
    window.fishStartLink = fishStartLink;
    window.fishCancelLink = fishCancelLink;
    window.fishVerifyWallet = fishVerifyWallet;
    window.fishUnlinkWallet = fishUnlinkWallet;
    window.fishExportWallet = fishExportWallet;
    window.fishClaimGold = fishClaimGold;
    window.fishMintItem = fishMintItem;
    window.fishGoldShop = {
        refresh: refreshGoldShop,
        priceFor: goldPriceFor,
        purchase: purchaseWithGold,
        balance: () => (goldWallet ? goldWallet.balance : null),
        pending: () => (goldWallet ? goldWallet.pending : null),
        enabled: () => Boolean(currentUser && goldShop && goldShop.online),
    };
    window.fishAuth = {
        get user() { return currentUser; },
        refreshSession,
        pullSave,
        pushSave,
    };
})();
