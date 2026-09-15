/* ============================================================
   TORNEOS FF — Consulta de perfil de Free Fire (perfil-ff.js)
   ------------------------------------------------------------
   Trae los datos públicos de una cuenta a partir del ID, como
   hacen las páginas tipo "ver perfil de Free Fire por ID".

   IMPORTANTE — dos cosas que hay que tener claras:

   1) Garena no publica una API oficial. Esas páginas consultan
      servicios no oficiales que se caen, cambian sin avisar y
      pueden bloquear por IP. Por eso aquí NUNCA se llama al
      servicio de un tercero directamente desde el navegador:
      se llama a TU endpoint (ver carpeta servidor/), y ese
      endpoint es el único sitio donde hay que tocar algo el día
      que el proveedor cambie.

   2) Ver el perfil de un ID NO demuestra que la cuenta sea tuya:
      cualquiera puede escribir el ID de otro y ver su nick. Por
      eso, además de mostrar los datos, se pide el código de
      verificación en la biografía del juego.
   ============================================================ */

window.PerfilFF = (function () {
    'use strict';

    const CACHE_KEY = 'torneos_ff_perfil_cache_v1';
    const CACHE_MS = 10 * 60 * 1000;   // 10 minutos
    const TIMEOUT_MS = 12000;

    const REGIONES = {
        us: 'América (US)', sac: 'Sudamérica', br: 'Brasil', na: 'Norteamérica',
        sg: 'Singapur', id: 'Indonesia', ind: 'India', th: 'Tailandia',
        vn: 'Vietnam', tw: 'Taiwán', me: 'Medio Oriente', eu: 'Europa',
        pk: 'Pakistán', cis: 'CIS', bd: 'Bangladesh'
    };

    /* ===== Rangos =====
       La API no devuelve "Maestro" sino un código: 201 = Bronce I …
       220 = Maestro. Sin esta tabla el jugador vería "Rango BR: 220". */
    const RANGOS = {
        201: 'Bronce I', 202: 'Bronce II', 203: 'Bronce III',
        204: 'Plata I', 205: 'Plata II', 206: 'Plata III',
        207: 'Oro I', 208: 'Oro II', 209: 'Oro III', 210: 'Oro IV',
        211: 'Platino I', 212: 'Platino II', 213: 'Platino III', 214: 'Platino IV',
        215: 'Diamante I', 216: 'Diamante II', 217: 'Diamante III', 218: 'Diamante IV',
        219: 'Heroico', 220: 'Maestro'
    };

    function nombreRango(valor, puntos) {
        if (valor === null || valor === undefined || valor === '') return null;
        // Si ya viene con nombre (otros proveedores lo mandan así), se respeta
        if (typeof valor === 'string' && !/^\d+$/.test(valor.trim())) return valor.trim();
        const n = Number(valor);
        const nombre = RANGOS[n] || (n >= 100 ? 'Rango ' + n : null);
        if (!nombre) return null;
        return puntos ? `${nombre} · ${Number(puntos).toLocaleString('es-CO')} pts` : nombre;
    }

    /* ===== Caché ===== */
    function leerCache(clave) {
        try {
            const todo = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
            const e = todo[clave];
            if (e && Date.now() - e.t < CACHE_MS) return e.v;
        } catch (e) { /* caché inservible, se ignora */ }
        return null;
    }

    function guardarCache(clave, valor) {
        try {
            const todo = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
            todo[clave] = { t: Date.now(), v: valor };
            localStorage.setItem(CACHE_KEY, JSON.stringify(todo));
        } catch (e) { /* sin caché, no pasa nada */ }
    }

    /* ===== Normalización =====
       Cada proveedor devuelve las claves con otro nombre. Aquí se
       aplana todo a una sola forma para que la interfaz no dependa
       de quién respondió. */
    const primero = (obj, claves, pordefecto) => {
        for (const c of claves) {
            const val = c.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
            if (val !== undefined && val !== null && val !== '') return val;
        }
        return pordefecto;
    };

    function normalizar(raw, uid, region) {
        const d = raw && (raw.basicInfo || raw.account || raw.data || raw.profile || raw.player) ? raw : { ...raw };
        const b = d.basicInfo || d.account || d.data || d.profile || d.player || d;
        const clan = d.clanBasicInfo || d.guild || d.clan || b.guild || {};
        const pet = d.petInfo || d.pet || {};

        const ts = (v) => {
            if (!v) return null;
            const n = Number(v);
            if (!isNaN(n) && n > 0) return new Date(n < 1e12 ? n * 1000 : n).toISOString();
            const dt = new Date(v);
            return isNaN(dt) ? null : dt.toISOString();
        };

        return {
            uid: String(primero(b, ['accountId', 'account_id', 'uid', 'id'], uid)),
            nick: primero(b, ['nickname', 'nickName', 'nick', 'name', 'username'], null),
            nivel: Number(primero(b, ['level', 'lvl', 'nivel'], 0)) || 0,
            exp: Number(primero(b, ['exp', 'experience'], 0)) || 0,
            likes: Number(primero(b, ['liked', 'likes', 'like'], 0)) || 0,
            region: String(primero(b, ['region', 'server'], region || '')).toLowerCase(),
            honor: Number(primero(b, ['honorScore', 'honor_score', 'honor'], 0)) || 0,
            rangoBR: nombreRango(
                primero(b, ['rankName', 'brRank', 'rank', 'br_rank'], null),
                primero(b, ['rankingPoints', 'ranking_points'], null)),
            rangoCS: nombreRango(
                primero(b, ['csRankName', 'csRank', 'cs_rank'], null),
                primero(b, ['csRankingPoints', 'cs_ranking_points'], null)),
            credito: Number(primero(d, ['creditScoreInfo.creditScore', 'creditScore', 'credit_score'], 0)) || 0,
            bio: primero(d, ['socialInfo.signature', 'social.signature', 'signature', 'bio'], ''),
            gremio: clan && (clan.clanName || clan.name)
                ? {
                    nombre: clan.clanName || clan.name,
                    id: String(clan.clanId || clan.id || ''),
                    nivel: Number(clan.clanLevel || clan.level || 0) || 0,
                    miembros: Number(clan.memberNum || clan.members || 0) || 0
                }
                : null,
            mascota: pet && (pet.name || pet.petName) ? { nombre: pet.name || pet.petName, nivel: Number(pet.level || 0) || 0 } : null,
            // headPic y avatarId son NÚMEROS de catálogo, no direcciones de imagen:
            // solo se acepta algo que de verdad sea una URL.
            avatarUrl: (function () {
                const v = primero(d, ['avatarUrl', 'avatar_url', 'avatar', 'profileImage'], null);
                return typeof v === 'string' && /^https?:\/\//i.test(v) ? v : null;
            })(),
            creada: ts(primero(b, ['createAt', 'created_at', 'createdAt', 'accountCreateTime'], null)),
            ultimaConexion: ts(primero(b, ['lastLoginAt', 'last_login', 'lastLogin'], null)),
            fuente: 'api',
            consultadoEn: new Date().toISOString()
        };
    }

    /* ===== Perfil simulado (cuando no hay endpoint configurado) ===== */
    const NICKS = ['ZeusFF', 'Kraken', 'ElCosta', 'NovaKill', 'Maracucho', 'LoboGris',
        'Yeikob', 'SirBooy', 'DarkAlex', 'Kenny07', 'JuanFF', 'MrTiburon'];

    function perfilSimulado(uid, region) {
        const s = String(uid).split('').reduce((a, c) => a + +c, 0);
        const dias = 400 + (s * 13) % 1500;
        return {
            uid: String(uid),
            nick: NICKS[s % NICKS.length] + (s % 97),
            nivel: 30 + (s % 45),
            exp: 150000 + s * 731,
            likes: 200 + s * 7,
            region: (region || 'us').toLowerCase(),
            honor: 0,
            credito: 80 + (s % 20),
            rangoBR: ['Oro III', 'Platino I', 'Diamante II', 'Heroico', 'Maestro'][s % 5],
            rangoCS: ['Oro I', 'Platino III', 'Diamante I', 'Heroico'][s % 4],
            bio: '',
            gremio: s % 3 ? { nombre: 'LOS ' + NICKS[(s + 4) % NICKS.length].toUpperCase(), id: String(6000000 + s * 11), nivel: 1 + s % 6, miembros: 10 + s % 40 } : null,
            mascota: null,
            avatarUrl: null,
            creada: new Date(Date.now() - dias * 864e5).toISOString(),
            ultimaConexion: new Date(Date.now() - (s % 72) * 36e5).toISOString(),
            fuente: 'simulado',
            consultadoEn: new Date().toISOString()
        };
    }

    /* ===== Consulta ===== */
    async function consultar(uid, region, opciones) {
        const op = opciones || {};
        uid = String(uid || '').replace(/\D/g, '');
        region = (region || 'us').toLowerCase();

        if (!/^\d{6,14}$/.test(uid)) {
            throw new Error('El ID de Free Fire son solo números (entre 6 y 14 dígitos).');
        }

        const clave = uid + '@' + region;
        if (!op.sinCache) {
            const c = leerCache(clave);
            if (c) return Object.assign({}, c, { deCache: true });
        }

        const endpoint = (window.Store && Store.config().perfilApi) || '';

        // Sin endpoint propio configurado: modo demostración.
        if (!endpoint) {
            await new Promise((r) => setTimeout(r, 650));
            const p = perfilSimulado(uid, region);
            guardarCache(clave, p);
            return p;
        }

        const url = endpoint
            + (endpoint.includes('?') ? '&' : '?')
            + 'uid=' + encodeURIComponent(uid)
            + '&region=' + encodeURIComponent(region);

        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        let resp;
        try {
            resp = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
        } catch (e) {
            clearTimeout(timer);
            throw new Error(e.name === 'AbortError'
                ? 'El servidor de Free Fire tardó demasiado en responder. Intenta otra vez.'
                : 'No pudimos conectarnos para consultar tu perfil. Revisa tu internet e intenta de nuevo.');
        }
        clearTimeout(timer);

        if (resp.status === 404) throw new Error('No encontramos ninguna cuenta con ese ID en esa región. Revisa el número y la región.');
        if (resp.status === 429) throw new Error('Muchas consultas seguidas. Espera un momento y vuelve a intentar.');
        if (!resp.ok) throw new Error('El servicio de perfiles no respondió bien (error ' + resp.status + '). Puedes continuar escribiendo tus datos a mano.');

        let json;
        try { json = await resp.json(); }
        catch (e) { throw new Error('El servicio de perfiles devolvió una respuesta ilegible.'); }

        if (json && json.error) throw new Error(String(json.error));

        const perfil = normalizar(json, uid, region);
        if (!perfil.nick) {
            throw new Error('No encontramos el nick de esa cuenta. Revisa el ID y la región.');
        }
        guardarCache(clave, perfil);
        return perfil;
    }

    /* ===== Ayudas de presentación ===== */
    function nombreRegion(r) {
        return REGIONES[String(r || '').toLowerCase()] || String(r || '').toUpperCase() || '—';
    }

    function antiguedad(iso) {
        if (!iso) return null;
        const dias = Math.floor((Date.now() - new Date(iso)) / 864e5);
        if (dias < 0) return null;
        if (dias < 60) return `hace ${dias} días`;
        const meses = Math.floor(dias / 30);
        if (meses < 24) return `hace ${meses} meses`;
        return `hace ${Math.floor(dias / 365)} años`;
    }

    function codigoVerificacion(uid) {
        const s = String(uid).split('').reduce((a, c) => a + +c, 0);
        return 'FF-' + (1000 + (s * 37) % 8999);
    }

    return { consultar, normalizar, nombreRegion, nombreRango, antiguedad,
             codigoVerificacion, REGIONES, RANGOS, perfilSimulado };
})();
