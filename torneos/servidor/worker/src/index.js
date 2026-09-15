/* ============================================================
   Torneos FF — API en Cloudflare Workers + D1
   ------------------------------------------------------------
   Misma interfaz que la versión de Node: el navegador no nota
   la diferencia.

   La diferencia grande está por dentro: D1 no tiene transacciones
   abiertas (no se puede "empezar, mirar, decidir y confirmar").
   Solo tiene lotes atómicos. Así que todo lo que toca dinero se
   escribe como SQL con guardas: la fila solo entra SI el cupo
   alcanza Y el saldo alcanza. Si otra persona se inscribió un
   milisegundo antes, la guarda falla y no se cobra nada.
   ============================================================ */

import { uid, ahora, hashPass, verificarPass, aleatorio, sha256 } from './cripto.js';
import * as wompi from './wompi.js';

const CUPO_POR_MODO = { solo: 1, duo: 2, escuadra: 4 };
const REGLAS_MODO = {
    solo:     { costo: 5000, minimo: 20, precioKill: 3000, premioGanador: 10000 },
    duo:      { costo: 5000, minimo: 5,  precioKill: 3000, premioGanador: 15000 },
    escuadra: { costo: 5000, minimo: 10, precioKill: 3500, premioGanador: 0 }
};

/* Suma del libro: lo pendiente solo cuenta si RESTA (un retiro sin pagar
   reserva el dinero). Una recarga sin confirmar no suma. */
const SQL_SALDO = `(SELECT COALESCE(SUM(monto),0) FROM movimientos
                    WHERE usuario_id = ?
                      AND (estado = 'completada' OR (estado = 'pendiente' AND monto < 0)))`;

class ErrorAPI extends Error {
    constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; }
}
const malaPeticion = (m) => new ErrorAPI(400, m);
const noAutorizado = (m) => new ErrorAPI(401, m || 'Inicia sesión.');
const prohibido = () => new ErrorAPI(403, 'Esta acción es solo para administradores.');
const noEncontrado = (m) => new ErrorAPI(404, m || 'No encontrado.');

/* ===== Salidas ===== */
async function usuarioPublico(env, u) {
    if (!u) return null;
    const s = await env.DB.prepare(`SELECT ${SQL_SALDO} AS saldo`).bind(u.id).first();
    return {
        id: u.id, ffUid: u.ff_uid, nick: u.nick, nivel: u.nivel, region: u.region,
        email: u.email || '', whatsapp: u.whatsapp, rol: u.rol,
        verificado: !!u.verificado, perfil: u.perfil ? JSON.parse(u.perfil) : null,
        saldo: Number(s?.saldo) || 0, creado: u.creado
    };
}

function torneoPublico(t, cuenta, extras) {
    return Object.assign({
        id: t.id, nombre: t.nombre, modo: t.modo, fecha: t.fecha,
        cupoMax: t.cupo_max, costo: t.costo, premioTotal: t.premio_total,
        precioKill: t.precio_kill, premioGanador: t.premio_ganador, minimo: t.minimo,
        distribucion: JSON.parse(t.distribucion || '[]'), mapa: t.mapa,
        reglas: JSON.parse(t.reglas || '[]'), estado: t.estado, tema: t.tema,
        encuesta: t.encuesta ? JSON.parse(t.encuesta) : null,
        inscritos: cuenta?.n || 0, jugadores: cuenta?.j || 0,
        sala: { id: '', pass: '', publicada: !!t.sala_publicada }
    }, extras || {});
}

const inscripcionPublica = (i) => ({
    id: i.id, torneoId: i.torneo_id, userId: i.usuario_id,
    equipo: { nombre: i.equipo, miembros: JSON.parse(i.miembros) },
    estado: i.estado, creado: i.creado,
    resultado: i.puesto === null || i.puesto === undefined ? null
        : { puesto: i.puesto, kills: i.kills, puntos: i.puntos, premio: i.premio }
});

const movimientoPublico = (m) => ({
    id: m.id, userId: m.usuario_id, tipo: m.tipo, monto: m.monto, estado: m.estado,
    metodo: m.metodo, ref: m.referencia, nota: m.nota, creado: m.creado
});

const insertarMovimiento = (env, id, usuarioId, tipo, monto, e = {}) =>
    env.DB.prepare(`INSERT INTO movimientos (id, usuario_id, tipo, monto, estado, metodo, referencia, nota, creado)
                    VALUES (?,?,?,?,?,?,?,?,?)`)
        .bind(id, usuarioId, tipo, Math.round(monto), e.estado || 'completada',
              e.metodo || '', e.referencia || '', e.nota || '', ahora());

/* ============================================================
   Freno a la fuerza bruta
   ------------------------------------------------------------
   Cinco intentos fallidos y la cuenta queda bloqueada 15 minutos.
   Se cuenta por cuenta Y por dirección de internet: lo primero
   protege al jugador, lo segundo evita que alguien pruebe miles
   de cuentas distintas desde el mismo sitio.
   ============================================================ */
const MAX_FALLOS = 5;
const BLOQUEO_MIN = 15;
const VENTANA_MIN = 15;

async function comprobarBloqueo(env, claves) {
    for (const clave of claves) {
        const r = await env.DB.prepare('SELECT * FROM intentos WHERE clave = ?').bind(clave).first();
        if (r?.bloqueado_hasta && new Date(r.bloqueado_hasta) > new Date()) {
            const minutos = Math.max(1, Math.ceil((new Date(r.bloqueado_hasta) - Date.now()) / 60000));
            throw new ErrorAPI(429, `Demasiados intentos fallidos. Espera ${minutos} minuto(s) y vuelve a probar.`);
        }
    }
}

