/* ============================================================
   Torneos FF — API
   ------------------------------------------------------------
   Todo lo que toca dinero o cupos se decide AQUÍ, nunca en el
   navegador: el cliente solo pide, el servidor comprueba.

   Arrancar:   node torneos/servidor/api/servidor.js
   Variables:  PUERTO, DB_RUTA, ORIGENES, ADMIN_FF_UID, ADMIN_PASS
   ============================================================ */

const http = require('node:http');
const crypto = require('node:crypto');
const { db, uid, ahora, hashPass, verificarPass, saldoDe } = require('./db');

const PUERTO = Number(process.env.PUERTO || 8790);
const ORIGENES = (process.env.ORIGENES ||
    'https://estroncri.github.io,http://localhost:8099,http://127.0.0.1:8099').split(',');
const CUPO_POR_MODO = { solo: 1, duo: 2, escuadra: 4 };
const MIN_RETIRO = Number(process.env.MIN_RETIRO || 10000);
const MIN_RECARGA = Number(process.env.MIN_RECARGA || 1000);

/* ============================================================
   Errores con código HTTP
   ============================================================ */
class ErrorAPI extends Error {
    constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; }
}
const malaPeticion = (m) => new ErrorAPI(400, m);
const noAutorizado = (m) => new ErrorAPI(401, m || 'Inicia sesión.');
const prohibido = (m) => new ErrorAPI(403, m || 'Esta acción es solo para administradores.');
const noEncontrado = (m) => new ErrorAPI(404, m || 'No encontrado.');

/* ============================================================
   Sesiones
   ============================================================ */
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

function crearSesion(usuarioId) {
    const token = crypto.randomBytes(32).toString('hex');
    const expira = new Date(Date.now() + 30 * 864e5).toISOString();
    db.prepare('INSERT INTO sesiones (token_hash, usuario_id, creado, expira) VALUES (?,?,?,?)')
        .run(hashToken(token), usuarioId, ahora(), expira);
    return token;
}

function usuarioDeToken(token) {
    if (!token) return null;
    const s = db.prepare('SELECT * FROM sesiones WHERE token_hash = ?').get(hashToken(token));
    if (!s) return null;
    if (new Date(s.expira) < new Date()) {
        db.prepare('DELETE FROM sesiones WHERE token_hash = ?').run(s.token_hash);
        return null;
    }
    return db.prepare('SELECT * FROM usuarios WHERE id = ?').get(s.usuario_id) || null;
}

/* ============================================================
   Formato de salida (nunca sale el hash de la contraseña)
   ============================================================ */
function usuarioPublico(u) {
    if (!u) return null;
    return {
        id: u.id, ffUid: u.ff_uid, nick: u.nick, nivel: u.nivel, region: u.region,
        email: u.email || '', whatsapp: u.whatsapp, rol: u.rol,
        verificado: !!u.verificado, perfil: u.perfil ? JSON.parse(u.perfil) : null,
        saldo: saldoDe(u.id), creado: u.creado
    };
}

function torneoPublico(t, extras) {
    const ins = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(json_array_length(miembros)),0) j FROM inscripciones WHERE torneo_id = ?').get(t.id);
    return Object.assign({
        id: t.id, nombre: t.nombre, modo: t.modo, fecha: t.fecha,
        cupoMax: t.cupo_max, costo: t.costo, premioTotal: t.premio_total,
        distribucion: JSON.parse(t.distribucion), mapa: t.mapa,
        reglas: JSON.parse(t.reglas), estado: t.estado, tema: t.tema,
        encuesta: t.encuesta ? JSON.parse(t.encuesta) : null,
        inscritos: ins.n, jugadores: ins.j,
        sala: { id: '', pass: '', publicada: !!t.sala_publicada }
    }, extras || {});
}

