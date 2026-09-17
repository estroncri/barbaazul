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
/* El mismo módulo que usa el servidor: si cambia cómo se guardan las
   contraseñas, esto cambia con él y no se queda a medias. */
import { hashPass, aleatorio } from './src/cripto.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const NOMBRE_BASE = 'torneos-ff';
const paso = (t) => console.log(`\n▸ ${t}`);
const comillas = (v) => "'" + String(v).replace(/'/g, "''") + "'";

function sqlUsuario({ ffUid, nick, whatsapp, hash, sal, rol }) {
    return `INSERT INTO usuarios (id, ff_uid, nick, nivel, region, email, whatsapp, pass_hash, pass_sal, rol, verificado, creado) `
        + `VALUES ('u_${aleatorio(8)}', ${comillas(ffUid)}, ${comillas(nick)}, 0, 'us', '', ${comillas(whatsapp)}, `
        + `${comillas(hash)}, ${comillas(sal)}, ${comillas(rol)}, 1, ${comillas(new Date().toISOString())}) `
        + `ON CONFLICT(ff_uid) DO UPDATE SET rol=excluded.rol, pass_hash=excluded.pass_hash, pass_sal=excluded.pass_sal;`;
}
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

/* ---- La dirección de la página ----
   Vive en wrangler.toml escrita a mano. En cuanto hay dominio propio hay que
   cambiarla en dos sitios, y si no se cambia, el navegador bloquea las
   peticiones del jugador y los pagos dejan de funcionar sin decir por qué.
   Así que se calcula desde un solo secreto, SITIO.

   Los orígenes viejos se conservan: mientras el dominio nuevo propaga, la
   dirección de siempre tiene que seguir sirviendo. */
if (process.env.SITIO) {
    const sitio = process.env.SITIO.trim().replace(/\/+$/, '');
    let origen;
    try { origen = new URL(sitio).origin; }
    catch (e) { throw new Error(`SITIO no es una dirección válida: "${sitio}"`); }

    const toml = readFileSync(rutaToml, 'utf8').split('\n').map((l) => {
        if (/^\s*ORIGENES\s*=/.test(l)) {
            const previos = (l.match(/"([^"]*)"/) || [])[1] || '';
            const todos = [...new Set([origen, ...previos.split(',').map((x) => x.trim()).filter(Boolean)])];
            return `ORIGENES = "${todos.join(',')}"`;
        }
        if (/^\s*WOMPI_REDIRECT\s*=/.test(l)) return `WOMPI_REDIRECT = "${sitio}/#/billetera"`;
        return l;
    }).join('\n');

    writeFileSync(rutaToml, toml);
    ok(`Sitio: ${sitio}`);
}

/* ---- 2. Tablas ---- */
paso('Migraciones');
const mig = wrangler(['d1', 'migrations', 'apply', NOMBRE_BASE, '--remote']);
if (!mig.ok && !/no migrations to apply/i.test(mig.salida)) {
    console.error(mig.salida);
    throw new Error('Fallaron las migraciones.');
}

/* "Aplicadas" no siempre significa "están": una migración a medias deja la
   base sin una tabla y eso no se nota hasta que alguien intenta entrar y le
   sale un error del servidor. Se comprueba aquí, que es barato, en vez de
   que lo descubra un jugador. */
const NECESARIAS = ['usuarios', 'sesiones', 'torneos', 'inscripciones',
                    'resultados', 'movimientos', 'recuperaciones',
                    'verificaciones', 'intentos'];
const tablas = wrangler(['d1', 'execute', NOMBRE_BASE, '--remote', '--json', '--command',
    "SELECT name FROM sqlite_master WHERE type = 'table'"]);
let hay = [];
try {
    const json = JSON.parse(tablas.salida.slice(tablas.salida.indexOf('[')));
    hay = (json[0]?.results || []).map((f) => f.name);
} catch (e) { /* si no se pudo leer, no se inventa nada */ }

if (hay.length) {
    const faltan = NECESARIAS.filter((t) => !hay.includes(t));
    if (faltan.length) {
        console.error(`
  A la base le faltan tablas: ${faltan.join(', ')}

  Las migraciones dijeron que estaban al día, así que alguna quedó a
  medias. Aplícalas de nuevo con:

    npx wrangler d1 migrations apply ${NOMBRE_BASE} --remote`);
        throw new Error('Faltan tablas en la base.');
    }
    ok(`Tablas al día (${hay.length})`);
} else {
    aviso('No se pudo leer la lista de tablas; se sigue igual.');
}

/* ---- 3. Secretos ---- */
paso('Secretos');

/* Las tres llaves de Wompi tienen que ser del mismo ambiente. Mezclarlas es
   el fallo más caro que hay aquí: con la llave pública de producción se
   cobra de verdad, y con el secreto de eventos de pruebas ese cobro nunca
   se acredita. El jugador paga y se queda sin saldo. Como cada valor dice
   a qué ambiente pertenece, se comprueba antes de publicar nada. */
function ambienteDe(valor) {
    const v = String(valor || '');
    if (/^pub_(test|stagtest)_/.test(v) || /^(test|stagtest)_/.test(v)) return 'pruebas';
    if (/^pub_prod_/.test(v) || /^prod_/.test(v)) return 'producción';
    return null;                              // formato que no conocemos: no opinamos
}

const ambientes = {
    WOMPI_LLAVE_PUBLICA: ambienteDe(process.env.WOMPI_LLAVE_PUBLICA),
    WOMPI_INTEGRIDAD: ambienteDe(process.env.WOMPI_INTEGRIDAD),
    WOMPI_EVENTOS: ambienteDe(process.env.WOMPI_EVENTOS)
};
const conocidos = Object.entries(ambientes).filter(([, a]) => a);
const distintos = [...new Set(conocidos.map(([, a]) => a))];

if (distintos.length > 1) {
    console.error(`
  Las llaves de Wompi son de ambientes distintos:

${conocidos.map(([n, a]) => `    ${n}: ${a}`).join('\n')}

  Así, un pago se cobraría en un ambiente y el aviso llegaría firmado con
  el secreto del otro: el jugador paga y el saldo no le entra nunca.

  Ve a Wompi, pon el interruptor de arriba en el ambiente que quieras, y
  copia las TRES de esa misma pantalla.`);
    throw new Error('Llaves de Wompi mezcladas.');
}
if (distintos.length === 1) ok(`Wompi en ${distintos[0]}`);
const SECRETOS = ['WOMPI_LLAVE_PUBLICA', 'WOMPI_INTEGRIDAD', 'WOMPI_EVENTOS',
                  'FF_PROVEEDOR', 'FF_API_URL', 'FF_API_KEY',
                  'PASS_PIMIENTA', 'PASS_VUELTAS'];
for (const nombre of SECRETOS) {
    const valor = process.env[nombre];
    if (!valor) continue;
    const r = wrangler(['secret', 'put', nombre], valor + '\n');
    // Nunca se imprime el valor, solo si entró
    r.ok ? ok(`${nombre} actualizado`) : aviso(`No se pudo guardar ${nombre}`);
}
if (process.env.PASS_PIMIENTA) {
    ok('Con pimienta: si algún día la cambias o la quitas, las contraseñas guardadas dejan de valer.');
} else {
    aviso('Sin PASS_PIMIENTA: las contraseñas se protegen solo con el cálculo. Ponla mientras no haya jugadores.');
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
    const { hash, sal } = await hashPass(process.env.ADMIN_PASS, process.env);
    const r = wrangler(['d1', 'execute', NOMBRE_BASE, '--remote', '--command',
        sqlUsuario({
            ffUid: process.env.ADMIN_FF_UID,
            nick: process.env.ADMIN_NICK || 'ORGANIZADOR',
            whatsapp: process.env.ADMIN_WHATSAPP || '573000000000',
            hash, sal, rol: 'admin'
        })]);
    r.ok ? ok('Organizador listo (su contraseña es la de ADMIN_PASS)') : aviso('No se pudo crear la cuenta de organizador');
} else {
    aviso('Sin ADMIN_FF_UID/ADMIN_PASS: la cuenta de organizador se crea aparte.');
}

/* ---- 7. Probar que de verdad se puede entrar ----
   Lo demás se comprueba mirando desde fuera, pero entrar es lo único que
   gasta CPU de verdad, y el plan gratuito corta a los 10 ms. Aquí se crea
   una cuenta de usar y tirar, se entra con ella y se borra. Si esto falla,
   el despliegue queda en rojo aunque todo lo demás esté bien. */
paso('Entrar');
{
    const ffUid = '99' + String(Date.now()).slice(-10);
    const clave = aleatorio(16);
    const { hash, sal } = await hashPass(clave, process.env);

    const creada = wrangler(['d1', 'execute', NOMBRE_BASE, '--remote', '--command',
        sqlUsuario({ ffUid, nick: 'PRUEBA-DESPLIEGUE', whatsapp: '573000000000', hash, sal, rol: 'jugador' })]);

    if (!creada.ok) {
        aviso('No se pudo crear la cuenta de prueba; no se comprobó el entrar.');
    } else {
        let estado = 0, dijo = '';
        try {
            const r = await fetch(`${url}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ usuario: ffUid, pass: clave })
            });
            estado = r.status;
            dijo = ((await r.json().catch(() => ({}))).error) || '';
        } catch (e) { dijo = e.message; }

        /* La cuenta se borra pase lo que pase: no puede quedarse viva una
           cuenta de prueba en la base de un torneo con dinero. */
        wrangler(['d1', 'execute', NOMBRE_BASE, '--remote', '--command',
            `DELETE FROM sesiones WHERE usuario_id IN (SELECT id FROM usuarios WHERE ff_uid = ${comillas(ffUid)});`
            + ` DELETE FROM usuarios WHERE ff_uid = ${comillas(ffUid)};`]);

        if (estado === 200) {
            ok('Se puede entrar con usuario y contraseña');
        } else {
            console.error(`
  El servidor publicó bien, pero NADIE PUEDE ENTRAR.
  Al intentarlo con una cuenta recién creada contestó ${estado}${dijo ? ': ' + dijo : ''}.

  Si dice "Algo falló en el servidor", casi seguro es el tope de CPU del
  plan gratuito de Cloudflare: comprobar una contraseña cuesta más de lo
  que deja. Se ajusta con el secreto PASS_VUELTAS (por defecto 20000).`);
            throw new Error('No se puede entrar.');
        }
    }
}

/* ---- 7. Lo que queda por hacer a mano ---- */
console.log(`
──────────────────────────────────────────────────────────────
  Servidor publicado${url ? ': ' + url : ''}

  Dos cosas que hay que hacer una sola vez, y no puede hacerlas
  este despliegue:

  1. En Wompi → Desarrollo → Programadores → URL de Eventos:
       ${url || 'https://tu-servidor.workers.dev'}/api/wompi/eventos

  2. En js/config.js:
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
        `2. En \`js/config.js\`: \`api: '${url}/api'\`\n`, { flag: 'a' });
}