async function anotarFallo(env, claves) {
    const ahoraMs = Date.now();
    for (const clave of claves) {
        const r = await env.DB.prepare('SELECT * FROM intentos WHERE clave = ?').bind(clave).first();
        // Si el último fallo fue hace rato, se empieza a contar de nuevo
        const dentroDeVentana = r && (ahoraMs - new Date(r.desde).getTime()) < VENTANA_MIN * 60000;
        const fallos = (dentroDeVentana ? r.fallos : 0) + 1;
        const bloqueo = fallos >= MAX_FALLOS ? new Date(ahoraMs + BLOQUEO_MIN * 60000).toISOString() : null;

        await env.DB.prepare(`INSERT INTO intentos (clave, fallos, desde, bloqueado_hasta) VALUES (?,?,?,?)
                              ON CONFLICT(clave) DO UPDATE SET fallos = excluded.fallos,
                                  desde = excluded.desde, bloqueado_hasta = excluded.bloqueado_hasta`)
            .bind(clave, fallos, dentroDeVentana ? r.desde : new Date(ahoraMs).toISOString(), bloqueo).run();
    }
}

const limpiarIntentos = (env, claves) =>
    env.DB.batch(claves.map((c) => env.DB.prepare('DELETE FROM intentos WHERE clave = ?').bind(c)));

/* El código que el jugador debe poner en su biografía del juego */
function codigoVerificacion(ffUid) {
    const suma = String(ffUid).split('').reduce((a, c) => a + Number(c), 0);
    return 'FF-' + (1000 + (suma * 37) % 8999);
}

/* ===== Rutas ===== */
const rutas = [];
const ruta = (metodo, patron, mano) => rutas.push({ metodo, patron, mano });

/* ---------- Cuenta ---------- */
ruta('POST', /^\/api\/auth\/registro$/, async (c) => {
    const { ffUid, nick, nivel, region, email, whatsapp, pass, perfil } = c.cuerpo;
    if (!/^\d{6,14}$/.test(String(ffUid || ''))) throw malaPeticion('El ID de Free Fire son solo números (entre 6 y 14 dígitos).');
    if (!nick || !String(nick).trim()) throw malaPeticion('Escribe tu nick del juego.');
    if (!pass || pass.length < 6) throw malaPeticion('La contraseña debe tener al menos 6 caracteres.');
    if (!/^\d{10,13}$/.test(String(whatsapp || '').replace(/\D/g, ''))) throw malaPeticion('Escribe un número de WhatsApp válido (con indicativo).');

    const existe = await c.env.DB.prepare('SELECT 1 FROM usuarios WHERE ff_uid = ?').bind(String(ffUid)).first();
    if (existe) throw malaPeticion('Ese ID de Free Fire ya está registrado.');

    const { hash, sal } = await hashPass(pass);
    const id = uid('u');
    await c.env.DB.prepare(`INSERT INTO usuarios (id, ff_uid, nick, nivel, region, email, whatsapp, pass_hash, pass_sal, rol, verificado, perfil, creado)
                            VALUES (?,?,?,?,?,?,?,?,?,'jugador',0,?,?)`)
        .bind(id, String(ffUid), String(nick).trim(), Number(nivel) || 0, region || 'us',
              email || '', String(whatsapp).replace(/\D/g, ''), hash, sal,
              perfil ? JSON.stringify(perfil) : null, ahora()).run();

    const u = await c.env.DB.prepare('SELECT * FROM usuarios WHERE id = ?').bind(id).first();
    return { token: await crearSesion(c.env, id), usuario: await usuarioPublico(c.env, u) };
});

ruta('POST', /^\/api\/auth\/login$/, async (c) => {
    const q = String(c.cuerpo.usuario || '').trim().toLowerCase();
    const claves = ['login:' + q, 'ip:' + c.ip];
    await comprobarBloqueo(c.env, claves);

    const u = await c.env.DB.prepare('SELECT * FROM usuarios WHERE ff_uid = ? OR lower(email) = ?').bind(q, q).first();
    if (!u || !(await verificarPass(String(c.cuerpo.pass || ''), u.pass_hash, u.pass_sal))) {
        await anotarFallo(c.env, claves);
        throw new ErrorAPI(401, 'ID/correo o contraseña incorrectos.');
    }
    await limpiarIntentos(c.env, claves);

    return {
        token: await crearSesion(c.env, u.id),
        usuario: await usuarioPublico(c.env, u),
        debeCambiar: !!u.debe_cambiar
    };
});

/* ---------- Cambiar la contraseña ---------- */
ruta('POST', /^\/api\/auth\/cambiar-pass$/, async (c) => {
    const yo = await c.exigirUsuario();
    const nueva = String(c.cuerpo.nueva || '');
    if (nueva.length < 6) throw malaPeticion('La contraseña nueva debe tener al menos 6 caracteres.');

    /* Con contraseña temporal no se pide la anterior: justamente no la
       recuerda. En cualquier otro caso sí, para que nadie cambie la clave
       de una sesión que dejó abierta en un computador ajeno. */
    if (!yo.debe_cambiar) {
        const actual = String(c.cuerpo.actual || '');
        if (!(await verificarPass(actual, yo.pass_hash, yo.pass_sal))) {
            throw malaPeticion('La contraseña actual no es correcta.');
        }
    }

    const { hash, sal } = await hashPass(nueva);
    await c.env.DB.batch([
        c.env.DB.prepare('UPDATE usuarios SET pass_hash = ?, pass_sal = ?, debe_cambiar = 0 WHERE id = ?')
            .bind(hash, sal, yo.id),
        // Se cierran las demás sesiones: si alguien más había entrado, queda fuera
        c.env.DB.prepare('DELETE FROM sesiones WHERE usuario_id = ? AND token_hash != ?')
            .bind(yo.id, await sha256(c.token))
    ]);
    return { ok: true };
});

/* ---------- Recuperar la contraseña ----------
   Sin correo: el jugador pide ayuda, el organizador le genera una
   temporal y se la manda por WhatsApp. */
ruta('POST', /^\/api\/auth\/recuperar$/, async (c) => {
    const clave = ['recuperar:' + c.ip];
    await comprobarBloqueo(c.env, clave);
    await anotarFallo(c.env, clave);      // aquí cada intento cuenta, salga o no

    const q = String(c.cuerpo.usuario || '').trim().toLowerCase();
    const u = await c.env.DB.prepare('SELECT * FROM usuarios WHERE ff_uid = ? OR lower(email) = ? OR whatsapp = ?')
        .bind(q, q, q.replace(/\D/g, '')).first();

    /* Respuesta igual exista o no la cuenta: si no, esto sirve para
       averiguar qué IDs están registrados. */
    if (u) {
        const yaHay = await c.env.DB.prepare("SELECT 1 FROM recuperaciones WHERE usuario_id = ? AND estado = 'pendiente'")
            .bind(u.id).first();
        if (!yaHay) {
            await c.env.DB.prepare('INSERT INTO recuperaciones (id, usuario_id, estado, creado) VALUES (?,?,?,?)')
                .bind(uid('rec'), u.id, 'pendiente', ahora()).run();
        }
    }
    return { ok: true, mensaje: 'Si esa cuenta existe, el organizador la va a contactar por WhatsApp.' };
});

