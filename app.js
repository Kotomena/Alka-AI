// ============================================================
//  app.js — Alka AI
//
//  RÈGLES STRICTES AUTH :
//
//  CONNEXION :
//    1. Vérifier si l'email existe dans la table users
//       → Non trouvé : "Cet email n'est pas encore inscrit."
//    2. Tenter la connexion Supabase Auth
//       → Mauvais mot de passe : "Mot de passe incorrect."
//
//  INSCRIPTION :
//    - Email UNIQUE       → "Cet email est déjà utilisé."
//    - CIN UNIQUE         → "Ce numéro CIN est déjà enregistré."
//    - Nom complet UNIQUE → "Ce nom est déjà enregistré."
//    - Adresse            → PAS de restriction
//    - Contact famille    → PAS de restriction
//    - Photo              → OBLIGATOIRE
//
// ============================================================


// ════════════════════════════════════════════════════════════
// 1. CLIENT SUPABASE (singleton)
// ════════════════════════════════════════════════════════════

var _db = null;

function getSupabase() {
  if (!_db) {
    _db = supabase.createClient(
      window.SUPABASE_CONFIG.url,
      window.SUPABASE_CONFIG.anonKey
    );
  }
  return _db;
}


// ════════════════════════════════════════════════════════════
// 2. REDIRECTION AUTOMATIQUE AU CHARGEMENT
// ════════════════════════════════════════════════════════════

(async function init() {
  var db   = getSupabase();
  var path = window.location.pathname;

  var res     = await db.auth.getSession();
  var session = res.data ? res.data.session : null;

  var surIndex     = path.includes("index.html") || path.endsWith("/");
  var surDashboard = path.includes("dashboard.html");

  // Déjà connecté → aller au dashboard
  if (session && surIndex) {
    window.location.href = "dashboard.html";
    return;
  }
  // Pas connecté → retour à l'accueil
  if (!session && surDashboard) {
    window.location.href = "index.html";
    return;
  }
  if (surDashboard) {
    initDashboard();
  }
})();


// ════════════════════════════════════════════════════════════
// 3. UTILITAIRES UI
// ════════════════════════════════════════════════════════════

// Alerte globale (en bas de la carte)
function showAlert(type, msg) {
  var eEl = document.getElementById("alert-err");
  var oEl = document.getElementById("alert-ok");
  if (!eEl || !oEl) return;
  eEl.classList.remove("show");
  oEl.classList.remove("show");
  if (type === "err") {
    document.getElementById("alert-err-msg").textContent = msg;
    eEl.classList.add("show");
  }
  if (type === "ok") {
    document.getElementById("alert-ok-msg").textContent = msg;
    oEl.classList.add("show");
  }
}

// ── Erreurs inline par champ ─────────────────────────────────

/*
 * showFieldErr — affiche un message d'erreur sous un champ précis.
 *
 * @param {string} inputId   ID de l'<input>  (ex: "r-email")
 * @param {string} msg       Message à afficher (optionnel, sinon celui du HTML)
 *
 * Nécessite dans le HTML :
 *   <div class="iw" id="iw-{inputId}">...</div>
 *   <div class="field-err" id="err-{inputId}">
 *     <span id="err-{inputId}-msg">Message par défaut</span>
 *   </div>
 */
function showFieldErr(inputId, msg) {
  // Bordure rouge sur le wrapper
  var iw = document.getElementById("iw-" + inputId);
  if (iw) { iw.classList.add("has-error"); iw.classList.remove("is-valid"); }

  // Afficher le bloc d'erreur
  var errBlock = document.getElementById("err-" + inputId);
  if (errBlock) errBlock.classList.add("show");

  // Mettre à jour le texte si fourni
  if (msg) {
    var errMsg = document.getElementById("err-" + inputId + "-msg");
    if (errMsg) errMsg.textContent = msg;
  }
}

// Efface l'erreur d'un champ (appelé sur oninput)
function clearFieldErr(inputId) {
  var iw = document.getElementById("iw-" + inputId);
  if (iw) { iw.classList.remove("has-error"); }

  var errBlock = document.getElementById("err-" + inputId);
  if (errBlock) errBlock.classList.remove("show");
}

// Efface toutes les erreurs du formulaire d'inscription
function clearAllRegErrors() {
  ["r-nom", "r-cin", "r-email", "r-photo"].forEach(function(id) {
    clearFieldErr(id);
  });
}

