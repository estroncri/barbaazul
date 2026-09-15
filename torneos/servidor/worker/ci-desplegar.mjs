#!/usr/bin/env node
/* ============================================================
   Torneos FF — Despliegue automático
   ------------------------------------------------------------
   Lo ejecuta GitHub Actions, no tú. Hace lo mismo que
   instalar.mjs pero sin preguntar nada: toma todo de las
   variables de entorno que GitHub le pasa desde tus Secrets.

   Los secretos nunca pasan por el repositorio ni por el chat:
   van de GitHub a Cloudflare directamente.
   ============================================================ */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const NOMBRE_BASE = 'torneos-ff';
const paso = (t) => console.log(`\n▸ ${t}`);
const ok = (t) => console.log(`  ✔ ${t}`);
const aviso = (t) => console.log(`  ! ${t}`);

function wrangler(args, entrada) {
    const r = spawnSync('npx', ['wrangler', ...args], {
        cwd: AQUI, encoding: 'utf8', input: entrada,
        env: process.env
    });
    const salida = (r.stdout || '') + (r.stderr || '');
    return { ok: r.status === 0, salida };
}

/* Cloudflare contesta aquí lo que wrangler no sabe preguntar. */
const CF = 'https://api.cloudflare.com/client/v4';

async function cf(ruta, opciones = {}) {
    const r = await fetch(CF + ruta, {
        ...opciones,
        headers: {
            authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
            'content-type': 'application/json'
        }
    });
    let json = null;
    try { json = await r.json(); } catch (e) { /* respuesta vacía */ }
    return { estado: r.status, json };
}

const porqué = (json) => (json?.errors || []).map((e) => e.message).join('; ');

async function idCuenta() {
    if (process.env.CLOUDFLARE_ACCOUNT_ID) return process.env.CLOUDFLARE_ACCOUNT_ID;
    const { json } = await cf('/accounts');
    return json?.result?.[0]?.id || '';
}

/* El nombre va en una dirección de internet: solo minúsculas, números y guiones. */
const comoNombre = (s) => String(s).toLowerCase()
    .replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 63);

/* Una cuenta nueva de Cloudflare no tiene dirección pública hasta que se elige
   un nombre, y sin ella no hay dónde publicar. Se elige una sola vez. */
async function asegurarSubdominio(cuenta) {
    const { json } = await cf(`/accounts/${cuenta}/workers/subdomain`);
    const ya = json?.result?.subdomain;
    if (ya) { ok(`Ya la tenías: ${ya}.workers.dev`); return ya; }

    const dueño = (process.env.GITHUB_REPOSITORY || '').split('/')[0];
    const azar = () => Math.random().toString(36).slice(2, 6);
    const candidatos = [process.env.SUBDOMINIO, dueño, `torneos-ff-${dueño}`,
                        `torneos-ff-${azar()}`, `torneos-${azar()}${azar()}`]
        .filter(Boolean).map(comoNombre).filter((n) => n.length >= 3);

    for (const nombre of candidatos) {
        const r = await cf(`/accounts/${cuenta}/workers/subdomain`,
            { method: 'PUT', body: JSON.stringify({ subdomain: nombre }) });
        if (r.json?.success) { ok(`Registrada: ${nombre}.workers.dev`); return nombre; }
        aviso(`${nombre} no sirvió: ${porqué(r.json) || 'ocupado'}`);
    }
    return '';
}

/* ---- 1. La base de datos ---- */
paso('Base de datos D1');
let idBase = null;

const lista = wrangler(['d1', 'list', '--json']);
if (lista.ok) {
    try {
        const json = JSON.parse(lista.salida.slice(lista.salida.indexOf('[')));
        const ya = json.find((b) => b.name === NOMBRE_BASE);
        if (ya) { idBase = ya.uuid || ya.database_id; ok(`Ya existía: ${idBase}`); }
    } catch (e) { /* se crea abajo */ }
}

if (!idBase) {
    const creada = wrangler(['d1', 'create', NOMBRE_BASE]);
    const m = creada.salida.match(/database_id\s*=\s*"([^"]+)"/) || creada.salida.match(/"uuid":\s*"([^"]+)"/);
    if (!m) { console.error(creada.salida); throw new Error('No se pudo crear la base de datos.'); }
    idBase = m[1];
    ok(`Creada: ${idBase}`);
}

/* El id se escribe solo para este despliegue: no se guarda en el repositorio,
   así el archivo de configuración no lleva datos de la cuenta. */
const rutaToml = join(AQUI, 'wrangler.toml');
const toml = readFileSync(rutaToml, 'utf8')
    .split('\n')
    .map((l) => (/^\s*database_id\s*=/.test(l) ? `database_id = "${idBase}"` : l))
    .join('\n');
writeFileSync(rutaToml, toml);
ok('Configuración lista');

/* ---- 2. Tablas ---- */
paso('Migraciones');
const mig = wrangler(['d1', 'migrations', 'apply', NOMBRE_BASE, '--remote']);
if (!mig.ok && !/no migrations to apply/i.test(mig.salida)) {
    console.error(mig.salida);
    throw new Error('Fallaron las migraciones.');
}
ok('Tablas al día');