/* ---------- Verificación de cuenta ---------- */
ruta('POST', /^\/api\/verificaciones$/, async (c) => {
    const yo = await c.exigirUsuario();
    if (yo.verificado) throw malaPeticion('Tu cuenta ya está verificada.');

    const yaHay = await c.env.DB.prepare("SELECT 1 FROM verificaciones WHERE usuario_id = ? AND estado = 'pendiente'")
        .bind(yo.id).first();
    if (yaHay) throw malaPeticion('Ya tienes una solicitud en revisión.');

    await c.env.DB.prepare('INSERT INTO verificaciones (id, usuario_id, codigo, estado, creado) VALUES (?,?,?,?,?)')
        .bind(uid('ver'), yo.id, codigoVerificacion(yo.ff_uid), 'pendiente', ahora()).run();
    return { ok: true, codigo: codigoVerificacion(yo.ff_uid) };
});

ruta('GET', /^\/api\/mi-verificacion$/, async (c) => {
    const yo = await c.exigirUsuario();
    const v = await c.env.DB.prepare('SELECT * FROM verificaciones WHERE usuario_id = ? ORDER BY creado DESC LIMIT 1')
        .bind(yo.id).first();
    return {
        verificado: !!yo.verificado,
        codigo: codigoVerificacion(yo.ff_uid),
        solicitud: v ? { estado: v.estado, creado: v.creado, nota: v.nota } : null
    };
});

ruta('POST', /^\/api\/auth\/logout$/, async (c) => {
    if (c.token) {
        await c.env.DB.prepare('DELETE FROM sesiones WHERE token_hash = ?').bind(await sha256(c.token)).run();
    }
    return { ok: true };
});

ruta('GET', /^\/api\/yo$/, async (c) => usuarioPublico(c.env, await c.exigirUsuario()));

async function crearSesion(env, usuarioId) {
    const token = aleatorio(32);
    await env.DB.prepare('INSERT INTO sesiones (token_hash, usuario_id, creado, expira) VALUES (?,?,?,?)')
        .bind(await sha256(token), usuarioId, ahora(), new Date(Date.now() + 30 * 864e5).toISOString()).run();
    return token;
}

/* ---------- Torneos ---------- */
ruta('GET', /^\/api\/torneos$/, async (c) => {
    const { results } = await c.env.DB.prepare(`
        SELECT t.*, (SELECT COUNT(*) FROM inscripciones i WHERE i.torneo_id = t.id) AS n,
               (SELECT COALESCE(SUM(json_array_length(i.miembros)),0) FROM inscripciones i WHERE i.torneo_id = t.id) AS j
        FROM torneos t ORDER BY t.fecha ASC`).all();
    return (results || []).map((t) => torneoPublico(t, t));
});

ruta('GET', /^\/api\/torneos\/([\w-]+)$/, async (c, m) => {
    const t = await c.env.DB.prepare('SELECT * FROM torneos WHERE id = ?').bind(m[1]).first();
    if (!t) throw noEncontrado('Torneo no encontrado.');

    const { results } = await c.env.DB.prepare(`
        SELECT i.*, r.puesto, r.kills, r.puntos, r.premio
        FROM inscripciones i LEFT JOIN resultados r ON r.inscripcion_id = i.id
        WHERE i.torneo_id = ? ORDER BY i.creado ASC`).bind(t.id).all();

    const participantes = (results || []).map(inscripcionPublica);
    const yo = await c.usuario();
    const mia = yo ? participantes.find((p) => p.userId === yo.id) || null : null;

    const salida = torneoPublico(t, {
        n: participantes.length,
        j: participantes.reduce((a, p) => a + p.equipo.miembros.length, 0)
    }, { participantes, miInscripcion: mia });

    // La sala solo viaja a quien tiene derecho a verla.
    if (t.sala_publicada && (mia || yo?.rol === 'admin')) {
        salida.sala = { id: t.sala_id, pass: t.sala_pass, publicada: true };
    }
    return salida;
});

ruta('POST', /^\/api\/torneos$/, async (c) => {
    await c.exigirAdmin();
    const d = c.cuerpo;
    if (!d.nombre || !String(d.nombre).trim()) throw malaPeticion('Ponle un nombre al torneo.');
    if (!d.fecha) throw malaPeticion('Falta la fecha y hora.');
    if (!CUPO_POR_MODO[d.modo]) throw malaPeticion('Modo inválido.');

    const base = REGLAS_MODO[d.modo];
    const num = (v, pd) => (v === undefined || v === null || v === '' ? pd : Math.max(0, Math.round(Number(v) || 0)));
    const id = uid('t');

    await c.env.DB.prepare(`INSERT INTO torneos (id, nombre, modo, fecha, cupo_max, costo, premio_total, distribucion,
                                                 precio_kill, premio_ganador, minimo, mapa, reglas, estado, tema, creado)
                            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'abierto',?,?)`)
        .bind(id, String(d.nombre).trim(), d.modo, d.fecha, num(d.cupoMax, 48),
              num(d.costo, base.costo), num(d.premioTotal, 0), JSON.stringify(d.distribucion || []),
              num(d.precioKill, base.precioKill), num(d.premioGanador, base.premioGanador),
              num(d.minimo, base.minimo), d.mapa || 'Bermuda',
              JSON.stringify(Array.isArray(d.reglas) ? d.reglas : []), d.tema || 'fuego', ahora()).run();

    const t = await c.env.DB.prepare('SELECT * FROM torneos WHERE id = ?').bind(id).first();
    return torneoPublico(t, { n: 0, j: 0 });
});

