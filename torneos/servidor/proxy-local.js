/* ============================================================
   Torneos FF — Proxy local de perfiles de Free Fire
   ------------------------------------------------------------
   Para probar el inicio de sesión con ID real desde tu computador,
   sin desplegar nada ni abrir cuenta en ningún lado.

       node torneos/servidor/proxy-local.js
       node torneos/servidor/proxy-local.js --proveedor=glob

   Luego, en torneos/js/store.js:
       perfilApi: 'http://localhost:8787/perfil'

   Hace lo mismo que el Worker de Cloudflare (perfil-ff.worker.js):
   llama al proveedor desde el servidor, no desde el navegador, para
   esquivar el CORS y no exponer la IP de cada jugador.
   ============================================================ */

const http = require('http');
const { URL } = require('url');

/* Proveedores conocidos. Todos son servicios NO oficiales: no tienen
   convenio con Garena y pueden caerse o cambiar sin avisar. Por eso
   están aquí, en un solo sitio y fáciles de cambiar. */
const PROVEEDORES = {
    // https://github.com/jinix6/free-ff-api — gratis, sin llave
    jinix: {
        nombre: 'free-ff-api (jinix6)',
        url: (uid, region) =>
            `https://free-ff-api-src-5plp.onrender.com/api/v1/account?region=${region.toUpperCase()}&uid=${uid}`,
        cabeceras: {}
    },
    // https://github.com/paulafredo/free-fire-info-api — gratis, sin región
    glob: {
        nombre: 'glob-info2 (paulafredo)',
        url: (uid) => `https://glob-info2.vercel.app/info?uid=${uid}`,
        cabeceras: {}
    },
    // Plantilla para uno de pago: exporta FF_API_URL y FF_API_KEY
    propio: {
        nombre: 'el que configures en FF_API_URL',
        url: (uid, region) => (process.env.FF_API_URL || '')
            .replace('{uid}', uid).replace('{region}', region),
        cabeceras: process.env.FF_API_KEY
            ? { Authorization: 'Bearer ' + process.env.FF_API_KEY, 'x-api-key': process.env.FF_API_KEY }
            : {}
    }
};

const arg = (n, pordefecto) => {
    const m = process.argv.find((a) => a.startsWith('--' + n + '='));
    return m ? m.split('=')[1] : pordefecto;
};

const CLAVE = arg('proveedor', 'jinix');
const PUERTO = Number(arg('puerto', process.env.PORT || 8787));
const proveedor = PROVEEDORES[CLAVE];

if (!proveedor) {
    console.error(`Proveedor desconocido: "${CLAVE}". Opciones: ${Object.keys(PROVEEDORES).join(', ')}`);
    process.exit(1);
}

const cache = new Map();           // uid@region -> { t, datos }
const CACHE_MS = 5 * 60 * 1000;

http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
    if (url.pathname !== '/perfil') {
        res.statusCode = 404;
        return res.end(JSON.stringify({ error: 'Usa /perfil?uid=...&region=...' }));
    }

    const uid = (url.searchParams.get('uid') || '').replace(/\D/g, '');
    const region = (url.searchParams.get('region') || 'us').toLowerCase();

    if (!/^\d{6,14}$/.test(uid)) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'El ID de Free Fire son solo números (entre 6 y 14 dígitos).' }));
    }

    const clave = uid + '@' + region;
    const guardado = cache.get(clave);
    if (guardado && Date.now() - guardado.t < CACHE_MS) {
        console.log(`· ${uid} (${region}) — de caché`);
        return res.end(JSON.stringify(guardado.datos));
    }

    const destino = proveedor.url(uid, region);
    if (!destino) {
        res.statusCode = 503;
        return res.end(JSON.stringify({ error: 'Falta configurar FF_API_URL.' }));
    }

    const t0 = Date.now();
    try {
        const r = await fetch(destino, {
            headers: Object.assign({ Accept: 'application/json', 'User-Agent': 'TorneosFF/1.0' }, proveedor.cabeceras),
            signal: AbortSignal.timeout(15000)
        });

        if (r.status === 404) {
            console.log(`· ${uid} (${region}) — no existe`);
            res.statusCode = 404;
            return res.end(JSON.stringify({ error: 'No encontramos ninguna cuenta con ese ID en esa región.' }));
        }
        if (!r.ok) {
            console.log(`· ${uid} (${region}) — el proveedor respondió ${r.status}`);
            res.statusCode = 502;
            return res.end(JSON.stringify({ error: `El proveedor respondió ${r.status}.` }));
        }

        const datos = await r.json();
        // Algunos devuelven 200 con el error dentro del cuerpo
        if (!datos || (!datos.basicInfo && !datos.account && !datos.nickname && !datos.AccountInfo)) {
            console.log(`· ${uid} (${region}) — respuesta sin datos de cuenta`);
            res.statusCode = 404;
            return res.end(JSON.stringify({ error: 'No encontramos ninguna cuenta con ese ID en esa región.' }));
        }

        cache.set(clave, { t: Date.now(), datos });
        console.log(`· ${uid} (${region}) — ok en ${Date.now() - t0} ms`);
        res.end(JSON.stringify(datos));
    } catch (e) {
        console.log(`· ${uid} (${region}) — falló: ${e.message}`);
        res.statusCode = 504;
        res.end(JSON.stringify({ error: 'El proveedor no respondió a tiempo.' }));
    }
}).listen(PUERTO, () => {
    console.log(`\n  Proxy de perfiles escuchando en http://localhost:${PUERTO}/perfil`);
    console.log(`  Proveedor: ${proveedor.nombre}`);
    console.log(`\n  Pon esto en torneos/js/store.js →  perfilApi: 'http://localhost:${PUERTO}/perfil'\n`);
});
