// Az admin jelszó hash-ének előállítása. Futtatás: npm run hash-password
// A jelszót nem argumentumként kéri (az bekerülne a shell előzményeibe), hanem rejtett beírással.

import readline from 'node:readline';
import { Writable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../netlify/lib/auth.mjs';

let muted = false;
const out = new Writable({
  write(chunk, encoding, cb) {
    if (!muted) process.stdout.write(chunk, encoding);
    cb();
  },
});
const rl = readline.createInterface({ input: process.stdin, output: out, terminal: true });

function ask(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    muted = true;
    rl.question('', (answer) => {
      muted = false;
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const password = await ask('Új admin jelszó (min. 12 karakter): ');
if (password.length < 12) {
  console.error('A jelszó túl rövid (min. 12 karakter).');
  rl.close();
  process.exit(1);
}
const again = await ask('Jelszó újra: ');
rl.close();
if (again !== password) {
  console.error('A két jelszó nem egyezik.');
  process.exit(1);
}

console.log('\nÁllítsd be a Netlify környezeti változói között:\n');
console.log(`ADMIN_PASSWORD_HASH=${await hashPassword(password)}`);
console.log('\nHa még nincs SESSION_SECRET, ez egy új, véletlen érték hozzá:\n');
console.log(`SESSION_SECRET=${randomBytes(48).toString('base64url')}`);
console.log('\nFigyelem: a SESSION_SECRET cseréje minden bejelentkezett felhasználót kiléptet.');