ruta('PATCH', /^\/api\/torneos\/([\w-]+)$/, async (c, m) => {
    await c.exigirAdmin();
    const t = await c.env.DB.prepare('SELECT * FROM torneos WHERE id = ?').bind(m[1]).first();
    if (!t) throw noEncontrado('Torneo no encontrado.');
    const d = c.cuerpo;

    const cuenta = await c.env.DB.prepare('SELECT COUNT(*) n FROM inscripciones WHERE torneo_id = ?').bind(t.id).first();
    if (d.modo && d.modo !== t.modo && cuenta.n > 0) {
        throw malaPeticion('No se puede cambiar el modo con gente ya inscrita. Cancela el torneo o crea otro.');
    }

    const campos = {
        nombre: (v) => String(v).trim().slice(0, 120),
        modo: (v) => (CUPO_POR_MODO[v] ? v : t.modo),
        fecha: (v) => String(v),
        cupo_max: (v) => Math.max(1, Math.round(Number(v) || 0)),
        costo: (v) => Math.max(0, Math.round(Number(v) || 0)),
        precio_kill: (v) => Math.max(0, Math.round(Number(v) || 0)),
        premio_ganador: (v) => Math.max(0, Math.round(Number(v) || 0)),
        minimo: (v) => Math.max(0, Math.round(Number(v) || 0)),
        mapa: (v) => String(v).slice(0, 40),
        tema: (v) => String(v).slice(0, 20),
        estado: (v) => String(v).slice(0, 20),
        reglas: (v) => JSON.stringify(Array.isArray(v) ? v : String(v).split('\n').map((x) => x.trim()).filter(Boolean)),
        encuesta: (v) => (v ? JSON.stringify(v) : null)
    };
    const alias = { cupoMax: 'cupo_max', precioKill: 'precio_kill', premioGanador: 'premio_ganador' };

    const lote = [];
    for (const clave of Object.keys(d)) {
        const col = alias[clave] || clave;
        if (!campos[col]) continue;
        lote.push(c.env.DB.prepare(`UPDATE torneos SET ${col} = ? WHERE id = ?`).bind(campos[col](d[clave]), t.id));
    }
    if (lote.length) await c.env.DB.batch(lote);

    const t2 = await c.env.DB.prepare('SELECT * FROM torneos WHERE id = ?').bind(t.id).first();
    return torneoPublico(t2, cuenta ? { n: cuenta.n, j: 0 } : null);
});

ruta('POST', /^\/api\/torneos\/([\w-]+)\/sala$/, async (c, m) => {
    await c.exigirAdmin();
    const { salaId, pass } = c.cuerpo;
    if (!salaId || !pass) throw malaPeticion('Escribe el ID y la contraseña de la sala.');
    const r = await c.env.DB.prepare("UPDATE torneos SET sala_id = ?, sala_pass = ?, sala_publicada = 1, estado = 'en_curso' WHERE id = ?")
        .bind(String(salaId), String(pass), m[1]).run();
    if (!r.meta.changes) throw noEncontrado('Torneo no encontrado.');
    return { ok: true };
});

ruta('POST', /^\/api\/torneos\/([\w-]+)\/cancelar$/, async (c, m) => {
    await c.exigirAdmin();
    const t = await c.env.DB.prepare('SELECT * FROM torneos WHERE id = ?').bind(m[1]).first();
    if (!t) throw noEncontrado('Torneo no encontrado.');
    if (t.estado === 'cancelado') throw malaPeticion('Ese torneo ya está cancelado.');

    const { results } = await c.env.DB.prepare('SELECT * FROM inscripciones WHERE torneo_id = ?').bind(t.id).all();
    const lote = (results || []).map((i) => {
        const devolver = t.costo * JSON.parse(i.miembros).length;
        return insertarMovimiento(c.env, uid('tx'), i.usuario_id, 'reembolso', devolver,
            { metodo: 'Saldo', referencia: t.id, nota: 'Torneo cancelado — ' + t.nombre });
    });
    lote.push(c.env.DB.prepare("UPDATE torneos SET estado = 'cancelado' WHERE id = ?").bind(t.id));
    await c.env.DB.batch(lote);
    return { ok: true, devueltos: (results || []).length };
});

/* ---------- Inscripción: el punto delicado ---------- */
ruta('POST', /^\/api\/torneos\/([\w-]+)\/inscripciones$/, async (c, m) => {
    const yo = await c.exigirUsuario();
    const t = await c.env.DB.prepare('SELECT * FROM torneos WHERE id = ?').bind(m[1]).first();
    if (!t) throw noEncontrado('Torneo no encontrado.');
    if (t.estado !== 'abierto') throw malaPeticion('Las inscripciones de este torneo están cerradas.');

    const requeridos = CUPO_POR_MODO[t.modo];
    const miembros = (c.cuerpo.equipo?.miembros || [])
        .filter((x) => x && x.nick && String(x.nick).trim())
        .map((x) => ({ nick: String(x.nick).trim().slice(0, 30), uid: String(x.uid || '').replace(/\D/g, '').slice(0, 14) }));
    if (miembros.length !== requeridos) throw malaPeticion(`Este torneo necesita ${requeridos} jugador(es).`);

    const total = t.costo * requeridos;
    const idIns = uid('i');
    const idTx = uid('tx');
    const nombreEquipo = String(c.cuerpo.equipo?.nombre || yo.nick).slice(0, 40);

    /* Las tres condiciones viajan DENTRO del INSERT. Si entre la consulta y
       la escritura alguien más se inscribe o el saldo cambia, la fila
       sencillamente no entra y no se cobra nada. El cobro va en el mismo
       lote y solo ocurre si la inscripción existe. */
    const lote = await c.env.DB.batch([
        c.env.DB.prepare(`
            INSERT INTO inscripciones (id, torneo_id, usuario_id, equipo, miembros, estado, creado)
            SELECT ?, ?, ?, ?, ?, 'confirmada', ?
            WHERE (SELECT COUNT(*) FROM inscripciones WHERE torneo_id = ?) < (SELECT cupo_max FROM torneos WHERE id = ?)
              AND NOT EXISTS (SELECT 1 FROM inscripciones WHERE torneo_id = ? AND usuario_id = ?)
              AND ${SQL_SALDO} >= ?`)
            .bind(idIns, t.id, yo.id, nombreEquipo, JSON.stringify(miembros), ahora(),
                  t.id, t.id, t.id, yo.id, yo.id, total),

        c.env.DB.prepare(`
            INSERT INTO movimientos (id, usuario_id, tipo, monto, estado, metodo, referencia, nota, creado)
            SELECT ?, ?, 'inscripcion', ?, 'completada', 'Saldo', ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM inscripciones WHERE id = ?)`)
            .bind(idTx, yo.id, -total, t.id, t.nombre, ahora(), idIns),

        c.env.DB.prepare(`
            UPDATE torneos SET estado = 'lleno'
            WHERE id = ? AND estado = 'abierto'
              AND (SELECT COUNT(*) FROM inscripciones WHERE torneo_id = ?) >= cupo_max`)
            .bind(t.id, t.id)
    ]);

    if (!lote[0].meta.changes) {
        // No entró: hay que decirle al jugador por qué.
        const ya = await c.env.DB.prepare('SELECT 1 FROM inscripciones WHERE torneo_id = ? AND usuario_id = ?').bind(t.id, yo.id).first();
        if (ya) throw malaPeticion('Ya estás inscrito en este torneo.');
        const n = await c.env.DB.prepare('SELECT COUNT(*) n FROM inscripciones WHERE torneo_id = ?').bind(t.id).first();
        if (n.n >= t.cupo_max) throw malaPeticion('Ya no quedan cupos.');
        throw malaPeticion('Saldo insuficiente. Recarga en tu billetera.');
    }

    const i = await c.env.DB.prepare('SELECT * FROM inscripciones WHERE id = ?').bind(idIns).first();
    return inscripcionPublica(i);
});

