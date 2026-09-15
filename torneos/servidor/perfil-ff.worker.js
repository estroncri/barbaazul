/* ============================================================
   Torneos FF — Proxy de consulta de perfiles de Free Fire
   Cloudflare Worker (plan gratis: 100.000 peticiones al día)
   ------------------------------------------------------------
   Este es el ÚNICO archivo que hay que tocar el día que el
   proveedor de datos cambie o se caiga. El frontend no se entera.

   Para qué sirve:
     - El navegador no puede llamar a esos servicios directamente
       (CORS y bloqueo por IP): este Worker llama por él.
     - Guarda la API key fuera del navegador.
     - Cachea 5 minutos y limita el abuso.

   Desplegar:
     npm install -g wrangler
     wrangler init torneos-ff-perfil       (elegir "Hello World Worker")
     # pegar este archivo en src/index.js
     wrangler secret put FF_API_URL      # plantilla del proveedor
     wrangler secret put FF_API_KEY      # si el proveedor pide llave
     wrangler deploy

   Después, en torneos/js/store.js, poner en config:
     perfilApi: 'https://torneos-ff-perfil.TU-USUARIO.workers.dev/perfil'
   ============================================================ */

const ORIGENES_PERMITIDOS = [
    'https://estroncri.github.io',
    'http://localhost:8000',
    'http://127.0.0.1:8000'
];

const CACHE_SEGUNDOS = 300;
const LIMITE_POR_MINUTO = 20;

export default {
    async fetch(peticion, env, ctx) {
        const url = new URL(peticion.url);
        const origen = peticion.headers.get('Origin') || '';
        const cors = cabecerasCors(origen);

        if (peticion.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (peticion.method !== 'GET') return json({ error: 'Método no permitido' }, 405, cors);

        const uid = (url.searchParams.get('uid') || '').replace(/\D/g, '');
        const region = (url.searchParams.get('region') || 'us').toLowerCase().slice(0, 4);

        if (!/^\d{6,14}$/.test(uid)) {
            return json({ error: 'El ID de Free Fire son solo números (entre 6 y 14 dígitos).' }, 400, cors);
        }

        // Límite simple por IP usando la caché del propio Worker
        const ip = peticion.headers.get('CF-Connecting-IP') || 'anon';
        if (await pasaDelLimite(ip)) {
            return json({ error: 'Muchas consultas seguidas. Espera un momento.' }, 429, cors);
        }

        // Caché de borde: misma cuenta consultada varias veces = una sola llamada al proveedor
        const claveCache = new Request(`https://cache.torneosff/perfil/${region}/${uid}`, peticion);
        const cache = caches.default;
        const enCache = await cache.match(claveCache);
        if (enCache) {
            const r = new Response(enCache.body, enCache);
            Object.entries(cors).forEach(([k, v]) => r.headers.set(k, v));
            r.headers.set('X-TorneosFF-Cache', 'HIT');
            return r;
        }

        if (!env.FF_API_URL) {
            return json({ error: 'El servidor no tiene configurado el proveedor de perfiles (FF_API_URL).' }, 503, cors);
        }

        // FF_API_URL es una plantilla, por ejemplo:
        //   https://ejemplo-proveedor.com/api/account?uid={uid}&region={region}
        const destino = env.FF_API_URL
            .replace('{uid}', encodeURIComponent(uid))
            .replace('{region}', encodeURIComponent(region));

        const cabeceras = { Accept: 'application/json', 'User-Agent': 'TorneosFF/1.0' };
        if (env.FF_API_KEY) {
            // Ajustar al esquema que pida el proveedor (Bearer, x-api-key, etc.)
            cabeceras['Authorization'] = `Bearer ${env.FF_API_KEY}`;
            cabeceras['x-api-key'] = env.FF_API_KEY;
        }

        let arriba;
        try {
            arriba = await fetch(destino, {
                headers: cabeceras,
                cf: { cacheTtl: CACHE_SEGUNDOS, cacheEverything: true },
                signal: AbortSignal.timeout(10000)
            });
        } catch (e) {
            return json({ error: 'El proveedor de perfiles no respondió a tiempo.' }, 504, cors);
        }

        if (arriba.status === 404) return json({ error: 'No encontramos ninguna cuenta con ese ID en esa región.' }, 404, cors);
        if (!arriba.ok) return json({ error: `El proveedor respondió ${arriba.status}.` }, 502, cors);

        let datos;
        try { datos = await arriba.json(); }
        catch (e) { return json({ error: 'El proveedor devolvió una respuesta ilegible.' }, 502, cors); }

        const respuesta = json(datos, 200, cors, CACHE_SEGUNDOS);
        ctx.waitUntil(cache.put(claveCache, respuesta.clone()));
        return respuesta;
    }
};

function cabecerasCors(origen) {
    const permitido = ORIGENES_PERMITIDOS.includes(origen) ? origen : ORIGENES_PERMITIDOS[0];
    return {
        'Access-Control-Allow-Origin': permitido,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin'
    };
}

function json(cuerpo, estado, cors, cacheSeg) {
    return new Response(JSON.stringify(cuerpo), {
        status: estado,
        headers: Object.assign({
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': cacheSeg ? `public, max-age=${cacheSeg}` : 'no-store'
        }, cors)
    });
}

const golpes = new Map();
async function pasaDelLimite(ip) {
    const ahora = Date.now();
    const ventana = golpes.get(ip) || [];
    const recientes = ventana.filter((t) => ahora - t < 60000);
    recientes.push(ahora);
    golpes.set(ip, recientes);
    if (golpes.size > 5000) golpes.clear(); // el Worker es efímero; esto solo evita crecer sin control
    return recientes.length > LIMITE_POR_MINUTO;
}
