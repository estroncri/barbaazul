#!/usr/bin/env node
/* ============================================================
   Torneos FF — Instalador
   ------------------------------------------------------------
   Hace todo el despliegue en Cloudflare de una sentada:

       cd torneos/servidor/worker
       npm install
       node instalar.mjs

   Va preguntando lo que necesita y se encarga del resto: crear
   la base de datos, poner las tablas, guardar los secretos,
   publicar el servidor, crear tu cuenta de organizador y dejar
   la página apuntando a la dirección nueva.

   Con --simular no toca nada: solo enseña lo que haría.
   ============================================================ */

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

/* Reemplaza el VALOR de una clave en un archivo, saltándose los comentarios.

   Suena tonto hacerlo línea por línea, pero una expresión regular sobre
   todo el texto le pega al comentario que explica la opción en vez de a la
   opción. Pasó dos veces en las pruebas: el instalador decía "listo" y la
   página seguía en modo local, porque lo que había cambiado era el ejemplo
   escrito dentro de un comentario de bloque. De ahí que haya que llevar la
   cuenta de dónde empieza y dónde termina cada comentario. */
function cambiarValor(texto, clave, nuevaLinea) {
    const lineas = texto.split('\n');
    const patron = new RegExp('^' + clave + '\\s*[:=]');
    let dentroDeBloque = false;
    let objetivo = -1;

    for (let i = 0; i < lineas.length; i++) {
        const limpia = lineas[i].trim();

        if (dentroDeBloque) {
            if (limpia.includes('*/')) dentroDeBloque = false;
            continue;                                  // todo esto es comentario
        }
        if (limpia.startsWith('/*') && !limpia.includes('*/')) { dentroDeBloque = true; continue; }
        if (limpia.startsWith('//') || limpia.startsWith('#') || limpia.startsWith('*')) continue;

        if (patron.test(limpia)) { objetivo = i; break; }
    }

    if (objetivo === -1) return { texto, cambiado: false };
    const sangria = lineas[objetivo].match(/^\s*/)[0];
    lineas[objetivo] = sangria + nuevaLinea;
    return { texto: lineas.join('\n'), cambiado: true };
}

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '../../..');              // la carpeta del repositorio
const CONFIG_WEB = join(RAIZ, 'torneos/js/config.js');
const WRANGLER_TOML = join(AQUI, 'wrangler.toml');
const SIMULAR = process.argv.includes('--simular');

const c = {
    titulo: (t) => console.log(`\n\x1b[1m\x1b[38;5;208m${t}\x1b[0m`),
    ok: (t) => console.log(`  \x1b[32m✔\x1b[0m ${t}`),
    info: (t) => console.log(`    ${t}`),
    aviso: (t) => console.log(`  \x1b[33m!\x1b[0m ${t}`),
    error: (t) => console.log(`  \x1b[31m✘\x1b[0m ${t}`)
};

/* Este instalador pregunta cosas: necesita una consola de verdad.
   Si se le manda la entrada por tubería, readline se queda a medias y el
   proceso muere en silencio, que es la peor forma de fallar. */