ruta('DELETE', /^\/api\/torneos\/([\w-]+)\/inscripciones$/, async (c, m) => {
    const yo = await c.exigirUsuario();
    const t = await c.env.DB.prepare('SELECT * FROM torneos WHERE id = ?').bind(m[1]).first();
    if (!t) throw noEncontrado('Torneo no encontrado.');
    if (t.sala_publicada) throw malaPeticion('La sala ya fue publicada: no se puede cancelar.');

    const i = await c.env.DB.prepare('SELECT * FROM inscripciones WHERE torneo_id = ? AND usuario_id = ?').bind(t.id, yo.id).first();
    if (!i) throw malaPeticion('No estás inscrito en este torneo.');

    const devolver = t.costo * JSON.parse(i.miembros).length;
    await c.env.DB.batch([
        c.env.DB.prepare('DELETE FROM inscripciones WHERE id = ?').bind(i.id),
        insertarMovimiento(c.env, uid('tx'), yo.id, 'reembolso', devolver,
            { metodo: 'Saldo', referencia: t.id, nota: 'Cancelación — ' + t.nombre }),
        c.env.DB.prepare("UPDATE torneos SET estado = 'abierto' WHERE id = ? AND estado = 'lleno'").bind(t.id)
    ]);
    return { ok: true };
});

ruta('GET', /^\/api\/mis-torneos$/, async (c) => {
    const yo = await c.exigirUsuario();
    const { results } = await c.env.DB.prepare(`
        SELECT i.*, r.puesto, r.kills, r.puntos, r.premio, t.id AS t_id
        FROM inscripciones i
        JOIN torneos t ON t.id = i.torneo_id
        LEFT JOIN resultados r ON r.inscripcion_id = i.id
        WHERE i.usuario_id = ? ORDER BY t.fecha DESC`).bind(yo.id).all();

    const salida = [];
    for (const fila of results || []) {
        const t = await c.env.DB.prepare(`
            SELECT t.*, (SELECT COUNT(*) FROM inscripciones i WHERE i.torneo_id = t.id) AS n,
                   (SELECT COALESCE(SUM(json_array_length(i.miembros)),0) FROM inscripciones i WHERE i.torneo_id = t.id) AS j
            FROM torneos t WHERE t.id = ?`).bind(fila.t_id).first();
        salida.push({ inscripcion: inscripcionPublica(fila), torneo: torneoPublico(t, t) });
    }
    return salida;
});

/* ---------- Resultados ---------- */
ruta('POST', /^\/api\/torneos\/([\w-]+)\/resultados$/, async (c, m) => {
    await c.exigirAdmin();
    const t = await c.env.DB.prepare('SELECT * FROM torneos WHERE id = ?').bind(m[1]).first();
    if (!t) throw noEncontrado('Torneo no encontrado.');

    const lote = [];
    for (const fila of c.cuerpo.filas || []) {
        const i = await c.env.DB.prepare('SELECT * FROM inscripciones WHERE id = ? AND torneo_id = ?')
            .bind(fila.inscripcionId, t.id).first();
        if (!i) continue;

        // Si ya se había pagado un premio, se descuenta antes de pagar el nuevo:
        // corregir un resultado no puede regalar dinero.
        const previo = await c.env.DB.prepare('SELECT * FROM resultados WHERE inscripcion_id = ?').bind(i.id).first();
        if (previo?.premio > 0) {
            lote.push(insertarMovimiento(c.env, uid('tx'), i.usuario_id, 'ajuste', -previo.premio,
                { referencia: t.id, nota: 'Corrección de resultados — ' + t.nombre }));
        }

        const puesto = Math.max(0, Number(fila.puesto) || 0);
        const kills = Math.max(0, Number(fila.kills) || 0);
        const premio = kills * t.precio_kill + (puesto === 1 ? t.premio_ganador : 0);

        lote.push(c.env.DB.prepare(`
            INSERT INTO resultados (inscripcion_id, puesto, kills, puntos, premio) VALUES (?,?,?,?,?)
            ON CONFLICT(inscripcion_id) DO UPDATE SET puesto=excluded.puesto, kills=excluded.kills,
                puntos=excluded.puntos, premio=excluded.premio`)
            .bind(i.id, puesto, kills, Math.max(0, Number(fila.puntos) || 0), premio));

        if (premio > 0) {
            lote.push(insertarMovimiento(c.env, uid('tx'), i.usuario_id, 'premio', premio,
                { metodo: 'Saldo', referencia: t.id, nota: `Puesto #${puesto} — ${t.nombre}` }));
        }
    }
    lote.push(c.env.DB.prepare("UPDATE torneos SET estado = 'finalizado' WHERE id = ?").bind(t.id));
    await c.env.DB.batch(lote);
    return { ok: true };
});