// Efface toutes les erreurs du formulaire de connexion
function clearAllLoginErrors() {
  ["l-email", "l-pwd"].forEach(function(id) {
    clearFieldErr(id);
  });
}

// Bouton loading / normal
function setBtn(btnId, spId, lblId, loading, label) {
  var b = document.getElementById(btnId);
  var s = document.getElementById(spId);
  var l = document.getElementById(lblId);
  if (!b) return;
  b.disabled = loading;
  if (s) s.style.display = loading ? "block" : "none";
  if (l && label) l.textContent = label;
}

// Modifier le texte d'un élément
function setText(id, text) {
  var el = document.getElementById(id);
  if (el) el.textContent = (text !== undefined && text !== null) ? String(text) : "";
}

// Lire la valeur d'un input/select
function val(id) {
  var el = document.getElementById(id);
  return el ? el.value.trim() : "";
}

// Pause en ms
function sleep(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

// Barre de progression "en cours"
function showBar(barId, show, msg) {
  var bar = document.getElementById(barId);
  if (!bar) return;
  if (show) {
    bar.classList.add("show");
    if (msg) {
      var sp = document.getElementById("search-bar-txt");
      if (sp) sp.textContent = msg;
    }
  } else {
    bar.classList.remove("show");
  }
}


// ════════════════════════════════════════════════════════════
// 4. TABS AUTH
// ════════════════════════════════════════════════════════════

function switchTab(tab) {
  // Réinitialiser toutes les erreurs et alertes
  showAlert("none", "");
  clearAllLoginErrors();
  clearAllRegErrors();

  var fL = document.getElementById("form-login");
  var fR = document.getElementById("form-register");
  var tL = document.getElementById("tab-login");
  var tR = document.getElementById("tab-register");
  if (!fL) return;

  if (tab === "login") {
    fL.style.display = "block"; fR.style.display = "none";
    tL.classList.add("active"); tR.classList.remove("active");
  } else {
    fL.style.display = "none"; fR.style.display = "block";
    tL.classList.remove("active"); tR.classList.add("active");
  }
}


// ════════════════════════════════════════════════════════════
// 5. CONNEXION
//
// Étapes :
//   A. Vérifier que l'email existe dans la table users
//      → Absent : erreur inline sous le champ email
//   B. Tenter signInWithPassword
//      → Mauvais mot de passe : erreur inline sous le champ pwd
// ════════════════════════════════════════════════════════════

async function handleLogin() {
  var email = val("l-email");
  var pwd   = val("l-pwd");

  // Réinitialiser les erreurs précédentes
  clearAllLoginErrors();
  showAlert("none", "");

  // Validation basique
  if (!email) {
    showFieldErr("l-email", "Veuillez saisir votre email.");
    return;
  }
  if (!pwd) {
    showFieldErr("l-pwd", "Veuillez saisir votre mot de passe.");
    return;
  }

  setBtn("btn-login", "sp-login", "lbl-login", true, "");

  try {
    var db = getSupabase();

    // ── Étape A : vérifier que l'email existe dans users ────
    // On interroge la table users (pas Supabase Auth directement)
    // car Auth ne dit pas si l'email existe, il dit juste "mauvais mdp"
    var checkEmail = await db
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (!checkEmail.data) {
      // Email absent de la base → refuser la connexion avec message précis
      showFieldErr("l-email", "Cet email n'est pas encore inscrit. Veuillez créer un compte.");
      setBtn("btn-login", "sp-login", "lbl-login", false, "Se connecter");
      return;
    }

    // ── Étape B : tenter la connexion Supabase Auth ──────────
    var res = await db.auth.signInWithPassword({ email: email, password: pwd });

    if (res.error) {
      var m = res.error.message;

      // Mauvais mot de passe (email existe mais pwd incorrect)
      if (m.includes("Invalid login") || m.includes("credentials") || m.includes("invalid")) {
        showFieldErr("l-pwd", "Mot de passe incorrect.");
        setBtn("btn-login", "sp-login", "lbl-login", false, "Se connecter");
        return;
      }

      // Autre erreur Supabase
      throw new Error(m);
    }

    // ── Succès ───────────────────────────────────────────────
    showAlert("ok", "Connexion réussie ! Redirection...");
    setTimeout(function() { window.location.href = "dashboard.html"; }, 900);

  } catch (err) {
    // Erreur inattendue → alerte globale
    showAlert("err", err.message || "Erreur de connexion. Veuillez réessayer.");
    setBtn("btn-login", "sp-login", "lbl-login", false, "Se connecter");
  }
}


// ════════════════════════════════════════════════════════════
// 6. INSCRIPTION
//
// Vérifications AVANT la création du compte :
//   1. Photo présente
//   2. Email unique   → erreur inline sur #r-email
//   3. CIN unique     → erreur inline sur #r-cin
//   4. Nom unique     → erreur inline sur #r-nom
//
// Adresse et Contact famille : PAS de vérification d'unicité.
//
// Création :
//   1. Supabase Auth signUp
//   2. Upload photo → Storage bucket "photos"
//   3. INSERT INTO users
//   4. INSERT INTO photos (face_encoding = null pour l'instant)
// ════════════════════════════════════════════════════════════

var _regFile = null;   // fichier photo sélectionné

function handleRegPhoto(e) {
  var f = e.target.files[0];
  if (f) applyRegPhoto(f);
}

function handleRegDrop(e) {
  e.preventDefault();
  var z = document.getElementById("reg-zone");
  if (z) z.classList.remove("over");
  var f = e.dataTransfer.files[0];
  if (f && f.type.startsWith("image/")) applyRegPhoto(f);
}

function applyRegPhoto(file) {
  if (file.size > 5 * 1024 * 1024) {
    showFieldErr("r-photo", "Photo trop lourde. Maximum 5 Mo.");
    return;
  }
  _regFile = file;

  var r = new FileReader();
  r.onload = function(e) {
    var ph = document.getElementById("reg-placeholder");
    var pv = document.getElementById("reg-preview");
    var z  = document.getElementById("reg-zone");
    if (ph) ph.style.display = "none";
    if (pv) { pv.src = e.target.result; pv.style.display = "block"; }
    if (z)  z.style.borderColor = "";
    // Effacer l'erreur photo si une photo est maintenant sélectionnée
    clearFieldErr("r-photo");
  };
  r.readAsDataURL(file);
}

async function handleRegister() {
  var nom     = val("r-nom");
  var pays    = val("r-pays");
  var cin     = val("r-cin");
  var adresse = val("r-adresse");
  var email   = val("r-email");
  var pwd     = val("r-pwd");
  var contact = val("r-contact");   // facultatif, pas de restriction

  // Réinitialiser toutes les erreurs
  clearAllRegErrors();
  showAlert("none", "");

  // ── Validation des champs obligatoires ────────────────────
  var hasError = false;

  if (!nom) {
    showFieldErr("r-nom", "Le nom complet est obligatoire.");
    hasError = true;
  }
  if (!cin) {
    showFieldErr("r-cin", "Le numéro CIN est obligatoire.");
    hasError = true;
  }
  if (!email) {
    showFieldErr("r-email", "L'email est obligatoire.");
    hasError = true;
  }
  if (!pays || !adresse || !pwd) {
    showAlert("err", "Veuillez remplir tous les champs obligatoires (*).");
    hasError = true;
  }
  if (pwd && pwd.length < 6) {
    showAlert("err", "Le mot de passe doit contenir au moins 6 caractères.");
    hasError = true;
  }

  // ── Photo obligatoire ──────────────────────────────────────
  if (!_regFile) {
    showFieldErr("r-photo", "La photo est obligatoire pour l'identification.");
    // Surligner la zone d'upload
    var z = document.getElementById("reg-zone");
    if (z) z.style.borderColor = "#ff3c3c";
    hasError = true;
  }

  if (hasError) return;

  setBtn("btn-reg", "sp-reg", "lbl-reg", true, "");

  try {
    var db = getSupabase();

    // ══════════════════════════════════════════════════════
    // ÉTAPE 1 — Vérifications d'unicité AVANT création
    // ══════════════════════════════════════════════════════

    // Vérifier toutes les contraintes en parallèle (plus rapide)
    var checks = await Promise.all([
      db.from("users").select("id").eq("email", email).maybeSingle(),
      db.from("users").select("id").ilike("cin", cin).maybeSingle(),
      db.from("users").select("id").ilike("nom", nom).maybeSingle()
    ]);

    var emailExists = checks[0].data;
    var cinExists   = checks[1].data;
    var nomExists   = checks[2].data;

    // Afficher les erreurs inline pour chaque conflit
    var conflits = false;

    if (emailExists) {
      // "Cet email est déjà utilisé."
      showFieldErr("r-email", "Cet email est déjà utilisé.");
      conflits = true;
    }
    if (cinExists) {
      // "Ce numéro CIN est déjà enregistré."
      showFieldErr("r-cin", "Ce numéro CIN est déjà enregistré.");
      conflits = true;
    }
    if (nomExists) {
      // "Ce nom est déjà enregistré."
      showFieldErr("r-nom", "Ce nom est déjà enregistré.");
      conflits = true;
    }

    // Si au moins un conflit → arrêter ici, pas de création
    if (conflits) {
      setBtn("btn-reg", "sp-reg", "lbl-reg", false, "Créer mon profil");
      return;
    }

    // ══════════════════════════════════════════════════════
    // ÉTAPE 2 — Créer le compte Supabase Auth
    // ══════════════════════════════════════════════════════

    var ar = await db.auth.signUp({
      email:   email,
      password: pwd,
      options: { data: { nom: nom, pays: pays } }
    });

    if (ar.error) {
      // Supabase Auth peut aussi détecter l'email en doublon
      if (ar.error.message.includes("already registered") ||
          ar.error.message.includes("already been registered")) {
        showFieldErr("r-email", "Cet email est déjà utilisé.");
        setBtn("btn-reg", "sp-reg", "lbl-reg", false, "Créer mon profil");
        return;
      }
      throw new Error("Erreur Auth : " + ar.error.message);
    }

    // ══════════════════════════════════════════════════════
    // ÉTAPE 3 — Upload de la photo dans Storage
    // ══════════════════════════════════════════════════════

    // Nom du bucket Supabase Storage
    // → Changez ici si votre bucket a un autre nom
    var BUCKET = "photos";

    var ext      = (_regFile.name.split(".").pop() || "jpg")
                    .toLowerCase().replace(/[^a-z0-9]/g, "");
    var fileName = Date.now() + "_" + Math.random().toString(36).slice(2) + "." + ext;

    var ur = await db.storage.from(BUCKET).upload(fileName, _regFile, {
      cacheControl: "3600",
      upsert:       false,
      contentType:  _regFile.type || "image/jpeg"
    });

    if (ur.error) {
      var um = ur.error.message;
      if (um.includes("Bucket not found")) {
        um = "Bucket \"" + BUCKET + "\" introuvable. " +
             "Supabase → Storage → New bucket → Nom: " + BUCKET + " → Public: oui";
      } else if (um.includes("not authorized") || ur.error.statusCode === 403) {
        um = "Permission refusée sur le bucket. " +
             "Supabase → Storage → Policies → INSERT pour authenticated.";
      }
      throw new Error("Échec upload photo : " + um);
    }

    // Récupérer l'URL publique de la photo
    var urlR     = db.storage.from(BUCKET).getPublicUrl(fileName);
    var photoUrl = urlR.data ? urlR.data.publicUrl : null;

    if (!photoUrl) {
      throw new Error("URL photo non générée. Vérifiez que le bucket est en mode Public.");
    }

    // ══════════════════════════════════════════════════════
    // ÉTAPE 4 — Insérer le profil dans la table users
    // ══════════════════════════════════════════════════════
    //
    // Colonnes UNIQUE en base :  email, cin, nom
    // Colonnes SANS restriction : adresse, contact_famille

    var ir = await db
      .from("users")
      .insert([{
        nom:             nom,
        email:           email,
        pays:            pays,
        photo:           photoUrl,
        cin:             cin,
        adresse:         adresse,          // PAS de contrainte UNIQUE
        contact_famille: contact || null   // PAS de contrainte UNIQUE
      }])
      .select("id")
      .single();

    if (ir.error) {
      // Code 23505 = violation de contrainte UNIQUE en PostgreSQL
      if (ir.error.code === "23505") {
        var detail = ir.error.details || ir.error.message;
        // Identifier quel champ est en doublon depuis le message PostgreSQL
        if (detail.includes("email")) {
          showFieldErr("r-email", "Cet email est déjà utilisé.");
        } else if (detail.includes("cin")) {
          showFieldErr("r-cin", "Ce numéro CIN est déjà enregistré.");
        } else if (detail.includes("nom")) {
          showFieldErr("r-nom", "Ce nom est déjà enregistré.");
        } else {
          showAlert("err", "Une valeur unique est déjà utilisée (email, CIN ou nom).");
        }
        setBtn("btn-reg", "sp-reg", "lbl-reg", false, "Créer mon profil");
        return;
      }

      // Code 42501 = accès refusé par RLS
      if (ir.error.code === "42501" || ir.error.message.includes("row-level security")) {
        throw new Error(
          "Accès refusé (RLS). Dans Supabase → Table Editor → users → Policies, " +
          "ajoutez une politique INSERT ou désactivez RLS temporairement."
        );
      }

      throw new Error("Erreur base de données : " + ir.error.message);
    }

    // ══════════════════════════════════════════════════════
    // ÉTAPE 5 — Insérer dans la table photos
    // face_encoding = null (sera activé quand la reconnaissance faciale reviendra)
    // ══════════════════════════════════════════════════════

    if (ir.data && ir.data.id) {
      var pr = await db.from("photos").insert([{
        user_id:       ir.data.id,
        photo_url:     photoUrl,
        face_encoding: null
      }]);
      if (pr.error) {
        // Non bloquant : on log mais on ne bloque pas l'inscription
        console.warn("[Register] photos insert:", pr.error.message);
      }
    }

    // ── Succès ────────────────────────────────────────────
    showAlert("ok", "Profil créé avec succès ! Vous pouvez maintenant vous connecter.");
    _regFile = null;
    setBtn("btn-reg", "sp-reg", "lbl-reg", false, "Créer mon profil");

    // Revenir à l'onglet connexion après 2.5 secondes
    setTimeout(function() { switchTab("login"); }, 2500);

  } catch (err) {
    // Erreur inattendue → alerte globale
    showAlert("err", err.message || "Erreur inconnue lors de l'inscription.");
    setBtn("btn-reg", "sp-reg", "lbl-reg", false, "Créer mon profil");
  }
}


// ════════════════════════════════════════════════════════════
// 7. DÉCONNEXION
// ════════════════════════════════════════════════════════════

async function handleLogout() {
  await getSupabase().auth.signOut();
  window.location.href = "index.html";
}


// ════════════════════════════════════════════════════════════
// 8. NAVIGATION DASHBOARD
// ════════════════════════════════════════════════════════════

function showPage(page) {
  var d  = document.getElementById("page-dash");
  var u  = document.getElementById("page-urgence");
  var td = document.getElementById("tab-dash");
  var tu = document.getElementById("tab-urgence");
  if (d)  d.style.display  = page === "dash"    ? "block" : "none";
  if (u)  u.style.display  = page === "urgence" ? "block" : "none";
  if (td) td.classList.toggle("active", page === "dash");
  if (tu) tu.classList.toggle("active", page === "urgence");
}


// ════════════════════════════════════════════════════════════
// 9. INITIALISATION DASHBOARD
// ════════════════════════════════════════════════════════════

var _scanCount = 0;

async function initDashboard() {
  await loadNavProfile();
  loadScanCount();
  await Promise.all([loadStats(), loadUsersList()]);
  setMethod("cin");
}

async function loadNavProfile() {
  var db  = getSupabase();
  var res = await db.auth.getUser();
  var u   = res.data ? res.data.user : null;
  if (!u) return;
  var nom = (u.user_metadata && u.user_metadata.nom)
    ? u.user_metadata.nom
    : u.email.split("@")[0];
  setText("nav-username", nom);
}

async function loadStats() {
  var db = getSupabase();
  var ru = await db.from("users").select("*",  { count: "exact", head: true });
  var rp = await db.from("photos").select("*", { count: "exact", head: true });
  setText("s-users",  ru.count != null ? ru.count : "?");
  setText("s-photos", rp.count != null ? rp.count : "?");
  setText("s-scans",  _scanCount);
}

async function loadUsersList() {
  var db  = getSupabase();
  var res = await db
    .from("users")
    .select("id, nom, email, pays, cin, photo")
    .order("id", { ascending: false })
    .limit(8);

  var box = document.getElementById("users-list");
  if (!box) return;

  if (res.error || !res.data || res.data.length === 0) {
    box.innerHTML = "<p class='c-muted tc mt2'>Aucun profil enregistré.</p>";
    return;
  }

  var FLAGS = {
    "Madagascar":"🇲🇬","France":"🇫🇷","Maroc":"🇲🇦","Sénégal":"🇸🇳",
    "Cameroun":"🇨🇲","Algérie":"🇩🇿","Tunisie":"🇹🇳","Canada":"🇨🇦",
    "Belgique":"🇧🇪","Suisse":"🇨🇭","Côte d'Ivoire":"🇨🇮"
  };

  var rows = res.data.map(function(u) {
    var flag  = FLAGS[u.pays] || "🌍";
    var photo = u.photo
      ? "<img src='" + u.photo + "' style='width:26px;height:26px;border-radius:50%;object-fit:cover;vertical-align:middle' />"
      : "<span style='color:var(--muted);font-size:.72rem'>—</span>";
    return "<tr>" +
      "<td><strong>" + (u.nom  || "—") + "</strong></td>" +
      "<td style='color:var(--muted)'>" + (u.cin  || "—") + "</td>" +
      "<td>" + flag + " " + (u.pays || "—") + "</td>" +
      "<td>" + photo + "</td>" +
      "</tr>";
  }).join("");

  box.innerHTML =
    "<div style='overflow-x:auto'>" +
    "<table class='tbl'><thead><tr>" +
    "<th>Nom</th><th>CIN</th><th>Pays</th><th>Photo</th>" +
    "</tr></thead><tbody>" + rows + "</tbody></table></div>";
}

function loadScanCount() {
  var key = "alka_scans_" + new Date().toISOString().slice(0, 7);
  _scanCount = parseInt(localStorage.getItem(key) || "0", 10);
  setText("s-scans", _scanCount);
}

function saveScanCount() {
  localStorage.setItem("alka_scans_" + new Date().toISOString().slice(0, 7), _scanCount);
}

function incrementScan() {
  _scanCount++;
  saveScanCount();
  setText("s-scans", _scanCount);
}


// ════════════════════════════════════════════════════════════
// 10. RECHERCHE D'URGENCE
//     Méthodes actives  : CIN, Adresse
//     Méthode désactivée: Photo
// ════════════════════════════════════════════════════════════

var _method = "cin";

function setMethod(m) {
  _method = m;

  ["cin", "adresse", "photo"].forEach(function(k) {
    var t = document.getElementById("mt-" + k);
    var f = document.getElementById("field-" + k);
    if (t) t.classList.remove("active");
    if (f) f.style.display = "none";
  });

  var at = document.getElementById("mt-" + m);
  var af = document.getElementById("field-" + m);
  if (at) at.classList.add("active");
  if (af) af.style.display = "block";

  // Masquer le bouton Rechercher pour la méthode photo (désactivée)
  var btn = document.getElementById("btn-search");
  if (btn) btn.style.display = (m === "photo") ? "none" : "block";

  clearResult();
  hideSearchErr();
}

async function searchPerson() {
  clearResult();
  hideSearchErr();

  if (_method === "photo") return;
  if (_method === "cin"     && !val("s-cin"))     return showSearchErr("Veuillez saisir un numéro CIN.");
  if (_method === "adresse" && !val("s-adresse")) return showSearchErr("Veuillez saisir une adresse.");

  setBtn("btn-search", "sp-search", "lbl-search", true, "");
  showBar("search-bar", true,
    _method === "cin" ? "Recherche par CIN en cours..." : "Recherche par adresse en cours..."
  );

  try {
    var db = getSupabase();

    if (_method === "cin") {
      var userC = await searchByCIN(db, val("s-cin"));
      if (userC) { showResult([userC]); incrementScan(); } else showNotFound();

    } else if (_method === "adresse") {
      var usersA = await searchByAdresse(db, val("s-adresse"));
      if (usersA.length > 0) { showResult(usersA); incrementScan(); } else showNotFound();
    }

  } catch (err) {
    showSearchErr("Erreur : " + (err.message || "inconnue"));
  } finally {
    showBar("search-bar", false);
    setBtn("btn-search", "sp-search", "lbl-search", false, "Rechercher");
  }
}

// CIN → exact, insensible à la casse, 1 résultat
async function searchByCIN(db, cin) {
  var res = await db
    .from("users")
    .select("id, nom, email, pays, photo, cin, adresse, contact_famille")
    .ilike("cin", cin)
    .maybeSingle();
  if (res.error) throw res.error;
  return res.data;
}

// Adresse → partielle, jusqu'à 20 résultats
async function searchByAdresse(db, adresse) {
  var res = await db
    .from("users")
    .select("id, nom, email, pays, photo, cin, adresse, contact_famille")
    .ilike("adresse", "%" + adresse + "%")
    .order("nom", { ascending: true })
    .limit(20);
  if (res.error) throw res.error;
  return res.data || [];
}


// ════════════════════════════════════════════════════════════
// 11. AFFICHAGE DES RÉSULTATS DE RECHERCHE
// ════════════════════════════════════════════════════════════

function showResult(users) {
  var count = users.length;
  setText("result-sub", count > 1 ? count + " personnes trouvées" : "Personne trouvée");

  var container = document.getElementById("res-found");
  if (!container) return;

  var html = "";

  users.forEach(function(u, i) {
    var contact = u.contact_famille || "Non renseigné";
    var hasTel  = /[\d+]/.test(contact);
    var tel     = hasTel ? contact.replace(/[^\d+]/g, "") : "";
    var callBtn = hasTel
      ? "<a class='btn-call' href='tel:" + tel + "'>📞 Appeler maintenant</a>"
      : "";
    var avatarInner = u.photo
      ? "<img src='" + u.photo + "' alt='photo' />"
      : "<span>👤</span>";
    var sep = i > 0 ? "margin-top:1.5rem;padding-top:1.5rem;border-top:1px solid var(--border)" : "";

    html +=
      "<div class='urg-card' style='" + sep + "'>" +
        "<div class='urg-header'>" +
          "<div class='urg-avatar'>" + avatarInner + "</div>" +
          "<div>" +
            "<div class='urg-name'>" + (u.nom || "—") + "</div>" +
            "<span class='badge badge-ok' style='margin-top:.2rem'>✓ Profil trouvé</span>" +
          "</div>" +
        "</div>" +
        "<div class='urg-info-grid'>" +
          "<div class='urg-info-item'><div class='urg-info-label'>Nom complet</div><div class='urg-info-val'>" + (u.nom     || "—") + "</div></div>" +
          "<div class='urg-info-item'><div class='urg-info-label'>Pays</div><div class='urg-info-val'>"        + (u.pays    || "—") + "</div></div>" +
          "<div class='urg-info-item'><div class='urg-info-label'>Numéro CIN</div><div class='urg-info-val'>"  + (u.cin     || "—") + "</div></div>" +
          "<div class='urg-info-item'><div class='urg-info-label'>Adresse</div><div class='urg-info-val'>"     + (u.adresse || "—") + "</div></div>" +
        "</div>" +
        "<div class='contact-box'>" +
          "<div class='contact-label'>🚑 Contact famille / urgence</div>" +
          "<div class='contact-val'>" + contact + "</div>" +
          callBtn +
        "</div>" +
      "</div>";
  });

  html += "<button class='btn btn-ghost' onclick='clearResult()' style='max-width:200px;margin-top:1.5rem'>↺ Nouvelle recherche</button>";

  container.innerHTML = html;
  document.getElementById("res-empty").style.display    = "none";
  document.getElementById("res-notfound").style.display = "none";
  container.style.display = "block";
}

function showNotFound() {
  setText("result-sub", "Aucun résultat");
  document.getElementById("res-empty").style.display    = "none";
  document.getElementById("res-found").style.display    = "none";
  document.getElementById("res-notfound").style.display = "flex";
}

function clearResult() {
  setText("result-sub", "En attente d'une recherche");
  var e = document.getElementById("res-empty");
  var f = document.getElementById("res-found");
  var n = document.getElementById("res-notfound");
  if (e) e.style.display = "flex";
  if (f) f.style.display = "none";
  if (n) n.style.display = "none";
}

function showSearchErr(msg) {
  var el = document.getElementById("search-err");
  var m  = document.getElementById("search-err-msg");
  if (el && m) { m.textContent = msg; el.classList.add("show"); }
}

function hideSearchErr() {
  var el = document.getElementById("search-err");
  if (el) el.classList.remove("show");
}


// ════════════════════════════════════════════════════════════
// 12. TOUCHE ENTRÉE
// ════════════════════════════════════════════════════════════

document.addEventListener("keydown", function(e) {
  if (e.key !== "Enter") return;
  var path = window.location.pathname;

  if (path.includes("index.html") || path.endsWith("/")) {
    var fL = document.getElementById("form-login");
    if (fL && fL.style.display !== "none") handleLogin();
    else handleRegister();
  }

  if (path.includes("dashboard.html")) {
    var urgPage = document.getElementById("page-urgence");
    if (urgPage && urgPage.style.display !== "none" && _method !== "photo") {
      searchPerson();
    }
  }
});
