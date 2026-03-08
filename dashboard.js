// ============================================================
//  dashboard.js — Alka AI : Détection AI + gestion du dashboard
//
//  Modes de détection (priorité décroissante) :
//    1. Backend Python (face_recognition) si dispo sur backendUrl
//    2. Simulation : retourne un user aléatoire depuis Supabase
// ============================================================

let selectedFile   = null;   // Fichier image sélectionné
let allUsers       = [];     // Cache des utilisateurs Supabase
let scanCount      = 0;      // Compteur de scans de la session
let backendAvailable = false; // Si le backend Python répond

// ── Initialisation au chargement ───────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await checkSession();
  await loadUserProfile();
  await checkBackendStatus();
  await loadUsers();
  loadScanCount();
});

// ── Vérifie la session (redirect si non connecté) ──────────
async function checkSession() {
  const db = getSupabase();
  const { data: { session } } = await db.auth.getSession();
  if (!session) { window.location.href = 'index.html'; }
  return session;
}

// ── Charge le profil utilisateur connecté ──────────────────
async function loadUserProfile() {
  const db = getSupabase();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return;

  const usernameEl = document.getElementById('navbar-username');
  const nom = user.user_metadata?.nom || user.email.split('@')[0];
  if (usernameEl) usernameEl.textContent = nom;
}

// ── Vérifie si le backend Python est disponible ─────────────
async function checkBackendStatus() {
  const indicator = document.getElementById('ai-mode-indicator');
  const text      = document.getElementById('ai-mode-text');

  try {
    const res = await fetch(`${window.SUPABASE_CONFIG.backendUrl}/health`, {
      signal: AbortSignal.timeout(2000)  // timeout 2s
    });
    if (res.ok) {
      backendAvailable = true;
      if (indicator) {
        indicator.className = 'status-indicator status-live';
        indicator.innerHTML = '<div class="dot-live"></div><span>AI Réelle</span>';
      }
      console.log('[Backend] Python backend disponible ✓');
      document.getElementById('stat-accuracy').textContent = '~92%';
    }
  } catch {
    backendAvailable = false;
    if (indicator) {
      indicator.className = 'status-indicator status-sim';
      text.textContent = 'Simulation';
    }
    document.getElementById('stat-accuracy').textContent = 'SIM';
    console.log('[Backend] Non disponible → mode simulation');
  }
}

// ── Charge les utilisateurs depuis Supabase ─────────────────
async function loadUsers() {
  const db = getSupabase();
  const { data, error } = await db
    .from('users')
    .select('id, nom, email, pays, photo')
    .order('id', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[loadUsers]', error);
    return;
  }

  allUsers = data || [];
  renderUsersTable(allUsers);
  document.getElementById('stat-users').textContent = allUsers.length;
}

// ── Rendu du tableau d'utilisateurs ─────────────────────────
function renderUsersTable(users) {
  const container = document.getElementById('users-list');
  if (!users.length) {
    container.innerHTML = '<p class="text-muted text-center mt-2">Aucun utilisateur trouvé.</p>';
    return;
  }

  // Drapeaux par pays
  const flags = {
    'Madagascar': '🇲🇬', 'France': '🇫🇷', 'Maroc': '🇲🇦',
    'Côte d\'Ivoire': '🇨🇮', 'Sénégal': '🇸🇳', 'Cameroun': '🇨🇲',
    'Algérie': '🇩🇿', 'Tunisie': '🇹🇳', 'Canada': '🇨🇦',
    'Belgique': '🇧🇪', 'Suisse': '🇨🇭',
  };

  const rows = users.slice(0, 8).map(u => `
    <tr>
      <td><strong>${u.nom || '—'}</strong></td>
      <td style="color:var(--text-muted)">${u.email || '—'}</td>
      <td>${flags[u.pays] || '🌍'} ${u.pays || '—'}</td>
    </tr>
  `).join('');

  container.innerHTML = `
    <div style="overflow-x:auto">
      <table class="users-table">
        <thead>
          <tr><th>Nom</th><th>Email</th><th>Pays</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${users.length > 8 ? `<p class="text-muted text-center mt-2" style="font-size:0.75rem">
      + ${users.length - 8} autres utilisateurs
    </p>` : ''}
  `;
}

// ── Gestion de la sélection de photo ───────────────────────
function handlePhotoSelect(event) {
  const file = event.target.files[0];
  if (file) processSelectedFile(file);
}

function handleDragOver(event) {
  event.preventDefault();
  document.getElementById('upload-zone').classList.add('dragover');
}

function handleDrop(event) {
  event.preventDefault();
  document.getElementById('upload-zone').classList.remove('dragover');
  const file = event.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) processSelectedFile(file);
}

function processSelectedFile(file) {
  if (file.size > 5 * 1024 * 1024) {
    showDetectError('Image trop lourde (max 5 Mo).');
    return;
  }

  selectedFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    const preview = document.getElementById('preview-img');
    preview.src   = e.target.result;
    preview.style.display = 'block';
    document.getElementById('btn-detect').disabled = false;
    document.getElementById('result-panel').classList.remove('show');
  };
  reader.readAsDataURL(file);
}