/* ---------- Billetera ---------- */
ruta('GET', /^\/api\/movimientos$/, async (c) => {
    const yo = await c.exigirUsuario();
    const { results } = await c.env.DB.prepare('SELECT * FROM movimientos WHERE usuario_id = ? ORDER BY creado DESC')
        .bind(yo.id).all();
    return (results || []).map(movimientoPublico);
});

ruta('POST', /^\/api\/recargas$/, async (c) => {
    const yo = await c.exigirUsuario();
    const min = Number(c.env.MIN_RECARGA || 1000);
    const monto = Math.round(Number(c.cuerpo.monto) || 0);
    if (monto < min) throw malaPeticion(`La recarga mínima es de $${min.toLocaleString('es-CO')}.`);

    const conPasarela = wompi.configurado(c.env);
    const id = uid('tx');
    const referencia = conPasarela ? wompi.referenciaDe(id) : String(c.cuerpo.ref || '').slice(0, 60);

    await insertarMovimiento(c.env, id, yo.id, 'recarga', monto, {
        estado: 'pendiente',
        metodo: conPasarela ? 'Wompi' : String(c.cuerpo.metodo || 'Nequi').slice(0, 30),
        referencia,
        nota: conPasarela ? 'Esperando el pago' : 'Recarga en revisión'
    }).run();

    const mov = await c.env.DB.prepare('SELECT * FROM movimientos WHERE id = ?').bind(id).first();
    const salida = { movimiento: movimientoPublico(mov) };
    if (conPasarela) {
        salida.checkout = await wompi.checkout(c.env, referencia, monto,
            { email: yo.email, telefono: yo.whatsapp, nombre: yo.nick });
    }
    return salida;
});

ruta('POST', /^\/api\/retiros$/, async (c) => {
    const yo = await c.exigirUsuario();
    const min = Number(c.env.MIN_RETIRO || 10000);
    const monto = Math.round(Number(c.cuerpo.monto) || 0);
    const cuenta = String(c.cuerpo.cuenta || '').trim();
    if (monto < min) throw malaPeticion(`El retiro mínimo es de $${min.toLocaleString('es-CO')}.`);
    if (!cuenta) throw malaPeticion('Escribe el número de cuenta o celular que recibe el dinero.');

    /* Para jugar basta con registrarse; para SACAR dinero hay que tener la
       cuenta verificada. Es la barrera que evita que alguien cobre con una
       cuenta inventada o con el ID de otro. */
    if (!yo.verificado) {
        throw malaPeticion('Para retirar necesitas verificar tu cuenta. Entra a tu perfil y pide la verificación: toma un minuto.');
    }

    const id = uid('tx');
    /* La guarda del saldo va dentro del INSERT, igual que en la inscripción:
       dos retiros pedidos a la vez no pueden sacar más de lo que hay. */
    const r = await c.env.DB.prepare(`
        INSERT INTO movimientos (id, usuario_id, tipo, monto, estado, metodo, referencia, nota, creado)
        SELECT ?, ?, 'retiro', ?, 'pendiente', ?, ?, 'Retiro solicitado', ?
        WHERE ${SQL_SALDO} >= ?`)
        .bind(id, yo.id, -monto, String(c.cuerpo.metodo || 'Nequi').slice(0, 30), cuenta.slice(0, 60), ahora(), yo.id, monto)
        .run();

    if (!r.meta.changes) throw malaPeticion('No tienes saldo suficiente.');
    const mov = await c.env.DB.prepare('SELECT * FROM movimientos WHERE id = ?').bind(id).first();
    return movimientoPublico(mov);
});

/* ---------- Eventos de Wompi ---------- */
ruta('POST', /^\/api\/wompi\/eventos$/, async (c) => {
    const revision = await wompi.eventoValido(c.env, c.cuerpo);
    if (!revision.ok) throw new ErrorAPI(401, revision.razon);

    const tx = c.cuerpo?.data?.transaction || {};
    const referencia = String(tx.reference || '');
    if (!referencia) return { ok: true, nota: 'Evento sin referencia, se ignora.' };

    const mov = await c.env.DB.prepare("SELECT * FROM movimientos WHERE referencia = ? AND tipo = 'recarga'")
        .bind(referencia).first();
    if (!mov) return { ok: true, nota: 'No hay ninguna recarga con esa referencia.' };
    if (mov.estado !== 'pendiente') return { ok: true, nota: 'Esa recarga ya estaba resuelta.' };

    if (Number(tx.amount_in_cents || 0) !== Math.round(mov.monto) * 100) {
        await c.env.DB.prepare("UPDATE movimientos SET estado = 'rechazada', nota = ? WHERE id = ? AND estado = 'pendiente'")
            .bind('El monto pagado no coincide con el solicitado', mov.id).run();
        return { ok: true, nota: 'El monto no coincide.' };
    }

    const estado = String(tx.status || '').toUpperCase();
    // El "AND estado = 'pendiente'" hace que un evento repetido no cambie nada.
    if (estado === 'APPROVED') {
        await c.env.DB.prepare("UPDATE movimientos SET estado = 'completada', nota = ?, metodo = ? WHERE id = ? AND estado = 'pendiente'")
            .bind('Pago aprobado por Wompi', String(tx.payment_method_type || 'Wompi').slice(0, 30), mov.id).run();
    } else if (['DECLINED', 'VOIDED', 'ERROR'].includes(estado)) {
        await c.env.DB.prepare("UPDATE movimientos SET estado = 'rechazada', nota = ? WHERE id = ? AND estado = 'pendiente'")
            .bind('Pago ' + estado.toLowerCase() + ' en Wompi', mov.id).run();
    }
    return { ok: true };
});

