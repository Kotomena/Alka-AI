"""
encode_all.py — Alka AI
========================
Script utilitaire pour générer les face_encoding
de tous les utilisateurs déjà inscrits dans la base.

À exécuter une seule fois après avoir mis en place le backend.

Usage :
  python encode_all.py
"""

import os
import io
import json
import urllib.request

import numpy as np
import face_recognition
import cv2
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

def telecharger_image(url: str) -> np.ndarray:
    """Télécharge une image depuis une URL et la retourne en RGB."""
    req = urllib.request.Request(url, headers={"User-Agent": "AlkaAI/1.0"})
    with urllib.request.urlopen(req, timeout=10) as r:
        data = r.read()
    arr     = np.frombuffer(data, np.uint8)
    img_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img_bgr is None:
        raise ValueError(f"Image illisible : {url}")
    return cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

def encoder(image_rgb: np.ndarray):
    locations = face_recognition.face_locations(image_rgb, model="hog")
    if not locations:
        return None
    encodings = face_recognition.face_encodings(image_rgb, locations[:1])
    return encodings[0] if encodings else None

def main():
    db = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Charger tous les profils de la table photos qui n'ont pas encore d'encoding
    res = db.table("photos") \
        .select("id, user_id, photo_url, face_encoding") \
        .is_("face_encoding", "null") \
        .execute()

    photos = res.data or []
    print(f"\n{len(photos)} profil(s) sans encoding à traiter\n")

    ok  = 0
    err = 0

    for row in photos:
        user_id   = row["user_id"]
        photo_url = row["photo_url"]
        print(f"  → user_id={user_id}  {photo_url[:60]}...")

        try:
            img      = telecharger_image(photo_url)
            encoding = encoder(img)

            if encoding is None:
                print(f"     ⚠ Aucun visage détecté, ignoré")
                err += 1
                continue

            encoding_json = json.dumps(encoding.tolist())
            db.table("photos") \
              .update({"face_encoding": encoding_json}) \
              .eq("user_id", user_id) \
              .execute()

            print(f"     ✓ Encoding stocké ({len(encoding)} dims)")
            ok += 1

        except Exception as e:
            print(f"     ✗ Erreur : {e}")
            err += 1

    print(f"\nTerminé : {ok} succès / {err} erreur(s)\n")

if __name__ == "__main__":
    main()