function inscripcionPublica(i) {
    const r = db.prepare('SELECT * FROM resultados WHERE inscripcion_id = ?').get(i.id);
    return {
        id: i.id, torneoId: i.torneo_id, userId: i.usuario_id,
        equipo: { nombre: i.equipo, miembros: JSON.parse(i.miembros) },
        estado: i.estado, creado: i.creado,
        resultado: r ? { puesto: r.puesto, kills: r.kills, puntos: r.puntos, premio: r.premio } : null
    };
}

const movimientoPublico = (m) => ({
    id: m.id, userId: m.usuario_id, tipo: m.tipo, monto: m.monto, estado: m.estado,
    metodo: m.metodo, ref: m.referencia, nota: m.nota, creado: m.creado
});

function anotar(usuarioId, tipo, monto, extra) {
    const e = extra || {};
    const id = uid('tx');
    db.prepare(`INSERT INTO movimientos (id, usuario_id, tipo, monto, estado, metodo, referencia, nota, creado)
                VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(id, usuarioId, tipo, Math.round(monto), e.estado || 'completada',
             e.metodo || '', e.referencia || '', e.nota || '', ahora());
    return db.prepare('SELECT * FROM movimientos WHERE id = ?').get(id);
}

/* ============================================================
   Rutas
   ============================================================ */
const rutas = [];
const ruta = (metodo, patron, mano) => rutas.push({ metodo, patron, mano });

/* ---------- Cuenta ---------- */
ruta('POST', /^\/api\/auth\/registro$/, (ctx) => {
    const { ffUid, nick, nivel, region, email, whatsapp, pass, perfil } = ctx.cuerpo;

    if (!/^\d{6,14}$/.test(String(ffUid || ''))) throw malaPeticion('El ID de Free Fire son solo números (entre 6 y 14 dígitos).');
    if (!nick || !String(nick).trim()) throw malaPeticion('Escribe tu nick del juego.');
    if (!pass || pass.length < 6) throw malaPeticion('La contraseña debe tener al menos 6 caracteres.');
    if (!/^\d{10,13}$/.test(String(whatsapp || '').replace(/\D/g, ''))) throw malaPeticion('Escribe un número de WhatsApp válido (con indicativo).');

    if (db.prepare('SELECT 1 FROM usuarios WHERE ff_uid = ?').get(String(ffUid))) {
        throw malaPeticion('Ese ID de Free Fire ya está registrado.');
    }

    const { hash, sal } = hashPass(pass);
    const id = uid('u');
    db.prepare(`INSERT INTO usuarios (id, ff_uid, nick, nivel, region, email, whatsapp, pass_hash, pass_sal, rol, verificado, perfil, creado)
                VALUES (?,?,?,?,?,?,?,?,?,'jugador',0,?,?)`)
        .run(id, String(ffUid), String(nick).trim(), Number(nivel) || 0, region || 'us',
             email || '', String(whatsapp).replace(/\D/g, ''), hash, sal,
             perfil ? JSON.stringify(perfil) : null, ahora());

    const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
    return { token: crearSesion(id), usuario: usuarioPublico(u) };
});

ruta('POST', /^\/api\/auth\/login$/, (ctx) => {
    const q = String(ctx.cuerpo.usuario || '').trim().toLowerCase();
    const u = db.prepare('SELECT * FROM usuarios WHERE ff_uid = ? OR lower(email) = ?').get(q, q);
    if (!u || !verificarPass(String(ctx.cuerpo.pass || ''), u.pass_hash, u.pass_sal)) {
        throw new ErrorAPI(401, 'ID/correo o contraseña incorrectos.');
    }
    return { token: crearSesion(u.id), usuario: usuarioPublico(u) };
});

ruta('POST', /^\/api\/auth\/logout$/, (ctx) => {
    if (ctx.token) db.prepare('DELETE FROM sesiones WHERE token_hash = ?').run(hashToken(ctx.token));
    return { ok: true };
});

ruta('GET', /^\/api\/yo$/, (ctx) => usuarioPublico(ctx.exigirUsuario()));

/* ---------- Torneos ---------- */
ruta('GET', /^\/api\/torneos$/, (ctx) => {
    const filas = db.prepare('SELECT * FROM torneos ORDER BY fecha ASC').all();
    return filas.map((t) => torneoPublico(t));
});

ruta('GET', /^\/api\/torneos\/([\w-]+)$/, (ctx, m) => {
    const t = db.prepare('SELECT * FROM torneos WHERE id = ?').get(m[1]);
    if (!t) throw noEncontrado('Torneo no encontrado.');

    const inscripciones = db.prepare('SELECT * FROM inscripciones WHERE torneo_id = ? ORDER BY creado ASC')
        .all(t.id).map(inscripcionPublica);

    const yo = ctx.usuario();
    const mia = yo ? inscripciones.find((i) => i.userId === yo.id) || null : null;
    const esAdmin = yo && yo.rol === 'admin';

    const salida = torneoPublico(t, { participantes: inscripciones, miInscripcion: mia });

    // El ID y la contraseña de la sala solo viajan a quien tiene derecho a verlos.
    // Si se mandaran siempre, cualquiera los leería en la respuesta del navegador.
    if (t.sala_publicada && (mia || esAdmin)) {
        salida.sala = { id: t.sala_id, pass: t.sala_pass, publicada: true };
    }
    return salida;
});

ruta('POST', /^\/api\/torneos$/, (ctx) => {
    ctx.exigirAdmin();
    const d = ctx.cuerpo;
    if (!d.nombre || !String(d.nombre).trim()) throw malaPeticion('Ponle un nombre al torneo.');
    if (!d.fecha) throw malaPeticion('Falta la fecha y hora.');
    if (!CUPO_POR_MODO[d.modo]) throw malaPeticion('Modo inválido.');

    const id = uid('t');
    db.prepare(`INSERT INTO torneos (id, nombre, modo, fecha, cupo_max, costo, premio_total, distribucion, mapa, reglas, estado, tema, creado)
                VALUES (?,?,?,?,?,?,?,?,?,?,'abierto',?,?)`)
        .run(id, String(d.nombre).trim(), d.modo, d.fecha, Number(d.cupoMax) || 12,
             Math.max(0, Math.round(Number(d.costo) || 0)), Math.max(0, Math.round(Number(d.premioTotal) || 0)),
             JSON.stringify(d.distribucion && d.distribucion.length ? d.distribucion : [{ pos: 1, pct: 60 }, { pos: 2, pct: 25 }, { pos: 3, pct: 15 }]),
             d.mapa || 'Bermuda', JSON.stringify(d.reglas || []), d.tema || 'fuego', ahora());
    return torneoPublico(db.prepare('SELECT * FROM torneos WHERE id = ?').get(id));
});

ruta('PATCH', /^\/api\/torneos\/([\w-]+)$/, (ctx, m) => {
    ctx.exigirAdmin();
    const t = db.prepare('SELECT * FROM torneos WHERE id = ?').get(m[1]);
    if (!t) throw noEncontrado('Torneo no encontrado.');
    if (ctx.cuerpo.estado) {
        db.prepare('UPDATE torneos SET estado = ? WHERE id = ?').run(ctx.cuerpo.estado, t.id);
    }
    if (ctx.cuerpo.encuesta !== undefined) {
        db.prepare('UPDATE torneos SET encuesta = ? WHERE id = ?')
            .run(ctx.cuerpo.encuesta ? JSON.stringify(ctx.cuerpo.encuesta) : null, t.id);
    }
    return torneoPublico(db.prepare('SELECT * FROM torneos WHERE id = ?').get(t.id));
});

ruta('POST', /^\/api\/torneos\/([\w-]+)\/sala$/, (ctx, m) => {
    ctx.exigirAdmin();
    const t = db.prepare('SELECT * FROM torneos WHERE id = ?').get(m[1]);
    if (!t) throw noEncontrado('Torneo no encontrado.');
    const { salaId, pass } = ctx.cuerpo;
    if (!salaId || !pass) throw malaPeticion('Escribe el ID y la contraseña de la sala.');
    db.prepare('UPDATE torneos SET sala_id = ?, sala_pass = ?, sala_publicada = 1, estado = ? WHERE id = ?')
        .run(String(salaId), String(pass), 'en_curso', t.id);
    return { ok: true };
});

/* ---------- Inscripciones ---------- */
ruta('POST', /^\/api\/torneos\/([\w-]+)\/inscripciones$/, (ctx, m) => {
    const yo = ctx.exigirUsuario();
    const equipo = ctx.cuerpo.equipo || {};

    // Transacción: comprobar cupo y saldo, y cobrar, sin que se cuele nadie
    // entre medio. Sin esto, dos inscripciones a la vez pueden pasarse del
    // cupo o dejar el saldo en negativo.
    db.exec('BEGIN IMMEDIATE');
    try {
        const t = db.prepare('SELECT * FROM torneos WHERE id = ?').get(m[1]);
        if (!t) throw noEncontrado('Torneo no encontrado.');
        if (t.estado !== 'abierto') throw malaPeticion('Las inscripciones de este torneo están cerradas.');

        if (db.prepare('SELECT 1 FROM inscripciones WHERE torneo_id = ? AND usuario_id = ?').get(t.id, yo.id)) {
            throw malaPeticion('Ya estás inscrito en este torneo.');
        }

        const n = db.prepare('SELECT COUNT(*) n FROM inscripciones WHERE torneo_id = ?').get(t.id).n;
        if (n >= t.cupo_max) throw malaPeticion('Ya no quedan cupos.');

        const requeridos = CUPO_POR_MODO[t.modo];
        const miembros = (equipo.miembros || [])
            .filter((x) => x && x.nick && String(x.nick).trim())
            .map((x) => ({ nick: String(x.nick).trim().slice(0, 30), uid: String(x.uid || '').replace(/\D/g, '').slice(0, 14) }));
        if (miembros.length !== requeridos) {
            throw malaPeticion(`Este torneo necesita ${requeridos} jugador(es).`);
        }

        const total = t.costo * requeridos;
        if (saldoDe(yo.id) < total) throw malaPeticion('Saldo insuficiente. Recarga en tu billetera.');

        anotar(yo.id, 'inscripcion', -total, { metodo: 'Saldo', referencia: t.id, nota: t.nombre });

        const id = uid('i');
        db.prepare('INSERT INTO inscripciones (id, torneo_id, usuario_id, equipo, miembros, estado, creado) VALUES (?,?,?,?,?,?,?)')
            .run(id, t.id, yo.id, String(equipo.nombre || yo.nick).slice(0, 40), JSON.stringify(miembros), 'confirmada', ahora());

        if (n + 1 >= t.cupo_max) db.prepare("UPDATE torneos SET estado = 'lleno' WHERE id = ?").run(t.id);

        db.exec('COMMIT');
        return inscripcionPublica(db.prepare('SELECT * FROM inscripciones WHERE id = ?').get(id));
    } catch (e) {
        db.exec('ROLLBACK');
        throw e;
    }
});

ruta('DELETE', /^\/api\/torneos\/([\w-]+)\/inscripciones$/, (ctx, m) => {
    const yo = ctx.exigirUsuario();
    db.exec('BEGIN IMMEDIATE');
    try {
        const t = db.prepare('SELECT * FROM torneos WHERE id = ?').get(m[1]);
        if (!t) throw noEncontrado('Torneo no encontrado.');
        const i = db.prepare('SELECT * FROM inscripciones WHERE torneo_id = ? AND usuario_id = ?').get(t.id, yo.id);
        if (!i) throw malaPeticion('No estás inscrito en este torneo.');
        if (t.sala_publicada) throw malaPeticion('La sala ya fue publicada: no se puede cancelar.');

        const devolver = t.costo * JSON.parse(i.miembros).length;
        anotar(yo.id, 'reembolso', devolver, { metodo: 'Saldo', referencia: t.id, nota: 'Cancelación — ' + t.nombre });
        db.prepare('DELETE FROM inscripciones WHERE id = ?').run(i.id);
        if (t.estado === 'lleno') db.prepare("UPDATE torneos SET estado = 'abierto' WHERE id = ?").run(t.id);

        db.exec('COMMIT');
        return { ok: true };
    } catch (e) {
        db.exec('ROLLBACK');
        throw e;
    }
});

ruta('GET', /^\/api\/mis-torneos$/, (ctx) => {
    const yo = ctx.exigirUsuario();
    return db.prepare(`SELECT i.*, t.fecha FROM inscripciones i
                       JOIN torneos t ON t.id = i.torneo_id
                       WHERE i.usuario_id = ? ORDER BY t.fecha DESC`).all(yo.id)
        .map((i) => ({
            inscripcion: inscripcionPublica(i),
            torneo: torneoPublico(db.prepare('SELECT * FROM torneos WHERE id = ?').get(i.torneo_id))
        }));
});

/* ---------- Resultados y premios ---------- */
ruta('POST', /^\/api\/torneos\/([\w-]+)\/resultados$/, (ctx, m) => {
    ctx.exigirAdmin();
    db.exec('BEGIN IMMEDIATE');
    try {
        const t = db.prepare('SELECT * FROM torneos WHERE id = ?').get(m[1]);
        if (!t) throw noEncontrado('Torneo no encontrado.');
        const distribucion = JSON.parse(t.distribucion);

        for (const fila of (ctx.cuerpo.filas || [])) {
            const i = db.prepare('SELECT * FROM inscripciones WHERE id = ? AND torneo_id = ?').get(fila.inscripcionId, t.id);
            if (!i) continue;

            // Si ya se pagó un premio por esta inscripción, se descuenta antes de
            // volver a pagar: así corregir un resultado no regala dinero.
            const previo = db.prepare('SELECT * FROM resultados WHERE inscripcion_id = ?').get(i.id);
            if (previo && previo.premio > 0) {
                anotar(i.usuario_id, 'ajuste', -previo.premio, { referencia: t.id, nota: 'Corrección de resultados — ' + t.nombre });
            }

            const puesto = Math.max(0, Number(fila.puesto) || 0);
            const d = distribucion.find((x) => Number(x.pos) === puesto);
            const premio = d ? Math.round(t.premio_total * d.pct / 100) : 0;

            db.prepare(`INSERT INTO resultados (inscripcion_id, puesto, kills, puntos, premio) VALUES (?,?,?,?,?)
                        ON CONFLICT(inscripcion_id) DO UPDATE SET puesto=excluded.puesto, kills=excluded.kills,
                        puntos=excluded.puntos, premio=excluded.premio`)
                .run(i.id, puesto, Math.max(0, Number(fila.kills) || 0), Math.max(0, Number(fila.puntos) || 0), premio);

            if (premio > 0) {
                anotar(i.usuario_id, 'premio', premio, { metodo: 'Saldo', referencia: t.id, nota: `Puesto #${puesto} — ${t.nombre}` });
            }
        }
        db.prepare("UPDATE torneos SET estado = 'finalizado' WHERE id = ?").run(t.id);
        db.exec('COMMIT');
        return { ok: true };
    } catch (e) {
        db.exec('ROLLBACK');
        throw e;
    }
});

