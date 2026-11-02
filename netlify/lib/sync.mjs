// A piszkozat-ág (cms-draft) lépéstartása az éles ággal (main).
//
// Ha a fejlesztő közben a main-re pusholt (pl. kódjavítás), a cms-draft lemarad: az előnézet régi kóddal
// épül, és a publikálás ütközhetne. Ezért betöltéskor és publikálás előtt:
//  - nincs lemaradás                               → nincs teendő ('none')
//  - a piszkozatnak nincs saját (nettó) változása   → az ág egyszerűen a main-re áll ('reset')
//  - van saját változása                           → a main beolvad a piszkozatba ('merged'), a változások megmaradnak
//  - a beolvasztás ütközik                         → 'conflict': nem nyúlunk semmihez, publikálni nem lehet
import { MergeConflictError } from './github.mjs';

export async function syncDraft(github) {
  const { draftBranch, mainBranch } = github.config;
  let draftSha = await github.ensureBranch(draftBranch, mainBranch);
  const mainSha = await github.getRef(mainBranch);

  const cmp = await github.compare(mainSha, draftSha);
  if (cmp.behindBy === 0) return { draftSha, mainSha, action: 'none', conflict: false };

  if (cmp.files.length === 0) {
    await github.resetBranch(draftBranch, mainSha);
    return { draftSha: mainSha, mainSha, action: 'reset', conflict: false };
  }

  try {
    const merged = await github.mergeBranch(draftBranch, mainBranch, 'CMS: az éles ág változásainak átvétele');
    if (merged) draftSha = merged;
    return { draftSha, mainSha, action: merged ? 'merged' : 'none', conflict: false };
  } catch (e) {
    if (e instanceof MergeConflictError) return { draftSha, mainSha, action: 'conflict', conflict: true };
    throw e;
  }
}
