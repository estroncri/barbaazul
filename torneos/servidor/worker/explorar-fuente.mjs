#!/usr/bin/env node
/* ============================================================
   ¿Sirve esta página como fuente de perfiles?
   ------------------------------------------------------------
   Antes de enchufar un sitio hay que mirar tres cosas, y en este
   orden:

     1. Si su robots.txt nos deja. Que una página sea pública no
        significa que su dueño quiera que un programa la lea a
        destajo; si dice que no, no se hace y punto.
     2. Si trae el dato que buscamos.
     3. Si por debajo hay un API que devuelva JSON. Leer el JSON
        de alguien es mucho más estable que leer su HTML, que
        cambia cada vez que le mueven un botón.

       node explorar-fuente.mjs https://sitio/cuenta/{uid}.html 1221001584
   ============================================================ */

const plantilla = process.argv[2] || process.env.EXPLORAR || '';
const uid = String(process.argv[3] || process.env.UID_FF || '').replace(/\D/g, '');

if (!plantilla || !uid) {
    console.error('Uso: node explorar-fuente.mjs "https://sitio/cuenta/{uid}.html?region={region}" 1221001584');
    process.exit(1);
}

const url = plantilla.replace('{uid}', uid).replace('{region}', 'us').replace('{REGION}', 'US');
const origen = new URL(url).origin;
const cabeceras = { 'User-Agent': 'TorneosFF/1.0 (+https://estroncri.github.io/barbaazul/torneos/)' };

console.log(`\n▸ Explorando ${url}\n`);

/* ---- 1. ¿Nos deja su robots.txt? ---- */
let permitido = null;
try {
    const r = await fetch(origen + '/robots.txt', { headers: cabeceras, signal: AbortSignal.timeout(10000) });
    if (!r.ok) {
        console.log(`  · robots.txt: contestó ${r.status} (no hay reglas publicadas)`);
    } else {
        const txt = await r.text();
        const ruta = new URL(url).pathname;

        /* Solo se miran las reglas del bloque "para todos". Si hay un bloque
           para un buscador concreto, no es el nuestro. */
        const bloques = txt.split(/^user-agent:/im).slice(1);
        const general = bloques.find((b) => b.trimStart().toLowerCase().startsWith('*')) || '';
        const prohibidas = [...general.matchAll(/^\s*disallow:\s*(\S*)/gim)].map((m) => m[1]).filter(Boolean);

        const choca = prohibidas.find((p) => p !== '/' ? ruta.startsWith(p) : true);
        permitido = !choca;
        console.log(`  ${permitido ? '✔' : '✘'} robots.txt: ${permitido
            ? 'no prohíbe esta ruta'
            : `PROHÍBE esta ruta (Disallow: ${choca})`}`);
        if (prohibidas.length) console.log(`     prohibidas: ${prohibidas.slice(0, 8).join(' ')}`);
    }
} catch (e) {
    console.log(`  · robots.txt: no se pudo leer (${e.message})`);
}

if (permitido === false) {
    console.log(`\n  Su dueño no quiere que un programa lea esa ruta. No se usa.\n`);
    process.exit(1);
}

/* ---- 2. ¿Trae el dato? ---- */
let r;
try {
    r = await fetch(url, { headers: cabeceras, signal: AbortSignal.timeout(15000) });
} catch (e) {
    console.log(`  ✘ La página no respondió: ${e.message}\n`);
    process.exit(1);
}
console.log(`  ${r.ok ? '✔' : '✘'} La página contestó ${r.status} (${r.headers.get('content-type') || 'sin tipo'})`);
if (!r.ok) process.exit(1);

const cuerpo = await r.text();
console.log(`     ${cuerpo.length} caracteres`);

/* El nick suele estar en el título o en un dato marcado. */
const titulo = (cuerpo.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
console.log(`     título: ${titulo.trim().slice(0, 120)}`);

const pistas = [
    ['og:title', /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i],
    ['nickname JSON', /"nick(?:name|Name)?"\s*:\s*"([^"]+)"/],
    ['h1', /<h1[^>]*>([\s\S]{0,120}?)<\/h1>/i]
];
for (const [donde, re] of pistas) {
    const m = cuerpo.match(re);
    if (m) console.log(`     ${donde}: ${m[1].replace(/\s+/g, ' ').trim().slice(0, 100)}`);
}

/* ---- 3. ¿Hay un JSON por debajo? ---- */
const apis = [...new Set([...cuerpo.matchAll(/["'](\/?[\w./-]*api[\w./-]*)["']/gi)].map((m) => m[1]))]
    .filter((u) => u.length > 4).slice(0, 12);
console.log(apis.length
    ? `\n  Direcciones con "api" dentro de la página (mejor leer JSON que HTML):\n${apis.map((a) => '     ' + a).join('\n')}`
    : '\n  No se ven direcciones de API dentro de la página.');

console.log('');
