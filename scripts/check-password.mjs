// Annak ellenőrzése, hogy egy jelszó egyezik-e egy hash-sel (pl. mielőtt a hash-t a Netlify-ra teszed).
// Futtatás:  npm run check-password
// Kéri a hash-t (a kiírt sorból a `scrypt:…` rész vagy a teljes sor is jó) és a jelszót (rejtetten).
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { verifyPassword } from '../netlify/lib/auth.mjs';
import { cleanHash, isHashFormat } from '../netlify/lib/credentials.mjs';

let muted = false;
const out = new Writable({
  write(chunk, encoding, cb) {
    if (!muted) process.stdout.write(chunk, encoding);
    cb();
  },
});
const rl = readline.createInterface({ input: process.stdin, output: out, terminal: true });
const ask = (question, hidden) =>
  new Promise((resolve) => {
    process.stdout.write(question);
    muted = hidden;
    rl.question('', (answer) => {
      muted = false;
      process.stdout.write('\n');
      resolve(answer);
    });
  });

const raw = await ask('Hash (scrypt:… vagy a teljes MASTER_PASSWORD_HASH=… sor): ', false);
const hash = cleanHash(cleanHash(raw, 'MASTER_PASSWORD_HASH'), 'ADMIN_PASSWORD_HASH');
const password = await ask('Jelszó: ', true);
rl.close();

if (!isHashFormat(hash)) {
  console.error('A hash formátuma hibás: scrypt:<só>:<hash> alakú kell legyen. Nem teljes a másolás?');
  process.exit(1);
}
if (await verifyPassword(password, hash)) {
  console.log('Egyezik: ez a hash ehhez a jelszóhoz tartozik.');
} else {
  console.error('NEM egyezik: a jelszó nem ehhez a hash-hez tartozik (elírás, más jelszó, vagy más billentyűzetkiosztás).');
  process.exit(1);
}
