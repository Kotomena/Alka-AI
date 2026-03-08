"""
main.py — Alka AI Backend
=========================
API FastAPI pour la reconnaissance faciale.

Endpoints :
  GET  /health        → Vérifie que le backend est en ligne
  POST /detect        → Identifie une personne depuis une photo
  POST /encode        → Génère et stocke le face_encoding d'un profil

Prérequis :
  pip install fastapi uvicorn face_recognition numpy opencv-python supabase python-multipart python-dotenv

Démarrage :
  uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""

import os
import io
import json
import logging
from typing import Optional

import cv2
import numpy as np
import face_recognition
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from supabase import create_client, Client

# ── Configuration ────────────────────────────────────────────
load_dotenv()

SUPABASE_URL    = os.getenv("SUPABASE_URL")
SUPABASE_KEY    = os.getenv("SUPABASE_SERVICE_KEY")   # clé SERVICE (pas anon)
SEUIL_DISTANCE  = float(os.getenv("SEUIL_DISTANCE", "0.55"))  # seuil comparaison
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "*")   # URL de votre site

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger("alka-ai")

# ── Client Supabase ──────────────────────────────────────────
def get_supabase() -> Client:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("SUPABASE_URL et SUPABASE_SERVICE_KEY manquants dans .env")
    return create_client(SUPABASE_URL, SUPABASE_KEY)

# ── Application FastAPI ──────────────────────────────────────
app = FastAPI(title="Alka AI Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ════════════════════════════════════════════════════════════
# UTILITAIRES
# ════════════════════════════════════════════════════════════

def lire_image(data: bytes) -> np.ndarray:
    """
    Convertit des bytes en tableau numpy RGB pour face_recognition.
    OpenCV lit en BGR → on convertit en RGB.
    """
    arr = np.frombuffer(data, np.uint8)
    img_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img_bgr is None:
        raise ValueError("Image illisible ou format non supporté")
    return cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)


def encoder_visage(image_rgb: np.ndarray) -> Optional[np.ndarray]:
    """
    Détecte et encode le visage dans une image.

    Retourne :
      - ndarray de 128 dimensions si un visage est trouvé
      - None si aucun visage détecté

    On prend uniquement le PREMIER visage (le plus grand).
    """
    # Détecter les positions des visages
    locations = face_recognition.face_locations(image_rgb, model="hog")

    if not locations:
        log.info("Aucun visage détecté dans l'image")
        return None

    # Si plusieurs visages → prendre le plus grand (surface)
    if len(locations) > 1:
        def surface(loc):
            top, right, bottom, left = loc
            return (bottom - top) * (right - left)
        locations = [max(locations, key=surface)]
        log.info(f"Plusieurs visages détectés, on prend le plus grand")

    # Générer l'encodage (128 valeurs float)
    encodings = face_recognition.face_encodings(image_rgb, locations)
    if not encodings:
        return None

    return encodings[0]  # ndarray shape (128,)


def charger_encodings_base() -> list[dict]:
    """
    Charge tous les face_encoding stockés dans la table photos.
    Retourne une liste de dicts :
      [{ "user_id": int, "encoding": ndarray(128,) }, ...]

    Les lignes sans face_encoding (null) sont ignorées.
    """
    db = get_supabase()
    res = db.table("photos").select("user_id, face_encoding").execute()

    encodings = []
    for row in res.data:
        raw = row.get("face_encoding")
        if not raw:
            continue
        try:
            # face_encoding stocké en JSON : liste de 128 floats
            vec = np.array(json.loads(raw), dtype=np.float64)
            if vec.shape == (128,):
                encodings.append({"user_id": row["user_id"], "encoding": vec})
        except Exception as e:
            log.warning(f"Encoding invalide pour user_id={row['user_id']}: {e}")

    log.info(f"{len(encodings)} encoding(s) chargé(s) depuis la base")
    return encodings


def trouver_meilleure_correspondance(
    upload_encoding: np.ndarray,
    encodings_base: list[dict],
    seuil: float
) -> tuple[Optional[int], float]:
    """
    Compare l'encoding uploadé avec tous ceux de la base.

    Algorithme :
      Pour chaque visage dans la base :
        distance = numpy.linalg.norm(upload_encoding - face_encoding)
        → distance euclidienne entre les deux vecteurs de 128 dims

      On garde la distance la plus petite (best_distance).

      Si best_distance < seuil (0.55) → visage similaire → identifié
      Sinon → visage inconnu → non identifié

    Retourne : (user_id, best_distance) ou (None, best_distance)
    """
    if not encodings_base:
        log.info("Aucun encoding en base — impossible de comparer")
        return None, 999.0

    best_user_id  = None
    best_distance = 999.0

    for entry in encodings_base:
        # Distance euclidienne (même chose que face_recognition.compare_faces)
        distance = float(np.linalg.norm(upload_encoding - entry["encoding"]))
        log.debug(f"user_id={entry['user_id']} distance={distance:.4f}")

        if distance < best_distance:
            best_distance = distance
            best_user_id  = entry["user_id"]

    log.info(f"Meilleure distance : {best_distance:.4f} (seuil={seuil}) → user_id={best_user_id}")

    if best_distance < seuil:
        return best_user_id, best_distance
    else:
        return None, best_distance


def charger_profil(user_id: int) -> Optional[dict]:
    """
    Charge le profil complet d'un utilisateur depuis la table users.
    """
    db = get_supabase()
    res = db.table("users") \
        .select("id, nom, email, pays, photo, cin, adresse, contact_famille") \
        .eq("id", user_id) \
        .maybe_single() \
        .execute()
    return res.data if res.data else None


# ════════════════════════════════════════════════════════════
# ENDPOINTS
# ════════════════════════════════════════════════════════════

@app.get("/health")
def health():
    """Vérifie que le backend est en ligne (appelé par le dashboard)."""
    return {"status": "ok", "backend": "Alka AI", "seuil": SEUIL_DISTANCE}


@app.post("/detect")
async def detect(photo: UploadFile = File(...)):
    """
    Identifie une personne à partir d'une photo.

    Réponse si identifié :
      {
        "found": true,
        "confidence": 87.3,        ← (1 - distance) × 100
        "distance": 0.127,
        "user": { nom, email, pays, photo, cin, adresse, contact_famille }
      }

    Réponse si non identifié :
      {
        "found": false,
        "reason": "no_face" | "no_match" | "no_encodings",
        "confidence": 0,
        "distance": 0.72
      }
    """

    # ── 1. Lire la photo ─────────────────────────────────────
    try:
        data = await photo.read()
        image_rgb = lire_image(data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Impossible de lire l'image : {e}")

    # ── 2. Détecter et encoder le visage ─────────────────────
    upload_encoding = encoder_visage(image_rgb)

    if upload_encoding is None:
        log.info("/detect → aucun visage détecté dans la photo")
        return {
            "found":      False,
            "reason":     "no_face",
            "message":    "Aucun visage détecté dans la photo envoyée.",
            "confidence": 0,
            "distance":   0,
        }

    # ── 3. Charger les encodings depuis la base ───────────────
    try:
        encodings_base = charger_encodings_base()
    except Exception as e:
        log.error(f"Erreur chargement encodings : {e}")
        raise HTTPException(status_code=500, detail=f"Erreur base de données : {e}")

    if not encodings_base:
        log.info("/detect → aucun encoding en base")
        return {
            "found":      False,
            "reason":     "no_encodings",
            "message":    "Aucun profil avec encodage facial dans la base.",
            "confidence": 0,
            "distance":   0,
        }

    # ── 4 & 5. Comparer et trouver la meilleure correspondance ──
    best_user_id, best_distance = trouver_meilleure_correspondance(
        upload_encoding, encodings_base, SEUIL_DISTANCE
    )

    # ── 6. Distance >= seuil → non identifié ─────────────────
    if best_user_id is None:
        log.info(f"/detect → non identifié (distance={best_distance:.4f} >= seuil={SEUIL_DISTANCE})")
        return {
            "found":      False,
            "reason":     "no_match",
            "message":    "Visage non reconnu. Aucune correspondance dans la base.",
            "confidence": round(max(0, (1 - best_distance) * 100), 1),
            "distance":   round(best_distance, 4),
        }

    # ── 7. Distance < seuil → chargement du profil ───────────
    user = charger_profil(best_user_id)
    if not user:
        log.warning(f"user_id={best_user_id} trouvé en photos mais absent de users")
        return {
            "found":      False,
            "reason":     "no_match",
            "message":    "Profil introuvable.",
            "confidence": 0,
            "distance":   round(best_distance, 4),
        }

    confidence = round((1 - best_distance) * 100, 1)
    log.info(f"/detect → identifié : {user['nom']} (confiance={confidence}%, distance={best_distance:.4f})")

    return {
        "found":      True,
        "confidence": confidence,
        "distance":   round(best_distance, 4),
        "user":       user,
    }


@app.post("/encode")
async def encode_photo(photo: UploadFile = File(...), user_id: int = 0):
    """
    Génère le face_encoding d'une photo et le stocke dans la table photos.

    À appeler après chaque inscription pour préparer l'IA.
    Le user_id doit être passé en query param : POST /encode?user_id=42

    Réponse :
      { "success": true, "user_id": 42, "encoding_stored": true }
    """
    if user_id <= 0:
        raise HTTPException(status_code=400, detail="user_id requis (ex: /encode?user_id=42)")

    # Lire et encoder
    try:
        data = await photo.read()
        image_rgb = lire_image(data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Image illisible : {e}")

    encoding = encoder_visage(image_rgb)

    if encoding is None:
        raise HTTPException(status_code=422, detail="Aucun visage détecté dans la photo.")

    # Stocker en JSON dans la colonne face_encoding
    encoding_json = json.dumps(encoding.tolist())

    try:
        db = get_supabase()
        db.table("photos") \
          .update({"face_encoding": encoding_json}) \
          .eq("user_id", user_id) \
          .execute()
        log.info(f"/encode → encoding stocké pour user_id={user_id}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur stockage : {e}")

    return {"success": True, "user_id": user_id, "encoding_stored": True}
