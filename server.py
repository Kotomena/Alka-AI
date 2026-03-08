"""
=================================================================
  backend/server.py — Alka AI : Serveur de reconnaissance faciale
  
  Technologie : face_recognition (dlib) + Flask + Supabase Python
  
  Endpoints :
    GET  /health    → Vérifie que le backend est actif
    POST /detect    → Analyse une photo et retourne l'utilisateur
    POST /encode    → Encode une photo et la stocke dans Supabase
  
  Installation :
    pip install flask flask-cors face_recognition supabase Pillow requests
=================================================================
"""

import os
import io
import base64
import json
import logging
import numpy as np
from pathlib import Path

from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image

# ── Chargement optionnel de face_recognition ────────────────
try:
    import face_recognition
    FACE_RECOGNITION_AVAILABLE = True
    print("[AI] face_recognition chargé ✓")
except ImportError:
    FACE_RECOGNITION_AVAILABLE = False
    print("[AI] face_recognition non disponible — mode dégradé")

# ── Supabase client ──────────────────────────────────────────
try:
    from supabase import create_client, Client
    SUPABASE_URL  = os.environ.get("SUPABASE_URL",  "https://nkntvuigcrjaegfpweew.supabase.co")
    SUPABASE_KEY  = os.environ.get("SUPABASE_KEY",  "sb_publishable_iIPD4GC1EZDwA3HjIGi9ZQ_VS7cOjwE")
    sb: Client    = create_client(SUPABASE_URL, SUPABASE_KEY)
    print("[DB] Supabase client connecté ✓")
except Exception as e:
    print(f"[DB] Erreur Supabase: {e}")
    sb = None

# ── Configuration Flask ──────────────────────────────────────
app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})  # Adapter en prod

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ── Cache des encodages en mémoire ──────────────────────────
# Format: [{ "user_id": int, "user": {...}, "encoding": np.array }]
face_cache = []
cache_loaded = False


# ================================================================
#  ROUTE : Santé du serveur
# ================================================================
@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status":    "ok",
        "face_recognition": FACE_RECOGNITION_AVAILABLE,
        "supabase":  sb is not None,
        "cache_size": len(face_cache),
        "mode": "real" if FACE_RECOGNITION_AVAILABLE else "simulation",
    })


# ================================================================
#  ROUTE : Détection faciale principale
# ================================================================
@app.route("/detect", methods=["POST"])
def detect():
    """
    Reçoit une image (multipart/form-data, champ 'photo'),
    compare avec les encodages en base, retourne l'utilisateur trouvé.
    """
    if "photo" not in request.files:
        return jsonify({"error": "Champ 'photo' manquant"}), 400

    file = request.files["photo"]
    
    # Vérification du type de fichier
    allowed = {"image/jpeg", "image/jpg", "image/png", "image/webp"}
    if file.content_type not in allowed:
        return jsonify({"error": "Format non supporté. Utilisez JPG, PNG ou WEBP."}), 400

    try:
        # Lire et convertir l'image
        img_bytes = file.read()
        image = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        img_array = np.array(image)

        logger.info(f"Image reçue: {image.size}, {len(img_bytes)/1024:.1f} Ko")

        if FACE_RECOGNITION_AVAILABLE:
            return detect_real(img_array)
        else:
            return detect_simulation()

    except Exception as e:
        logger.error(f"Erreur detect: {e}", exc_info=True)
        return jsonify({"error": f"Erreur de traitement: {str(e)}"}), 500


def detect_real(img_array):
    """Reconnaissance faciale réelle avec face_recognition."""
    global cache_loaded, face_cache

    # Charger les encodages depuis Supabase si pas encore fait
    if not cache_loaded:
        load_face_cache()
        cache_loaded = True

    # Détecter les visages dans l'image uploadée
    face_locations = face_recognition.face_locations(img_array, model="hog")
    
    if not face_locations:
        logger.info("Aucun visage détecté dans l'image")
        return jsonify({
            "found": False,
            "user": None,
            "confidence": 0,
            "mode": "face_recognition",
            "message": "Aucun visage détecté dans l'image",
        })

    # Encoder le/les visages détectés
    face_encodings = face_recognition.face_encodings(img_array, face_locations)
    
    if not face_encodings:
        return jsonify({"found": False, "user": None, "confidence": 0, "mode": "face_recognition"})

    query_encoding = face_encodings[0]  # Premier visage détecté
    logger.info(f"{len(face_locations)} visage(s) détecté(s)")

    if not face_cache:
        logger.warning("Cache vide — aucun encodage en base")
        return jsonify({
            "found": False,
            "user": None,
            "confidence": 0,
            "mode": "face_recognition",
            "message": "Base d'encodages vide. Ajoutez des photos via /encode.",
        })

    # Comparaison avec tous les encodages du cache
    best_match   = None
    best_distance = 1.0  # Distance maximale
    THRESHOLD    = 0.55  # Seuil de similarité (plus bas = plus strict)

    for entry in face_cache:
        known_enc = entry["encoding"]
        distance  = face_recognition.face_distance([known_enc], query_encoding)[0]
        
        if distance < best_distance:
            best_distance = distance
            best_match    = entry

    if best_match and best_distance <= THRESHOLD:
        # Convertir la distance en pourcentage de confiance
        confidence = round((1 - best_distance) * 100, 1)
        logger.info(f"Match trouvé: {best_match['user']['nom']} (dist={best_distance:.3f}, conf={confidence}%)")
        
        return jsonify({
            "found":      True,
            "user":       best_match["user"],
            "confidence": confidence,
            "distance":   round(float(best_distance), 4),
            "mode":       "face_recognition",
        })
    else:
        logger.info(f"Aucun match (meilleure distance: {best_distance:.3f})")
        return jsonify({
            "found":      False,
            "user":       None,
            "confidence": round((1 - best_distance) * 100, 1),
            "mode":       "face_recognition",
            "message":    "Aucun utilisateur correspondant trouvé.",
        })