// ── Lancement de la détection ───────────────────────────────
async function handleDetect() {
  if (!selectedFile) {
    showDetectError('Veuillez d\'abord sélectionner une photo.');
    return;
  }

  // Animation scan
  document.getElementById('upload-zone').classList.add('scanning');
  setLoading('btn-detect', 'spinner-detect', 'label-detect', true, 'Analyse en cours…');
  document.getElementById('detect-error').classList.remove('show');
  document.getElementById('result-panel').classList.remove('show');

  try {
    let result;

    if (backendAvailable) {
      // ── Mode 1 : Backend Python avec vraie reconnaissance faciale ──
      result = await detectWithPython(selectedFile);
    } else {
      // ── Mode 2 : Simulation (utilisateur aléatoire) ─────────────
      await sleep(1800); // Simuler le temps d'analyse
      result = simulateDetection();
    }

    // Afficher le résultat
    displayResult(result);

    // Incrémenter compteur scans
    scanCount++;
    saveScanCount();
    document.getElementById('stat-scans').textContent = scanCount;

  } catch (err) {
    console.error('[handleDetect]', err);
    showDetectError('Erreur lors de l\'analyse. Réessayez.');
  } finally {
    document.getElementById('upload-zone').classList.remove('scanning');
    setLoading('btn-detect', 'spinner-detect', 'label-detect', false, '⚡ Lancer la détection AI');
  }
}

// ── Appel au backend Python (reconnaissance faciale réelle) ─
async function detectWithPython(file) {
  const formData = new FormData();
  formData.append('photo', file);

  const response = await fetch(`${window.SUPABASE_CONFIG.backendUrl}/detect`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Erreur backend: ${response.status}`);
  }

  const data = await response.json();

  // Format de retour attendu du backend Python:
  // { found: bool, user: {id, nom, email, pays, photo}, confidence: float, mode: "real" }
  return data;
}

// ── Simulation : retourne un user aléatoire ─────────────────
function simulateDetection() {
  if (!allUsers.length) {
    return { found: false, user: null, confidence: 0, mode: 'simulation' };
  }

  // Confiance simulée entre 72% et 97%
  const confidence = Math.floor(Math.random() * 26) + 72;
  const user = allUsers[Math.floor(Math.random() * allUsers.length)];

  return {
    found: true,
    user,
    confidence,
    mode: 'simulation',
  };
}

// ── Affichage du résultat ────────────────────────────────────
function displayResult(result) {
  const panel = document.getElementById('result-panel');
  panel.classList.add('show');

  if (!result.found || !result.user) {
    // Aucune correspondance trouvée
    document.getElementById('result-name').textContent = 'Inconnu';
    document.getElementById('result-email').textContent = '—';
    document.getElementById('result-pays').textContent = '—';
    document.getElementById('result-id').textContent = '—';
    document.getElementById('result-badge').className = 'result-badge badge-notfound';
    document.getElementById('result-badge').textContent = '✗ Non identifié';
    document.getElementById('result-avatar').innerHTML = '❓';
    setConfidence(0);
    document.getElementById('result-subtitle').textContent = 'Aucune correspondance trouvée';
    return;
  }

  const u = result.user;

  // Remplir les informations
  document.getElementById('result-name').textContent    = u.nom || '—';
  document.getElementById('result-email').textContent   = u.email || '—';
  document.getElementById('result-pays').textContent    = u.pays || '—';
  document.getElementById('result-id').textContent      = `#${u.id}`;

  // Badge selon le mode
  const badge = document.getElementById('result-badge');
  if (result.mode === 'real' || result.mode === 'face_recognition') {
    badge.className   = 'result-badge badge-found';
    badge.textContent = '● Identifié (AI réelle)';
    document.getElementById('result-subtitle').textContent = `Reconnaissance faciale — ${result.confidence}% de confiance`;
  } else {
    badge.className   = 'result-badge badge-simulated';
    badge.textContent = '◐ Simulation AI';
    document.getElementById('result-subtitle').textContent = 'Mode simulation — activez le backend Python pour l\'IA réelle';
  }

  // Avatar
  const avatarEl = document.getElementById('result-avatar');
  if (u.photo) {
    avatarEl.innerHTML = `<img src="${u.photo}" alt="${u.nom}" onerror="this.parentNode.textContent='👤'" />`;
  } else {
    avatarEl.innerHTML = '👤';
  }

  // Barre de confiance (animation différée)
  setConfidence(result.confidence || 0);
}

function setConfidence(value) {
  document.getElementById('result-confidence-txt').textContent = `${value}%`;
  setTimeout(() => {
    document.getElementById('result-confidence-bar').style.width = `${value}%`;
  }, 100);
}

// ── Réinitialiser pour une nouvelle analyse ─────────────────
function resetDetection() {
  selectedFile = null;
  document.getElementById('photo-input').value = '';
  document.getElementById('preview-img').style.display = 'none';
  document.getElementById('btn-detect').disabled = true;
  document.getElementById('result-panel').classList.remove('show');
  document.getElementById('detect-error').classList.remove('show');
}

// ── Compteur de scans (localStorage) ────────────────────────
function loadScanCount() {
  const month   = new Date().toISOString().slice(0, 7); // "2025-01"
  const stored  = localStorage.getItem(`alka_scans_${month}`);
  scanCount     = stored ? parseInt(stored) : 0;
  document.getElementById('stat-scans').textContent = scanCount;
}

function saveScanCount() {
  const month = new Date().toISOString().slice(0, 7);
  localStorage.setItem(`alka_scans_${month}`, scanCount);
}

// ── Helpers ─────────────────────────────────────────────────
function showDetectError(msg) {
  const el = document.getElementById('detect-error');
  document.getElementById('detect-error-msg').textContent = msg;
  el.classList.add('show');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