/* ---------- Panel ---------- */
ruta('GET', /^\/api\/admin\/pendientes$/, async (c) => {
    await c.exigirAdmin();
    const { results } = await c.env.DB.prepare(`
        SELECT m.*, u.nick, u.whatsapp, u.ff_uid FROM movimientos m
        JOIN usuarios u ON u.id = m.usuario_id
        WHERE m.estado = 'pendiente' ORDER BY m.creado ASC`).all();
    return (results || []).map((m) => Object.assign(movimientoPublico(m),
        { nick: m.nick, whatsapp: m.whatsapp, ffUid: m.ff_uid }));
});

ruta('POST', /^\/api\/admin\/pendientes\/([\w-]+)$/, async (c, m) => {
    await c.exigirAdmin();
    const aprobar = !!c.cuerpo.aprobar;
    const r = await c.env.DB.prepare("UPDATE movimientos SET estado = ?, nota = ? WHERE id = ? AND estado = 'pendiente'")
        .bind(aprobar ? 'completada' : 'rechazada',
              String(c.cuerpo.nota || (aprobar ? 'Confirmado' : 'Rechazado')).slice(0, 120), m[1]).run();
    if (!r.meta.changes) throw malaPeticion('Ese movimiento no existe o ya fue resuelto.');
    const mov = await c.env.DB.prepare('SELECT * FROM movimientos WHERE id = ?').bind(m[1]).first();
    return movimientoPublico(mov);
});

/* ---------- Panel: recuperaciones y verificaciones ---------- */
ruta('GET', /^\/api\/admin\/recuperaciones$/, async (c) => {
    await c.exigirAdmin();
    const { results } = await c.env.DB.prepare(`
        SELECT r.*, u.nick, u.ff_uid, u.whatsapp FROM recuperaciones r
        JOIN usuarios u ON u.id = r.usuario_id
        WHERE r.estado = 'pendiente' ORDER BY r.creado ASC`).all();
    return (results || []).map((r) => ({
        id: r.id, nick: r.nick, ffUid: r.ff_uid, whatsapp: r.whatsapp, creado: r.creado
    }));
});

/* Genera una contraseña temporal y la devuelve UNA sola vez, para que el
   organizador se la pase por WhatsApp. No queda guardada en texto. */
ruta('POST', /^\/api\/admin\/recuperaciones\/([\w-]+)$/, async (c, m) => {
    await c.exigirAdmin();
    const r = await c.env.DB.prepare("SELECT * FROM recuperaciones WHERE id = ? AND estado = 'pendiente'")
        .bind(m[1]).first();
    if (!r) throw noEncontrado('Esa solicitud no existe o ya fue resuelta.');

    if (!c.cuerpo.aprobar) {
        await c.env.DB.prepare("UPDATE recuperaciones SET estado = 'rechazada', resuelto = ? WHERE id = ?")
            .bind(ahora(), r.id).run();
        return { ok: true };
    }

    const temporal = 'FF' + aleatorio(4).toUpperCase();
    const { hash, sal } = await hashPass(temporal);
    await c.env.DB.batch([
        c.env.DB.prepare('UPDATE usuarios SET pass_hash = ?, pass_sal = ?, debe_cambiar = 1 WHERE id = ?')
            .bind(hash, sal, r.usuario_id),
        // Cerrar todas sus sesiones: si alguien había entrado con la vieja, fuera
        c.env.DB.prepare('DELETE FROM sesiones WHERE usuario_id = ?').bind(r.usuario_id),
        c.env.DB.prepare("UPDATE recuperaciones SET estado = 'resuelta', resuelto = ? WHERE id = ?")
            .bind(ahora(), r.id)
    ]);
    return { ok: true, temporal };
});

ruta('GET', /^\/api\/admin\/verificaciones$/, async (c) => {
    await c.exigirAdmin();
    const { results } = await c.env.DB.prepare(`
        SELECT v.*, u.nick, u.ff_uid, u.whatsapp, u.nivel FROM verificaciones v
        JOIN usuarios u ON u.id = v.usuario_id
        WHERE v.estado = 'pendiente' ORDER BY v.creado ASC`).all();
    return (results || []).map((v) => ({
        id: v.id, nick: v.nick, ffUid: v.ff_uid, whatsapp: v.whatsapp,
        nivel: v.nivel, codigo: v.codigo, creado: v.creado
    }));
});

ruta('POST', /^\/api\/admin\/verificaciones\/([\w-]+)$/, async (c, m) => {
    await c.exigirAdmin();
    const v = await c.env.DB.prepare("SELECT * FROM verificaciones WHERE id = ? AND estado = 'pendiente'")
        .bind(m[1]).first();
    if (!v) throw noEncontrado('Esa solicitud no existe o ya fue resuelta.');

    const aprobar = !!c.cuerpo.aprobar;
    const lote = [
        c.env.DB.prepare('UPDATE verificaciones SET estado = ?, nota = ?, resuelto = ? WHERE id = ?')
            .bind(aprobar ? 'aprobada' : 'rechazada', String(c.cuerpo.nota || '').slice(0, 120), ahora(), v.id)
    ];
    if (aprobar) {
        lote.push(c.env.DB.prepare('UPDATE usuarios SET verificado = 1 WHERE id = ?').bind(v.usuario_id));
    }
    await c.env.DB.batch(lote);
    return { ok: true };
});

/* ---------- Perfil de Free Fire por ID ----------
   Garena no tiene API oficial, así que esto consulta un servicio de
   terceros. Se hace DESDE AQUÍ y no desde el navegador por tres razones:
   el navegador no puede (CORS), la llave del proveedor no puede quedar a
   la vista, y si cada jugador consultara desde su casa el proveedor
   acabaría bloqueando por IP. */
const PROVEEDORES = {
    jinix: 'https://free-ff-api-src-5plp.onrender.com/api/v1/account?region={region}&uid={uid}',
    glob:  'https://glob-info2.vercel.app/info?uid={uid}'
};