def detect_simulation():
    """Simulation quand face_recognition n'est pas installé."""
    import random
    if not sb:
        return jsonify({"error": "Supabase non connecté"}), 500

    users = sb.table("users").select("id, nom, email, pays, photo").execute()
    if not users.data:
        return jsonify({"found": False, "user": None, "confidence": 0, "mode": "simulation"})

    user       = random.choice(users.data)
    confidence = random.randint(72, 95)

    return jsonify({
        "found":      True,
        "user":       user,
        "confidence": confidence,
        "mode":       "simulation",
    })


# ================================================================
#  ROUTE : Encoder et stocker une photo
# ================================================================
@app.route("/encode", methods=["POST"])
def encode_photo():
    """
    Encode une photo de profil et l'enregistre dans la table "photos".
    Corps JSON attendu: { "user_id": int, "photo_base64": "data:image/..." }
    ou multipart avec champ "photo" + "user_id"
    """
    if not FACE_RECOGNITION_AVAILABLE:
        return jsonify({"error": "face_recognition non disponible"}), 501
    if not sb:
        return jsonify({"error": "Supabase non connecté"}), 500

    # Accepter JSON ou multipart
    if request.is_json:
        data      = request.get_json()
        user_id   = data.get("user_id")
        b64_data  = data.get("photo_base64", "")
        # Supprimer le préfixe data:image/...;base64,
        if "," in b64_data:
            b64_data = b64_data.split(",")[1]
        img_bytes = base64.b64decode(b64_data)
    else:
        user_id   = request.form.get("user_id")
        img_bytes = request.files["photo"].read()

    if not user_id:
        return jsonify({"error": "user_id manquant"}), 400

    try:
        image     = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        img_array = np.array(image)

        # Détecter et encoder le visage
        locations  = face_recognition.face_locations(img_array)
        if not locations:
            return jsonify({"error": "Aucun visage détecté dans la photo"}), 422

        encoding   = face_recognition.face_encodings(img_array, locations)[0]
        enc_list   = encoding.tolist()  # np.array → liste Python

        # Stocker dans Supabase (table "photos")
        # Créez cette table : id, user_id, encoding (jsonb), created_at
        result = sb.table("photos").upsert({
            "user_id":  int(user_id),
            "encoding": enc_list,
        }, on_conflict="user_id").execute()

        # Invalider le cache local
        global cache_loaded
        cache_loaded = False

        logger.info(f"Encodage stocké pour user_id={user_id}")
        return jsonify({"success": True, "user_id": user_id, "faces_found": len(locations)})

    except Exception as e:
        logger.error(f"Erreur encode: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


# ================================================================
#  Chargement du cache d'encodages depuis Supabase
# ================================================================
def load_face_cache():
    """
    Charge tous les encodages faciaux depuis la table "photos"
    et met en cache les profils correspondants.
    """
    global face_cache
    
    if not sb:
        logger.warning("Supabase non disponible — cache vide")
        return

    try:
        # Jointure : photos + users
        photos = sb.table("photos").select(
            "user_id, encoding, users(id, nom, email, pays, photo)"
        ).execute()

        face_cache = []
        for row in (photos.data or []):
            enc = row.get("encoding")
            if enc is None:
                continue
            
            # Convertir de liste JSON → np.array
            enc_array = np.array(enc, dtype=np.float64)
            user_data = row.get("users") or {}
            
            face_cache.append({
                "user_id":  row["user_id"],
                "user":     user_data,
                "encoding": enc_array,
            })

        logger.info(f"Cache chargé: {len(face_cache)} encodage(s)")

    except Exception as e:
        logger.error(f"Erreur chargement cache: {e}", exc_info=True)
        face_cache = []


# ================================================================
#  Point d'entrée
# ================================================================
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("DEBUG", "false").lower() == "true"
    
    print(f"""
╔══════════════════════════════════════════╗
║         Alka AI — Backend Python         ║
║  face_recognition : {'✓ OK' if FACE_RECOGNITION_AVAILABLE else '✗ Non installé'}              ║
║  Supabase         : {'✓ OK' if sb else '✗ Non connecté'}              ║
║  Port             : {port}                         ║
╚══════════════════════════════════════════╝
    """)
    
    app.run(host="0.0.0.0", port=port, debug=debug)