/* ---------- Billetera ---------- */
ruta('GET', /^\/api\/movimientos$/, (ctx) => {
    const yo = ctx.exigirUsuario();
    return db.prepare('SELECT * FROM movimientos WHERE usuario_id = ? ORDER BY creado DESC').all(yo.id).map(movimientoPublico);
});

/* Una recarga NO acredita sola: queda en revisión hasta que el organizador
   confirma que el pago llegó. Cuando haya pasarela, esto lo confirmará su
   webhook; hasta entonces lo confirma una persona, que es como funciona hoy. */
ruta('POST', /^\/api\/recargas$/, (ctx) => {
    const yo = ctx.exigirUsuario();
    const monto = Math.round(Number(ctx.cuerpo.monto) || 0);
    if (monto < MIN_RECARGA) throw malaPeticion(`La recarga mínima es de $${MIN_RECARGA.toLocaleString('es-CO')}.`);
    const m = anotar(yo.id, 'recarga', monto, {
        estado: 'pendiente', metodo: String(ctx.cuerpo.metodo || 'Nequi').slice(0, 30),
        referencia: String(ctx.cuerpo.ref || '').slice(0, 60), nota: 'Recarga en revisión'
    });
    return movimientoPublico(m);
});

ruta('POST', /^\/api\/retiros$/, (ctx) => {
    const yo = ctx.exigirUsuario();
    db.exec('BEGIN IMMEDIATE');
    try {
        const monto = Math.round(Number(ctx.cuerpo.monto) || 0);
        const cuenta = String(ctx.cuerpo.cuenta || '').trim();
        if (monto < MIN_RETIRO) throw malaPeticion(`El retiro mínimo es de $${MIN_RETIRO.toLocaleString('es-CO')}.`);
        if (!cuenta) throw malaPeticion('Escribe el número de cuenta o celular que recibe el dinero.');
        if (saldoDe(yo.id) < monto) throw malaPeticion('No tienes saldo suficiente.');

        const m = anotar(yo.id, 'retiro', -monto, {
            estado: 'pendiente', metodo: String(ctx.cuerpo.metodo || 'Nequi').slice(0, 30),
            referencia: cuenta.slice(0, 60), nota: 'Retiro solicitado'
        });
        db.exec('COMMIT');
        return movimientoPublico(m);
    } catch (e) {
        db.exec('ROLLBACK');
        throw e;
    }
});

