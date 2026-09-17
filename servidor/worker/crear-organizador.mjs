#!/usr/bin/env node
/* ============================================================
   Crea (o asciende) la cuenta del organizador en D1.
   ------------------------------------------------------------
   En Workers no hay arranque donde hacerlo, así que se hace una
   vez con este comando:

       node crear-organizador.mjs <ID_FREE_FIRE> <CONTRASEÑA> [nick] [whatsapp]

   Imprime el SQL listo para pegar. Ejecútalo con:

       npx wrangler d1 execute torneos-ff --remote --command "<lo que imprime>"

   La contraseña nunca viaja: se manda ya convertida en hash,
   con el mismo método (PBKDF2, 210.000 vueltas) que usa el Worker.
   ============================================================ */

const [ffUid, pass, nick = 'ORGANIZADOR', whatsapp = '573000000000'] = process.argv.slice(2);

if (!ffUid || !pass) {
    console.error('Uso: node crear-organizador.mjs <ID_FREE_FIRE> <CONTRASEÑA> [nick] [whatsapp]');
    process.exit(1);
}
if (!/^\d{6,14}$/.test(ffUid)) { console.error('El ID de Free Fire son solo números.'); process.exit(1); }
if (pass.length < 10) { console.error('Usa una contraseña de al menos 10 caracteres: es la cuenta que maneja el dinero.'); process.exit(1); }

const enc = new TextEncoder();
const aHex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const sal = aHex(crypto.getRandomValues(new Uint8Array(16)));
const clave = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(sal), iterations: 210000, hash: 'SHA-256' }, clave, 256);
const hash = aHex(bits);
const id = 'u_' + aHex(crypto.getRandomValues(new Uint8Array(8)));
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

console.log(`
-- Pega esto en el comando de abajo.
INSERT INTO usuarios (id, ff_uid, nick, nivel, region, email, whatsapp, pass_hash, pass_sal, rol, verificado, creado)
VALUES (${q(id)}, ${q(ffUid)}, ${q(nick)}, 0, 'us', '', ${q(whatsapp)}, ${q(hash)}, ${q(sal)}, 'admin', 1, ${q(new Date().toISOString())})
ON CONFLICT(ff_uid) DO UPDATE SET rol='admin', pass_hash=excluded.pass_hash, pass_sal=excluded.pass_sal;
`);
console.log(`Ejecútalo así (todo en una línea):

  npx wrangler d1 execute torneos-ff --remote --command "INSERT INTO usuarios (id, ff_uid, nick, nivel, region, email, whatsapp, pass_hash, pass_sal, rol, verificado, creado) VALUES (${q(id)}, ${q(ffUid)}, ${q(nick)}, 0, 'us', '', ${q(whatsapp)}, ${q(hash)}, ${q(sal)}, 'admin', 1, ${q(new Date().toISOString())}) ON CONFLICT(ff_uid) DO UPDATE SET rol='admin', pass_hash=excluded.pass_hash, pass_sal=excluded.pass_sal;"
`);
