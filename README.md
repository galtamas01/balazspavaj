# balazspavaj

A balazspavaj.ro weboldala. Build nélküli statikus oldal (natív ES modulok és web komponensek), a repó gyökere maga a kiszolgált oldal. Hosting: Netlify.

## Admin felület (CMS) – üzemeltetés

A `/admin/` címen elérhető jelszavas felület, amellyel az ügyfél a termékeket kezelheti. A háttérben Netlify Functions fut (`netlify/functions/`), a terv a `CMS_PLAN.md`-ben van.

### Környezeti változók

Netlify: *Site configuration → Environment variables*. A titkokat soha ne tedd a repóba vagy chatbe.

| Változó | Mire kell | Honnan |
|---|---|---|
| `ADMIN_PASSWORD_HASH` | az ügyfél **kezdő** jelszavának hash-e (miután az ügyfél az adminban jelszót cserél, az új jelszó számít) | `npm run hash-password` |
| `MASTER_PASSWORD_HASH` | a te mester jelszavad hash-e: **mindig működik**, az ügyfél jelszócseréje nem érinti, és az adminból nem módosítható | `npm run hash-password -- master` |
| `SESSION_SECRET` | a munkamenet-süti aláírása (min. 32 karakter) | ugyanez a script kiír egy újat |
| `GITHUB_TOKEN` | a katalógus olvasásához és mentéséhez | GitHub fine-grained token, csak ehhez a repóhoz, *Contents: Read and write* (a *Metadata: Read* magától jön) |

### Jelszavak

- **Az ügyfél** az admin *Jelszó* menüpontjában cserélheti a jelszavát (jelenlegi + kétszer az új, min. 10 karakter). Az új jelszó csak scrypt hash-ként tárolódik a Netlify Blobs-ban (`cms-auth` / `client-password`), és onnantól ez számít; az `ADMIN_PASSWORD_HASH` csak addig, amíg még nem cserélt.
- **A mester jelszó** (`MASTER_PASSWORD_HASH`) bármikor beléptet, függetlenül az ügyfél jelszavától. Beállítása: `npm run hash-password -- master`, a kiírt sort add hozzá a Netlify környezeti változóihoz, majd *Deploys → Trigger deploy*. Cseréje ugyanígy.
- **Ha az ügyfél elfelejtette a jelszavát:** lépj be a mester jelszóval, *Jelszó* menü, a „Jelenlegi jelszó” helyére a mester jelszót írd, az újhoz pedig a számára választott új jelszót. (Az `ADMIN_PASSWORD_HASH` átírása ilyenkor már nem segít, mert a Blobs-beli jelszó az erősebb.)
- Jelszócsere után a már bejelentkezett munkamenetek legfeljebb 8 óráig érvényben maradnak (a süti lejártáig); a `SESSION_SECRET` cseréje azonnal mindenkit kiléptet.
- **Ha a mester jelszó nem működik:** `npm run check-password` megmondja, a hash és a jelszó összetartozik-e (ha nem, új hash kell). A Netlify-on a *Value* mezőben csak a `scrypt:…` rész legyen (a felesleges szóközt, idézőjelet és a `MASTER_PASSWORD_HASH=` előtagot a kód leveszi). Sikertelen belépéskor a *Logs → Functions → login* naplóban látszik, ha a változó nincs beállítva vagy hibás formátumú. A változó felvétele után a patch kódját tartalmazó új deploy kell.
- Ha a Blobs átmenetileg nem elérhető, az ügyfél nem tud belépni (különben egy régi, már lecserélt jelszó újra működne), a mester jelszó viszont ilyenkor is működik.

Opcionális felülírások (az alapértékek ehhez a repóhoz valók): `GITHUB_OWNER`, `GITHUB_REPO`, `MAIN_BRANCH` (`main`), `DRAFT_BRANCH` (`cms-draft`), `PRODUCTS_PATH`, `COLORS_PATH`, `ASSETS_DIR`, `PREVIEW_URL` (a piszkozat előnézeti címe, alapból `https://cms-draft--balazspavaj.netlify.app`; ide mutat az admin „Előnézet” hivatkozása).

A token lejár (legfeljebb 1 év): lejárata után a CMS mentése leáll, ilyenkor új tokent kell létrehozni és a Netlify-on kicserélni.

### Publikálás és a fejlesztői változtatások

Az ügyfél minden mentése a `cms-draft` ágra kerül (előnézet), a **Publikálás** gomb egyetlen összefésülő commitot hoz létre a `main` ágon (`CMS: publikálás – …`), ez egy production deployt indít. A havi számláló ezeket a commitokat számolja.

Ha te is a `main`-re pusholsz (pl. kódjavítás), a `cms-draft` lemarad. Az admin betöltésekor és publikálás előtt ezt automatikusan rendezi: ha az ügyfélnek nincs nem publikált módosítása, a `cms-draft` a `main`-re áll; ha van, a `main` változásai beolvadnak a piszkozatba. Ha **ugyanazt a sort** változtattátok a `products.json`-ban, az admin ütközést jelez, és publikálni nem enged, amíg a módosításokat el nem vetik (Elvetés gomb) vagy te össze nem fésülöd a `cms-draft` ágat. A tokennek a `main`-re is írnia kell, ezért a `main` ágon ne legyen ágvédelem (pull request kényszerítése).

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
MASTER_PASSWORD_HASH=...   # opcionális
SESSION_SECRET=...
```