/* ---------- Panel del organizador ---------- */
ruta('GET', /^\/api\/admin\/pendientes$/, (ctx) => {
    ctx.exigirAdmin();
    const filas = db.prepare(`
        SELECT m.*, u.nick, u.whatsapp, u.ff_uid FROM movimientos m
        JOIN usuarios u ON u.id = m.usuario_id
        WHERE m.estado = 'pendiente' ORDER BY m.creado ASC`).all();
    return filas.map((m) => Object.assign(movimientoPublico(m), {
        nick: m.nick, whatsapp: m.whatsapp, ffUid: m.ff_uid
    }));
});

ruta('POST', /^\/api\/admin\/pendientes\/([\w-]+)$/, (ctx, m) => {
    ctx.exigirAdmin();
    const mov = db.prepare('SELECT * FROM movimientos WHERE id = ?').get(m[1]);
    if (!mov) throw noEncontrado('Movimiento no encontrado.');
    if (mov.estado !== 'pendiente') throw malaPeticion('Ese movimiento ya fue resuelto.');

    const aprobar = !!ctx.cuerpo.aprobar;
    db.prepare('UPDATE movimientos SET estado = ?, nota = ? WHERE id = ?')
        .run(aprobar ? 'completada' : 'rechazada',
             String(ctx.cuerpo.nota || (aprobar ? 'Confirmado' : 'Rechazado')).slice(0, 120), mov.id);
    return movimientoPublico(db.prepare('SELECT * FROM movimientos WHERE id = ?').get(mov.id));
});

