/* ============================================================
   Servidor de prueba — imita la respuesta de un proveedor de
   perfiles de Free Fire, para probar todo el flujo sin contratar
   nada todavía.

       node torneos/servidor/mock-perfil.js
       # queda en http://localhost:8787/perfil?uid=1890109056&region=us

   Luego, en js/store.js:
       perfilApi: 'http://localhost:8787/perfil'
   ============================================================ */

const http = require('http');

const NICKS = ['ZeusFF', 'Kraken', 'ElCosta', 'NovaKill', 'LoboGris', 'Yeikob', 'DarkAlex'];
const PUERTO = process.env.PORT || 8787;

http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (url.pathname !== '/perfil') {
        res.statusCode = 404;
        return res.end(JSON.stringify({ error: 'Ruta no encontrada' }));
    }

    const uid = (url.searchParams.get('uid') || '').replace(/\D/g, '');
    const region = (url.searchParams.get('region') || 'us').toLowerCase();

    if (!/^\d{6,14}$/.test(uid)) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'ID inválido' }));
    }
    // Para probar el caso "cuenta que no existe": cualquier ID que termine en 0000
    if (uid.endsWith('0000')) {
        res.statusCode = 404;
        return res.end(JSON.stringify({ error: 'Cuenta no encontrada' }));
    }

    const s = uid.split('').reduce((a, c) => a + +c, 0);

    // Se devuelve con la forma típica de estos proveedores (basicInfo / clanBasicInfo),
    // justamente para comprobar que perfil-ff.js la normaliza bien.
    res.end(JSON.stringify({
        basicInfo: {
            accountId: uid,
            nickname: NICKS[s % NICKS.length] + (s % 97),
            level: 30 + (s % 45),
            exp: 150000 + s * 731,
            liked: 200 + s * 7,
            region: region.toUpperCase(),
            honorScore: 80 + (s % 20),
            rank: ['Oro III', 'Platino I', 'Diamante II', 'Heroico', 'Maestro'][s % 5],
            csRank: ['Oro I', 'Platino III', 'Diamante I', 'Heroico'][s % 4],
            createAt: String(Math.floor((Date.now() - (400 + s * 13) * 864e5) / 1000)),
            lastLoginAt: String(Math.floor((Date.now() - (s % 72) * 36e5) / 1000))
        },
        clanBasicInfo: s % 3 ? {
            clanName: 'LOS ' + NICKS[(s + 4) % NICKS.length].toUpperCase(),
            clanId: String(6000000 + s * 11),
            clanLevel: 1 + s % 6,
            memberNum: 10 + s % 40
        } : null,
        socialInfo: { signature: s % 2 ? 'Jugando duro 🔥' : '' }
    }));
}).listen(PUERTO, () => console.log('Mock de perfiles escuchando en http://localhost:' + PUERTO + '/perfil'));