/* ---- 3. Secretos ---- */
paso('Secretos');
const SECRETOS = ['WOMPI_LLAVE_PUBLICA', 'WOMPI_INTEGRIDAD', 'WOMPI_EVENTOS',
                  'FF_PROVEEDOR', 'FF_API_URL', 'FF_API_KEY'];
for (const nombre of SECRETOS) {
    const valor = process.env[nombre];
    if (!valor) continue;
    const r = wrangler(['secret', 'put', nombre], valor + '\n');
    // Nunca se imprime el valor, solo si entró
    r.ok ? ok(`${nombre} actualizado`) : aviso(`No se pudo guardar ${nombre}`);
}
if (!process.env.WOMPI_INTEGRIDAD) aviso('Sin Wompi: las recargas quedan en modo manual.');
if (!process.env.FF_PROVEEDOR && !process.env.FF_API_URL) aviso('Sin servicio de perfiles: el nick se escribe a mano.');

/* ---- 4. La dirección pública ---- */
paso('Dirección pública');
const cuenta = await idCuenta();
if (!cuenta) throw new Error('El token no deja ver la cuenta: revisa CLOUDFLARE_ACCOUNT_ID.');
const sub = await asegurarSubdominio(cuenta);
if (!sub) {
    console.error(`
  Cloudflare no dejó registrar la dirección desde aquí. Es cosa de un
  minuto y se hace una sola vez:

    1. Entra a https://dash.cloudflare.com → Compute (Workers)
    2. Te pide elegir un nombre (queda como algo.workers.dev)
    3. Vuelve a Actions y lanza este despliegue otra vez

  Si el nombre que quieres ya está ocupado, guárdalo como el secreto
  SUBDOMINIO y este despliegue lo usa.`);
    throw new Error('Falta la dirección workers.dev.');
}

/* ---- 5. Publicar ---- */
paso('Publicando');
const desp = wrangler(['deploy']);
if (!desp.ok) { console.error(desp.salida); throw new Error('Falló el despliegue.'); }
const url = (desp.salida.match(/https:\/\/[^\s]+\.workers\.dev/) || [])[0]
    || `https://${NOMBRE_BASE}.${sub}.workers.dev`;
ok(`En línea: ${url}`);

/* ---- 6. Cuenta de organizador ---- */
if (process.env.ADMIN_FF_UID && process.env.ADMIN_PASS) {
    paso('Cuenta de organizador');
    const enc = new TextEncoder();
    const aHex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
    const sal = aHex(crypto.getRandomValues(new Uint8Array(16)));
    const clave = await crypto.subtle.importKey('raw', enc.encode(process.env.ADMIN_PASS), 'PBKDF2', false, ['deriveBits']);
    const hash = aHex(await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: enc.encode(sal), iterations: 210000, hash: 'SHA-256' }, clave, 256));
    const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

    const sql = `INSERT INTO usuarios (id, ff_uid, nick, nivel, region, email, whatsapp, pass_hash, pass_sal, rol, verificado, creado) `
        + `VALUES ('u_${aHex(crypto.getRandomValues(new Uint8Array(8)))}', ${q(process.env.ADMIN_FF_UID)}, `
        + `${q(process.env.ADMIN_NICK || 'ORGANIZADOR')}, 0, 'us', '', ${q(process.env.ADMIN_WHATSAPP || '573000000000')}, `
        + `${q(hash)}, ${q(sal)}, 'admin', 1, ${q(new Date().toISOString())}) `
        + `ON CONFLICT(ff_uid) DO UPDATE SET rol='admin', pass_hash=excluded.pass_hash, pass_sal=excluded.pass_sal;`;

    const r = wrangler(['d1', 'execute', NOMBRE_BASE, '--remote', '--command', sql]);
    r.ok ? ok('Organizador listo (su contraseña es la de ADMIN_PASS)') : aviso('No se pudo crear la cuenta de organizador');
} else {
    aviso('Sin ADMIN_FF_UID/ADMIN_PASS: la cuenta de organizador se crea aparte.');
}

/* ---- 7. Lo que queda por hacer a mano ---- */
console.log(`
──────────────────────────────────────────────────────────────
  Servidor publicado${url ? ': ' + url : ''}

  Dos cosas que hay que hacer una sola vez, y no puede hacerlas
  este despliegue:

  1. En Wompi → Desarrollo → Programadores → URL de Eventos:
       ${url || 'https://tu-servidor.workers.dev'}/api/wompi/eventos

  2. En torneos/js/config.js:
       api: '${url || 'https://tu-servidor.workers.dev'}/api'
     y subirlo, para que la página use este servidor.
──────────────────────────────────────────────────────────────
`);

/* El paso siguiente del despliegue la usa para comprobar el servidor. */
if (process.env.GITHUB_ENV) writeFileSync(process.env.GITHUB_ENV, `SERVIDOR=${url}\n`, { flag: 'a' });

if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY,
        `## Torneos FF desplegado\n\n**Servidor:** ${url || '(sin URL)'}\n\n` +
        `### Falta hacer una vez\n\n` +
        `1. En Wompi, URL de Eventos: \`${url}/api/wompi/eventos\`\n` +
        `2. En \`torneos/js/config.js\`: \`api: '${url}/api'\`\n`, { flag: 'a' });
}