if (!process.stdin.isTTY && !process.argv.includes('--sin-tty')) {
    console.error(`
  Este instalador hay que correrlo en una consola normal, escribiendo tú
  las respuestas. Ábrelo así:

      cd torneos/servidor/worker
      node instalar.mjs
`);
    process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const preguntar = async (texto, pordefecto) => {
    const r = (await rl.question(`  ${texto}${pordefecto ? ` [${pordefecto}]` : ''}: `)).trim();
    return r || pordefecto || '';
};

/* Ejecuta wrangler y devuelve su salida */
function correr(args, opciones = {}) {
    if (SIMULAR) {
        c.info(`(simulado) npx wrangler ${args.join(' ')}`);
        return { ok: true, salida: '' };
    }
    const r = spawnSync('npx', ['wrangler', ...args], {
        cwd: AQUI,
        encoding: 'utf8',
        stdio: opciones.interactivo ? 'inherit' : ['pipe', 'pipe', 'pipe'],
        input: opciones.entrada
    });
    const salida = (r.stdout || '') + (r.stderr || '');
    return { ok: r.status === 0, salida };
}

/* wrangler pide cosas por navegador: eso va con la consola abierta */
const correrInteractivo = (args) => correr(args, { interactivo: true });

async function main() {
    console.log(`
  ╔══════════════════════════════════════════════════╗
  ║   TORNEOS FF — instalación en Cloudflare         ║
  ╚══════════════════════════════════════════════════╝
${SIMULAR ? '\n  MODO SIMULACIÓN: no se toca nada.\n' : ''}`);

    /* ---- 0. Requisitos ---- */
    c.titulo('Comprobando lo básico');
    const version = Number(process.versions.node.split('.')[0]);
    if (version < 18) { c.error(`Necesitas Node 18 o más. Tienes ${process.versions.node}.`); process.exit(1); }
    c.ok(`Node ${process.versions.node}`);
    if (!existsSync(join(AQUI, 'node_modules')) && !SIMULAR) {
        c.aviso('Falta instalar wrangler. Corre primero:  npm install');
        process.exit(1);
    }
    c.ok('wrangler disponible');

    /* ---- 1. Entrar a Cloudflare ---- */
    c.titulo('1. Tu cuenta de Cloudflare');
    c.info('Se va a abrir el navegador para que autorices. Si ya entraste antes, sigue de largo.');
    await preguntar('Enter para continuar');
    correrInteractivo(['login']);

    /* ---- 2. Base de datos ---- */
    c.titulo('2. Base de datos');
    let idBase = null;
    const lista = correr(['d1', 'list', '--json']);
    if (lista.ok) {
        try {
            const bases = JSON.parse(lista.salida.slice(lista.salida.indexOf('[')));
            const ya = bases.find((b) => b.name === 'torneos-ff');
            if (ya) { idBase = ya.uuid || ya.database_id; c.ok(`Ya existía: ${idBase}`); }
        } catch (e) { /* si no se puede leer, se crea abajo */ }
    }
    if (!idBase) {
        const creada = correr(['d1', 'create', 'torneos-ff']);
        const m = creada.salida.match(/database_id\s*=\s*"([^"]+)"/) || creada.salida.match(/"uuid":\s*"([^"]+)"/);
        if (!m && !SIMULAR) {
            c.error('No pude crear la base de datos. Esto dijo Cloudflare:');
            console.log(creada.salida);
            process.exit(1);
        }
        idBase = m ? m[1] : 'simulado-0000';
        c.ok(`Creada: ${idBase}`);
    }

    // Dejar el id escrito en la configuración
    const toml = cambiarValor(readFileSync(WRANGLER_TOML, 'utf8'), 'database_id', `database_id = "${idBase}"`);
    if (!toml.cambiado) { c.error('No encontré database_id en wrangler.toml. Ponlo a mano: ' + idBase); }
    else { if (!SIMULAR) writeFileSync(WRANGLER_TOML, toml.texto); c.ok('wrangler.toml actualizado'); }

    const mig = correr(['d1', 'migrations', 'apply', 'torneos-ff', '--remote']);
    if (!mig.ok && !SIMULAR && !/no migrations to apply/i.test(mig.salida)) {
        c.error('Fallaron las migraciones:'); console.log(mig.salida); process.exit(1);
    }
    c.ok('Tablas creadas');

    /* ---- 3. Wompi ---- */
    c.titulo('3. Wompi');
    c.info('Están en Wompi → Desarrollo → Programadores.');
    c.info('Para las pruebas usa las de "Activar modo de pruebas" (pub_test_...).');
    c.info('Lo que escribas aquí va directo a Cloudflare: no se guarda en ningún archivo.\n');

    for (const [variable, texto] of [
        ['WOMPI_LLAVE_PUBLICA', 'Llave pública (pub_test_... o pub_prod_...)'],
        ['WOMPI_INTEGRIDAD', 'Secreto de Integridad'],
        ['WOMPI_EVENTOS', 'Secreto de Eventos']
    ]) {
        const valor = await preguntar(texto);
        if (!valor) { c.aviso(`Sin ${variable}: las recargas quedarán en modo manual.`); continue; }
        const r = correr(['secret', 'put', variable], { entrada: valor + '\n' });
        r.ok || SIMULAR ? c.ok(`${variable} guardado`) : c.error(`No se pudo guardar ${variable}`);
    }

    /* ---- 4. Publicar ---- */
    c.titulo('4. Publicando el servidor');
    const desp = correr(['deploy']);
    if (!desp.ok && !SIMULAR) { c.error('Falló el despliegue:'); console.log(desp.salida); process.exit(1); }
    const mUrl = desp.salida.match(/https:\/\/[^\s]+\.workers\.dev/);
    const url = mUrl ? mUrl[0] : await preguntar('No pude leer la dirección. Pégala tú', 'https://torneos-ff.workers.dev');
    c.ok(`En línea: ${url}`);

    /* ---- 5. Cuenta de organizador ---- */
    c.titulo('5. Tu cuenta de organizador');
    c.info('Esta será la ÚNICA cuenta que vea el panel.\n');
    const ffUid = await preguntar('Tu ID de Free Fire');
    const pass = await preguntar('Contraseña (larga, que no uses en otro lado)');
    const nick = await preguntar('Tu nick', 'ORGANIZADOR');
    const whatsapp = await preguntar('Tu WhatsApp con indicativo', '573000000000');

    if (!/^\d{6,14}$/.test(ffUid) || pass.length < 10) {
        c.error('El ID son solo números y la contraseña debe tener 10 caracteres o más.');
        c.info('Créala después con:  node crear-organizador.mjs <ID> "<contraseña>"');
    } else {
        const enc = new TextEncoder();
        const aHex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
        const sal = aHex(crypto.getRandomValues(new Uint8Array(16)));
        const clave = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
        const hash = aHex(await crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt: enc.encode(sal), iterations: 210000, hash: 'SHA-256' }, clave, 256));
        const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
        const sql = `INSERT INTO usuarios (id, ff_uid, nick, nivel, region, email, whatsapp, pass_hash, pass_sal, rol, verificado, creado) `
            + `VALUES ('u_${aHex(crypto.getRandomValues(new Uint8Array(8)))}', ${q(ffUid)}, ${q(nick)}, 0, 'us', '', ${q(whatsapp)}, `
            + `${q(hash)}, ${q(sal)}, 'admin', 1, ${q(new Date().toISOString())}) `
            + `ON CONFLICT(ff_uid) DO UPDATE SET rol='admin', pass_hash=excluded.pass_hash, pass_sal=excluded.pass_sal;`;

        const r = correr(['d1', 'execute', 'torneos-ff', '--remote', '--command', sql]);
        r.ok || SIMULAR ? c.ok('Cuenta de organizador lista') : (c.error('No se pudo crear:'), console.log(r.salida));
    }

    /* ---- 6. Conectar la página ---- */
    c.titulo('6. Conectando la página');
    const cfg = cambiarValor(readFileSync(CONFIG_WEB, 'utf8'), 'api', `api: '${url}/api'`);
    if (!cfg.cambiado) {
        c.error(`No encontré la línea "api" en config.js. Ponla a mano:  api: '${url}/api'`);
    } else {
        if (!SIMULAR) writeFileSync(CONFIG_WEB, cfg.texto);
        c.ok(`torneos/js/config.js → ${url}/api`);
    }

    /* ---- 7. Comprobar ---- */
    c.titulo('7. Comprobando');
    if (!SIMULAR) {
        await new Promise((listo) => {
            const p = spawn('node', [join(RAIZ, 'torneos/servidor/api/verificar-despliegue.js'), url], { stdio: 'inherit' });
            p.on('close', listo);
        });
    }

    /* ---- Lo que queda ---- */
    c.titulo('Te faltan dos cosas, y las dos son fuera de aquí');
    console.log(`
  1. En Wompi → Desarrollo → Programadores → URL de Eventos, pega:

       ${url}/api/wompi/eventos

     y dale Guardar. Sin esto el saldo nunca se acredita solo.

  2. Sube el cambio de config.js a GitHub:

       git add torneos/js/config.js
       git commit -m "conectar la página con el servidor"
       git push

  Después, la prueba de verdad: entra con tu cuenta, crea un torneo, y
  desde otro navegador regístrate como jugador y recarga con la tarjeta
  de prueba 4242 4242 4242 4242. El saldo debe aparecer solo.
`);
    rl.close();
}

main().catch((e) => { c.error(e.message); rl.close(); process.exit(1); });
