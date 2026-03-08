// ============================================================
//  config.js — Alka AI
//  Configuration Supabase
//
//  ⚠️  REMPLACEZ les deux valeurs ci-dessous par celles de
//      votre projet Supabase :
//      Dashboard → Settings → API
// ============================================================

const SUPABASE_CONFIG = {

  // URL du projet  (ex : https://xxxxxxxxxxxx.supabase.co)
  url: "https://nkntvuigcrjaegfpweew.supabase.co",

  // Clé publique anonyme (anon / public key)
  anonKey: "sb_publishable_iIPD4GC1EZDwA3HjIGi9ZQ_VS7cOjwE",

  // URL du backend Python pour la reconnaissance faciale (optionnel)
  // Laissez tel quel si vous n'utilisez pas encore le backend AI
  backendUrl: "http://localhost:5000",

};

// Expose la config globalement
window.SUPABASE_CONFIG = SUPABASE_CONFIG;