ruta('GET', /^\/api\/perfil$/, async (c) => {
    const uidFF = String(c.url.searchParams.get('uid') || '').replace(/\D/g, '');
    const region = String(c.url.searchParams.get('region') || 'us').toLowerCase().slice(0, 4);
    if (!/^\d{6,14}$/.test(uidFF)) throw malaPeticion('El ID de Free Fire son solo números (entre 6 y 14 dígitos).');

    const plantilla = c.env.FF_API_URL || PROVEEDORES[c.env.FF_PROVEEDOR] || '';
    if (!plantilla) throw new ErrorAPI(503, 'El servidor no tiene configurado el servicio de perfiles.');

    // Un mismo ID consultado varias veces no golpea al proveedor cada vez
    const claveCache = new Request(`https://cache.torneosff/perfil/${region}/${uidFF}`);
    const cache = caches.default;
    const guardado = await cache.match(claveCache);
    if (guardado) return guardado.json();

    const destino = plantilla.replace('{uid}', encodeURIComponent(uidFF)).replace('{region}', encodeURIComponent(region.toUpperCase()));
    const cabeceras = { Accept: 'application/json', 'User-Agent': 'TorneosFF/1.0' };
    if (c.env.FF_API_KEY) {
        cabeceras.Authorization = 'Bearer ' + c.env.FF_API_KEY;
        cabeceras['x-api-key'] = c.env.FF_API_KEY;
    }

    let r;
    try {
        r = await fetch(destino, { headers: cabeceras, signal: AbortSignal.timeout(12000) });
    } catch (e) {
        throw new ErrorAPI(504, 'El servicio de perfiles no respondió a tiempo. Puedes escribir tu nick a mano.');
    }
    if (r.status === 404) throw noEncontrado('No encontramos ninguna cuenta con ese ID en esa región.');
    if (!r.ok) throw new ErrorAPI(502, `El servicio de perfiles respondió ${r.status}. Puedes escribir tu nick a mano.`);

    let datos;
    try { datos = await r.json(); } catch (e) { throw new ErrorAPI(502, 'El servicio de perfiles devolvió una respuesta ilegible.'); }

    // Algunos devuelven 200 con el error dentro
    const tieneCuenta = datos && (datos.basicInfo || datos.account || datos.AccountInfo || datos.nickname);
    if (!tieneCuenta) throw noEncontrado('No encontramos ninguna cuenta con ese ID en esa región.');

    const respuesta = new Response(JSON.stringify(datos), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }
    });
    c.espera(cache.put(claveCache, respuesta.clone()));
    return datos;
});

/* ---------- Público ---------- */
ruta('GET', /^\/api\/estadisticas$/, async (c) => {
    const t = await c.env.DB.prepare('SELECT COUNT(*) n FROM torneos').first();
    const f = await c.env.DB.prepare("SELECT COUNT(*) n FROM torneos WHERE estado = 'finalizado'").first();
    const j = await c.env.DB.prepare('SELECT COALESCE(SUM(json_array_length(miembros)),0) n FROM inscripciones').first();
    const r = await c.env.DB.prepare('SELECT COALESCE(SUM(premio),0) n FROM resultados').first();
    return { torneos: t.n, finalizados: f.n, jugadores: j.n, repartido: r.n };
});

ruta('GET', /^\/api\/pasarela$/, (c) => ({
    wompi: wompi.configurado(c.env),
    llavePublica: wompi.configurado(c.env) ? c.env.WOMPI_LLAVE_PUBLICA : ''
}));

ruta('GET', /^\/api\/salud$/, () => ({ ok: true, hora: ahora(), motor: 'cloudflare' }));

/* ============================================================
   Entrada del Worker
   ============================================================ */
function cors(env, origen) {
    const permitidos = (env.ORIGENES || 'https://estroncri.github.io').split(',').map((s) => s.trim());
    return {
        'Access-Control-Allow-Origin': permitidos.includes(origen) ? origen : permitidos[0],
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin'
    };
}

export default {
    async fetch(req, env, ctxWorker) {
        const cabeceras = Object.assign({ 'Content-Type': 'application/json; charset=utf-8' },
                                        cors(env, req.headers.get('Origin') || ''));
        const responder = (codigo, cuerpo) => new Response(JSON.stringify(cuerpo), { status: codigo, headers: cabeceras });

        if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cabeceras });

        const url = new URL(req.url);
        const r = rutas.find((x) => x.metodo === req.method && x.patron.test(url.pathname));
        if (!r) return responder(404, { error: 'Ruta no encontrada.' });

        let cuerpo = {};
        if (req.method !== 'GET' && req.method !== 'DELETE') {
            try {
                const texto = await req.text();
                cuerpo = texto ? JSON.parse(texto) : {};
            } catch (e) {
                return responder(400, { error: 'El cuerpo de la petición no es JSON válido.' });
            }
        }

        const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '') || null;
        let cacheUsuario;
        const ctx = {
            env, cuerpo, token, url,
            ip: req.headers.get('CF-Connecting-IP') || req.headers.get('x-forwarded-for') || 'desconocida',
            espera: (p) => { try { ctxWorker?.waitUntil?.(p); } catch (e) { /* en local no existe */ } },
            async usuario() {
                if (cacheUsuario !== undefined) return cacheUsuario;
                if (!token) return (cacheUsuario = null);
                const s = await env.DB.prepare('SELECT * FROM sesiones WHERE token_hash = ?').bind(await sha256(token)).first();
                if (!s) return (cacheUsuario = null);
                if (new Date(s.expira) < new Date()) {
                    await env.DB.prepare('DELETE FROM sesiones WHERE token_hash = ?').bind(s.token_hash).run();
                    return (cacheUsuario = null);
                }
                cacheUsuario = await env.DB.prepare('SELECT * FROM usuarios WHERE id = ?').bind(s.usuario_id).first();
                return cacheUsuario;
            },
            async exigirUsuario() {
                const u = await this.usuario();
                if (!u) throw noAutorizado();
                return u;
            },
            async exigirAdmin() {
                const u = await this.exigirUsuario();
                if (u.rol !== 'admin') throw prohibido();
                return u;
            }
        };

        try {
            const salida = await r.mano(ctx, url.pathname.match(r.patron));
            return responder(200, salida === undefined ? { ok: true } : salida);
        } catch (e) {
            if (e instanceof ErrorAPI) return responder(e.codigo, { error: e.message });
            console.error('Error inesperado:', e && e.stack || e);
            return responder(500, { error: 'Algo falló en el servidor.' });
        }
    }
};
