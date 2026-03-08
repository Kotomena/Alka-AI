# Alka AI — Guide Backend

## Installation

### 1. Prérequis système

```bash
# Ubuntu / Debian
sudo apt-get install -y cmake libboost-all-dev libgtk2.0-dev

# macOS
brew install cmake boost
```

### 2. Installer les dépendances Python

```bash
cd alka-backend
pip install -r requirements.txt
```

### 3. Configurer les variables d'environnement

```bash
cp .env.example .env
# Ouvrir .env et remplir SUPABASE_URL et SUPABASE_SERVICE_KEY
```

### 4. Démarrer le backend

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Le backend écoute sur `http://localhost:8000`

---

## Endpoints

### GET /health
Vérifie que le backend est en ligne.
```
Réponse : { "status": "ok", "backend": "Alka AI", "seuil": 0.55 }
```

### POST /detect
Identifie une personne depuis une photo.

```bash
curl -X POST http://localhost:8000/detect \
  -F "photo=@visage.jpg"
```

Réponse identifié :
```json
{
  "found": true,
  "confidence": 87.3,
  "distance": 0.127,
  "user": {
    "id": 5,
    "nom": "Jean Rakoto",
    "email": "jean@test.mg",
    "pays": "Madagascar",
    "photo": "https://...",
    "cin": "101234567890",
    "adresse": "Antananarivo",
    "contact_famille": "Marie - +261340000000"
  }
}
```

Réponse non identifié :
```json
{
  "found": false,
  "reason": "no_match",
  "message": "Visage non reconnu. Aucune correspondance dans la base.",
  "confidence": 23.4,
  "distance": 0.766
}
```

Codes `reason` :
| Code | Signification |
|---|---|
| `no_face` | Aucun visage détecté dans la photo |
| `no_match` | Visage détecté mais distance >= seuil |
| `no_encodings` | Aucun profil avec face_encoding en base |

### POST /encode?user_id=42
Génère et stocke le face_encoding d'un utilisateur.
À appeler après chaque inscription.

```bash
curl -X POST "http://localhost:8000/encode?user_id=42" \
  -F "photo=@profil.jpg"
```

---

## Structure de la base de données

### Table `photos`
La colonne `face_encoding` doit exister et accepter du texte (JSON).

```sql
-- Ajouter la colonne si elle n'existe pas encore
ALTER TABLE public.photos
  ADD COLUMN IF NOT EXISTS face_encoding TEXT;
```

### Générer les encodings des profils existants
Pour encoder tous les profils déjà inscrits, utilisez le script batch :

```bash
python encode_all.py
```

---

## Schéma de fonctionnement

```
Photo envoyée par l'utilisateur
         │
         ▼
    [FastAPI /detect]
         │
         ├─ OpenCV → lecture image RGB
         │
         ├─ face_recognition → détecter visage
         │      └─ Aucun visage → { found: false, reason: "no_face" }
         │
         ├─ face_recognition → générer encoding (128 dims)
         │
         ├─ Supabase → charger tous les face_encoding de la table photos
         │
         ├─ numpy.linalg.norm → distance euclidienne avec chaque encoding
         │      └─ Garder la distance la plus petite (best_distance)
         │
         ├─ best_distance < 0.55 ?
         │      ├─ OUI → Supabase → charger profil → { found: true, user: {...} }
         │      └─ NON → { found: false, reason: "no_match" }
         │
         ▼
   Réponse JSON au frontend
```

---

## Réglage du seuil

Le seuil `SEUIL_DISTANCE` dans le `.env` contrôle la sensibilité :

| Seuil | Comportement |
|---|---|
| `0.45` | Très strict — peu de faux positifs, peut manquer des vrais |
| `0.55` | **Recommandé** — bon équilibre précision/rappel |
| `0.60` | Souple — plus de matches, plus de faux positifs |
| `0.70` | Trop permissif — à éviter |

---

## Déploiement production

```bash
# Avec gunicorn
pip install gunicorn
gunicorn main:app -w 4 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000

# Ou avec Docker
docker build -t alka-backend .
docker run -p 8000:8000 --env-file .env alka-backend
```
