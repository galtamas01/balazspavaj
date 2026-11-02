# balazspavaj

A balazspavaj.ro weboldala. Build nélküli statikus oldal (natív ES modulok és web komponensek), a repó gyökere maga a kiszolgált oldal. Hosting: Netlify.

## Admin felület (CMS) – üzemeltetés

A `/admin/` címen elérhető jelszavas felület, amellyel az ügyfél a termékeket kezelheti. A háttérben Netlify Functions fut (`netlify/functions/`), a terv a `CMS_PLAN.md`-ben van.

### Környezeti változók

Netlify: *Site configuration → Environment variables*. A titkokat soha ne tedd a repóba vagy chatbe.

| Változó | Mire kell | Honnan |
|---|---|---|
| `ADMIN_PASSWORD_HASH` | az admin jelszó hash-e | `npm run hash-password` |
| `SESSION_SECRET` | a munkamenet-süti aláírása (min. 32 karakter) | ugyanez a script kiír egy újat |
| `GITHUB_TOKEN` | a katalógus olvasásához és mentéséhez | GitHub fine-grained token, csak ehhez a repóhoz, *Contents: Read and write* (a *Metadata: Read* magától jön) |

Jelszócsere: `npm run hash-password`, majd az új `ADMIN_PASSWORD_HASH` beírása a Netlify-on és egy új deploy (*Deploys → Trigger deploy*). A `SESSION_SECRET` cseréje minden bejelentkezett felhasználót kiléptet.

Opcionális felülírások (az alapértékek ehhez a repóhoz valók): `GITHUB_OWNER`, `GITHUB_REPO`, `MAIN_BRANCH` (`main`), `DRAFT_BRANCH` (`cms-draft`), `PRODUCTS_PATH`, `COLORS_PATH`, `ASSETS_DIR`, `PREVIEW_URL` (a piszkozat előnézeti címe, alapból `https://cms-draft--balazspavaj.netlify.app`; ide mutat az admin „Előnézet” hivatkozása).

A token lejár (legfeljebb 1 év): lejárata után a CMS mentése leáll, ilyenkor új tokent kell létrehozni és a Netlify-on kicserélni.

### Netlify beállítások

- *Build command* és *Publish directory*: üresen hagyhatók, a `netlify.toml` beállítja (nincs build lépés, `publish = "."`).
- *Branch deploys*: *Site configuration → Build & deploy → Branches and deploy contexts → Let me add individual branches* → `cms-draft`. A branch deploy ingyenes, a production deploy 15 kreditbe kerül (a Free csomag 300 kredit/hó).

### Fejlesztés helyben

```bash
npm install
npx netlify-cli dev      # statikus oldal + /api/* functionök, a titkok a .env fájlból
npm test                 # egységtesztek
```

`.env` (gitignore-olva):

```
ADMIN_PASSWORD_HASH=...
SESSION_SECRET=...
```