/* ---------- Estadísticas públicas ---------- */
ruta('GET', /^\/api\/estadisticas$/, () => {
    const t = db.prepare('SELECT COUNT(*) n FROM torneos').get().n;
    const f = db.prepare("SELECT COUNT(*) n FROM torneos WHERE estado = 'finalizado'").get().n;
    const j = db.prepare('SELECT COALESCE(SUM(json_array_length(miembros)),0) n FROM inscripciones').get().n;
    const r = db.prepare('SELECT COALESCE(SUM(premio),0) n FROM resultados').get().n;
    return { torneos: t, finalizados: f, jugadores: j, repartido: r };
});

ruta('GET', /^\/api\/salud$/, () => ({ ok: true, hora: ahora() }));

/* ============================================================
   Servidor
   ============================================================ */
function cors(origen) {
    const permitido = ORIGENES.includes(origen) ? origen : ORIGENES[0];
    return {
        'Access-Control-Allow-Origin': permitido,
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin'
    };
}

const servidor = http.createServer(async (req, res) => {
    const cabeceras = Object.assign({ 'Content-Type': 'application/json; charset=utf-8' },
                                    cors(req.headers.origin || ''));
    const responder = (codigo, cuerpo) => { res.writeHead(codigo, cabeceras); res.end(JSON.stringify(cuerpo)); };

    if (req.method === 'OPTIONS') { res.writeHead(204, cabeceras); return res.end(); }

    const url = new URL(req.url, 'http://localhost');
    const r = rutas.find((x) => x.metodo === req.method && x.patron.test(url.pathname));
    if (!r) return responder(404, { error: 'Ruta no encontrada.' });

    let cuerpo = {};
    if (req.method !== 'GET' && req.method !== 'DELETE') {
        try {
            const trozos = [];
            let tam = 0;
            for await (const t of req) {
                tam += t.length;
                if (tam > 64 * 1024) throw malaPeticion('Petición demasiado grande.');
                trozos.push(t);
            }
            const texto = Buffer.concat(trozos).toString('utf8');
            cuerpo = texto ? JSON.parse(texto) : {};
        } catch (e) {
            return responder(400, { error: 'El cuerpo de la petición no es JSON válido.' });
        }
    }

    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
    let cacheUsuario;
    const ctx = {
        cuerpo, token, url,
        usuario() {
            if (cacheUsuario === undefined) cacheUsuario = usuarioDeToken(token);
            return cacheUsuario;
        },
        exigirUsuario() {
            const u = this.usuario();
            if (!u) throw noAutorizado();
            return u;
        },
        exigirAdmin() {
            const u = this.exigirUsuario();
            if (u.rol !== 'admin') throw prohibido();
            return u;
        }
    };

    try {
        const salida = r.mano(ctx, url.pathname.match(r.patron));
        responder(200, salida === undefined ? { ok: true } : salida);
    } catch (e) {
        if (e instanceof ErrorAPI) return responder(e.codigo, { error: e.message });
        console.error('Error inesperado:', e);
        responder(500, { error: 'Algo falló en el servidor.' });
    }
});

/* Cuenta de organizador: se crea sola la primera vez, con lo que digan
   las variables de entorno. Sin ellas no se crea ninguna. */
function prepararAdmin() {
    const ffUid = process.env.ADMIN_FF_UID;
    const pass = process.env.ADMIN_PASS;
    if (!ffUid || !pass) return;
    const existe = db.prepare('SELECT * FROM usuarios WHERE ff_uid = ?').get(String(ffUid));
    if (existe) {
        if (existe.rol !== 'admin') db.prepare("UPDATE usuarios SET rol = 'admin' WHERE id = ?").run(existe.id);
        return;
    }
    const { hash, sal } = hashPass(pass);
    db.prepare(`INSERT INTO usuarios (id, ff_uid, nick, nivel, region, email, whatsapp, pass_hash, pass_sal, rol, verificado, creado)
                VALUES (?,?,?,0,'us','', ?, ?, ?, 'admin', 1, ?)`)
        .run(uid('u'), String(ffUid), process.env.ADMIN_NICK || 'ORGANIZADOR',
             process.env.ADMIN_WHATSAPP || '573000000000', hash, sal, ahora());
    console.log('  Cuenta de organizador creada para el ID', ffUid);
}

if (require.main === module) {
    prepararAdmin();
    servidor.listen(PUERTO, () => {
        console.log(`\n  API de Torneos FF en http://localhost:${PUERTO}/api`);
        console.log(`  Orígenes permitidos: ${ORIGENES.join(', ')}\n`);
    });
}

module.exports = { servidor, prepararAdmin };
