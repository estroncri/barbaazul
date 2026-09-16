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

import { uid, ahora, hashPass, verificarPass, esViejo, aleatorio, sha256 } from './cripto.js';
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
    grupo: i.grupo || i.id,
    buscando: !!i.buscando,
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

    const { hash, sal } = await hashPass(pass, c.env);
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

    const pass = String(c.cuerpo.pass || '');
    const u = await c.env.DB.prepare('SELECT * FROM usuarios WHERE ff_uid = ? OR lower(email) = ?').bind(q, q).first();
    if (!u || !(await verificarPass(pass, u.pass_hash, u.pass_sal, c.env))) {
        await anotarFallo(c.env, claves);
        throw new ErrorAPI(401, 'ID/correo o contraseña incorrectos.');
    }
    await limpiarIntentos(c.env, claves);

    /* Si la clave venía guardada con el sistema viejo, se rehace ahora que
       la tenemos delante. Es la única ocasión de hacerlo sin molestar a
       nadie: a partir de la próxima vez ya entra por el camino barato. */
    if (esViejo(u.pass_hash)) {
        const nuevo = await hashPass(pass, c.env);
        c.espera(c.env.DB.prepare('UPDATE usuarios SET pass_hash = ?, pass_sal = ? WHERE id = ?')
            .bind(nuevo.hash, nuevo.sal, u.id).run()
            .catch(() => { /* si falla, se vuelve a intentar la próxima vez */ }));
    }

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
        if (!(await verificarPass(actual, yo.pass_hash, yo.pass_sal, c.env))) {
            throw malaPeticion('La contraseña actual no es correcta.');
        }
    }

    const { hash, sal } = await hashPass(nueva, c.env);
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
        SELECT t.*, (SELECT COUNT(DISTINCT COALESCE(i.grupo, i.id)) FROM inscripciones i WHERE i.torneo_id = t.id) AS n,
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

    /* Los cupos son de EQUIPOS: dos sueltos que van a jugar juntos ocupan
       uno, no dos. Los jugadores sí se cuentan uno por uno. */
    const salida = torneoPublico(t, {
        n: new Set(participantes.map((p) => p.grupo)).size,
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

/* ---------- Inscripción: el punto delicado ----------

   Una inscripción es una PARTE de un equipo. Las que juegan juntas comparten
   "grupo": un equipo que llega completo es un grupo de una sola fila, y dos
   jugadores sueltos que la plataforma junta son un grupo de dos filas.

   Cada quien paga solo por los suyos y cada quien conserva su fila, que es
   lo que hace que después el premio se pueda repartir y que cancelar le
   devuelva a cada uno lo suyo. */

/* Cuántos jugadores hay ya en un grupo */
const SQL_EN_GRUPO = `(SELECT COALESCE(SUM(json_array_length(miembros)),0)
                       FROM inscripciones WHERE torneo_id = ? AND grupo = ?)`;

async function completarGrupo(env, torneo, grupo) {
    const { results } = await env.DB.prepare(
        'SELECT * FROM inscripciones WHERE torneo_id = ? AND grupo = ? ORDER BY creado ASC')
        .bind(torneo.id, grupo).all();

    const filas = results || [];
    const miembros = filas.flatMap((f) => JSON.parse(f.miembros));
    if (miembros.length < CUPO_POR_MODO[torneo.modo]) return false;

    /* El equipo pasa a llamarse por sus jugadores: al que se inscribió solo
       le tiene que quedar claro con quién va a jugar. */
    const nombre = miembros.map((x) => x.nick).join(' + ').slice(0, 60);
    await env.DB.batch(filas.map((f) => env.DB.prepare(
        'UPDATE inscripciones SET buscando = 0, equipo = ? WHERE id = ?').bind(nombre, f.id)));
    return true;
}

ruta('POST', /^\/api\/torneos\/([\w-]+)\/inscripciones$/, async (c, m) => {
    const yo = await c.exigirUsuario();
    const t = await c.env.DB.prepare('SELECT * FROM torneos WHERE id = ?').bind(m[1]).first();
    if (!t) throw noEncontrado('Torneo no encontrado.');
    if (t.estado !== 'abierto') throw malaPeticion('Las inscripciones de este torneo están cerradas.');

    const requeridos = CUPO_POR_MODO[t.modo];
    const miembros = (c.cuerpo.equipo?.miembros || [])
        .filter((x) => x && x.nick && String(x.nick).trim())
        .map((x) => ({ nick: String(x.nick).trim().slice(0, 30), uid: String(x.uid || '').replace(/\D/g, '').slice(0, 14) }));

    /* Sin compañero: paga su parte y la plataforma le busca con quién. */
    const buscando = !!c.cuerpo.buscarCompanero && requeridos > 1;
    if (buscando) {
        if (miembros.length !== 1) throw malaPeticion('Si no tienes compañero, solo van tus datos.');
    } else if (miembros.length !== requeridos) {
        throw malaPeticion(`Este torneo necesita ${requeridos} jugador(es).`);
    }

    const total = t.costo * miembros.length;
    const idIns = uid('i');
    const idTx = uid('tx');
    const nombreEquipo = String(c.cuerpo.equipo?.nombre || yo.nick).slice(0, 40);

    /* Las condiciones viajan DENTRO del INSERT. Si entre la consulta y la
       escritura alguien más se inscribe o el saldo cambia, la fila
       sencillamente no entra y no se cobra nada. El cobro va en el mismo
       lote y solo ocurre si la inscripción existe.

       El cupo se cuenta por equipos (grupos), no por filas: dos sueltos que
       van a jugar juntos ocupan un cupo, no dos. */
    const lote = await c.env.DB.batch([
        c.env.DB.prepare(`
            INSERT INTO inscripciones (id, torneo_id, usuario_id, equipo, miembros, estado, creado, grupo, buscando)
            SELECT ?, ?, ?, ?, ?, 'confirmada', ?, ?, ?
            WHERE (SELECT COUNT(DISTINCT COALESCE(grupo, id)) FROM inscripciones WHERE torneo_id = ?) < (SELECT cupo_max FROM torneos WHERE id = ?)
              AND NOT EXISTS (SELECT 1 FROM inscripciones WHERE torneo_id = ? AND usuario_id = ?)
              AND ${SQL_SALDO} >= ?`)
            .bind(idIns, t.id, yo.id, nombreEquipo, JSON.stringify(miembros), ahora(), idIns, buscando ? 1 : 0,
                  t.id, t.id, t.id, yo.id, yo.id, total),

        c.env.DB.prepare(`
            INSERT INTO movimientos (id, usuario_id, tipo, monto, estado, metodo, referencia, nota, creado)
            SELECT ?, ?, 'inscripcion', ?, 'completada', 'Saldo', ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM inscripciones WHERE id = ?)`)
            .bind(idTx, yo.id, -total, t.id, t.nombre, ahora(), idIns),

        c.env.DB.prepare(`
            UPDATE torneos SET estado = 'lleno'
            WHERE id = ? AND estado = 'abierto'
              AND (SELECT COUNT(DISTINCT COALESCE(grupo, id)) FROM inscripciones WHERE torneo_id = ?) >= cupo_max`)
            .bind(t.id, t.id)
    ]);

    if (!lote[0].meta.changes) {
        // No entró: hay que decirle al jugador por qué.
        const ya = await c.env.DB.prepare('SELECT 1 FROM inscripciones WHERE torneo_id = ? AND usuario_id = ?').bind(t.id, yo.id).first();
        if (ya) throw malaPeticion('Ya estás inscrito en este torneo.');
        const n = await c.env.DB.prepare('SELECT COUNT(DISTINCT COALESCE(grupo, id)) n FROM inscripciones WHERE torneo_id = ?').bind(t.id).first();
        if (n.n >= t.cupo_max) throw malaPeticion('Ya no quedan cupos.');
        throw malaPeticion('Saldo insuficiente. Recarga en tu billetera.');
    }

    /* Ya está dentro y pagado. Ahora, si vino solo, se le busca equipo entre
       los que también están esperando: el que lleva más tiempo primero.

       La condición va dentro del UPDATE para que dos que lleguen a la vez no
       se metan los dos en el mismo hueco. Si no cabe, se queda esperando en
       su grupo, que es exactamente donde estaba. */
    let grupo = idIns;
    if (buscando) {
        const hueco = await c.env.DB.prepare(`
            SELECT grupo, SUM(json_array_length(miembros)) AS n, MIN(creado) AS desde
            FROM inscripciones
            WHERE torneo_id = ? AND buscando = 1 AND grupo != ?
            GROUP BY grupo HAVING n < ? ORDER BY desde ASC LIMIT 1`)
            .bind(t.id, idIns, requeridos).first();

        if (hueco) {
            const r = await c.env.DB.prepare(`
                UPDATE inscripciones SET grupo = ?
                WHERE id = ? AND ${SQL_EN_GRUPO} + ? <= ?`)
                .bind(hueco.grupo, idIns, t.id, hueco.grupo, miembros.length, requeridos).run();
            if (r.meta.changes) grupo = hueco.grupo;
        }
        await completarGrupo(c.env, t, grupo);
    }

    const i = await c.env.DB.prepare('SELECT * FROM inscripciones WHERE id = ?').bind(idIns).first();
    return inscripcionPublica(i);
});

/* Cuando ya no hay a quién esperar, el jugador decide: juega solo con lo que
   pagó, o se le devuelve. Nadie más puede decidirlo por él. */
ruta('POST', /^\/api\/torneos\/([\w-]+)\/jugar-solo$/, async (c, m) => {
    const yo = await c.exigirUsuario();
    const t = await c.env.DB.prepare('SELECT * FROM torneos WHERE id = ?').bind(m[1]).first();
    if (!t) throw noEncontrado('Torneo no encontrado.');

    const i = await c.env.DB.prepare('SELECT * FROM inscripciones WHERE torneo_id = ? AND usuario_id = ?')
        .bind(t.id, yo.id).first();
    if (!i) throw malaPeticion('No estás inscrito en este torneo.');
    if (!i.buscando) throw malaPeticion('Ya tienes equipo: no hay nada que decidir.');

    await c.env.DB.prepare("UPDATE inscripciones SET buscando = 0 WHERE id = ? AND buscando = 1").bind(i.id).run();
    return { ok: true, nota: 'Juegas solo con lo que pagaste.' };
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

        /* El resultado es del EQUIPO, y un equipo puede ser gente que no se
           conocía: cada uno tiene su propia fila. El premio se reparte entre
           todos, porque jugaron todos. */
        const { results: delGrupo } = await c.env.DB.prepare(
            'SELECT * FROM inscripciones WHERE torneo_id = ? AND grupo = ? ORDER BY creado ASC')
            .bind(t.id, i.grupo || i.id).all();
        const filas = (delGrupo && delGrupo.length) ? delGrupo : [i];

        const puesto = Math.max(0, Number(fila.puesto) || 0);
        const kills = Math.max(0, Number(fila.kills) || 0);
        const puntos = Math.max(0, Number(fila.puntos) || 0);
        const premio = kills * t.precio_kill + (puesto === 1 ? t.premio_ganador : 0);

        /* Al dividir sobran pesos: se los lleva el primero que se inscribió.
           Repartir de menos sería quedarse con dinero de alguien. */
        const parte = Math.floor(premio / filas.length);
        const resto = premio - parte * filas.length;

        for (const [n, f] of filas.entries()) {
            const suyo = parte + (n === 0 ? resto : 0);

            // Si ya se había pagado un premio, se descuenta antes de pagar el
            // nuevo: corregir un resultado no puede regalar dinero.
            const previo = await c.env.DB.prepare('SELECT * FROM resultados WHERE inscripcion_id = ?').bind(f.id).first();
            if (previo?.premio > 0) {
                lote.push(insertarMovimiento(c.env, uid('tx'), f.usuario_id, 'ajuste', -previo.premio,
                    { referencia: t.id, nota: 'Corrección de resultados — ' + t.nombre }));
            }

            lote.push(c.env.DB.prepare(`
                INSERT INTO resultados (inscripcion_id, puesto, kills, puntos, premio) VALUES (?,?,?,?,?)
                ON CONFLICT(inscripcion_id) DO UPDATE SET puesto=excluded.puesto, kills=excluded.kills,
                    puntos=excluded.puntos, premio=excluded.premio`)
                .bind(f.id, puesto, kills, puntos, suyo));

            if (suyo > 0) {
                lote.push(insertarMovimiento(c.env, uid('tx'), f.usuario_id, 'premio', suyo,
                    { metodo: 'Saldo', referencia: t.id, nota: `Puesto #${puesto} — ${t.nombre}` }));
            }
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
    const { hash, sal } = await hashPass(temporal, c.env);
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
export const PROVEEDORES = {
    jinix:   { url: 'https://free-ff-api-src-5plp.onrender.com/api/v1/account?region={region}&uid={uid}', porRegion: true },
    glob:    { url: 'https://glob-info2.vercel.app/info?uid={uid}', porRegion: false },
    /* Este no devuelve JSON: es la página que cualquiera abriría en el
       navegador. Se lee de ella lo mismo que se ve. Su robots.txt no lo
       prohíbe (solo cierra /paginas/carrega-mais-*), se identifica quién
       pregunta y la respuesta se guarda un buen rato para no molestar. */
    ffmania: { url: 'https://www.freefiremania.com.br/cuenta/{uid}.html?region={region}', porRegion: true, html: true }
};

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };
const sinEntidades = (t) => String(t).replace(/&(#?\w+);/g, (todo, e) => ENTIDADES[e]
    || (e[0] === '#' ? String.fromCharCode(Number(e.slice(1))) : todo));

/* Saca de la página lo mismo que lee una persona, y lo deja con la forma
   que ya entiende el resto del programa. Si mañana le cambian el diseño,
   esto dejará de encontrar el nick y el jugador lo escribirá a mano: es
   justo lo que pasa hoy, así que no se pierde nada. */
export function extraerDeHtml(html, uidFF, region) {
    const texto = String(html);

    /* El nick sale en el título, delante del "(ID 123...)". Es lo más
       estable de la página: es lo que Google enseña en los resultados. */
    const titulo = (texto.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
        || texto.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
    const nick = sinEntidades(titulo.split(/\s*\(ID\s/i)[0] || '').trim();
    if (!nick) return null;

    const busca = (re) => (texto.match(re) || [])[1] || '';
    const numero = (v) => Number(String(v).replace(/[^\d]/g, '')) || 0;

    return {
        basicInfo: {
            accountId: String(uidFF),
            nickname: nick,
            // Pegado al dato: un comodín que salte etiquetas se come medio
            // párrafo y acaba cogiendo el número equivocado (el 4 de "8.544").
            level: numero(busca(/(?:nivel|n[íi]vel|level)\s*:?\s*(\d{1,3})\b/i)),
            liked: numero(busca(/con\s+([\d.,]+)\s+me gusta/i)),
            // Con los dos puntos obligatorios coge el "Región: US" del dato,
            // y no el "región Estados Unidos" de la frase.
            region: (busca(/Regi[óo]n\s*:\s*([A-Za-z]{2,4})\b/) || region || '').toLowerCase()
        }
    };
}

/* Las regiones donde Garena reparte las cuentas. La de Colombia es "sac"
   (Sudamérica), pero mucha gente tiene la cuenta en "us" o "br" sin saberlo:
   por eso no basta con preguntar por una sola. */
export const REGIONES = ['sac', 'us', 'br', 'na', 'sg', 'id', 'ind', 'th', 'vn', 'tw', 'me', 'eu', 'pk', 'cis', 'bd'];

const tieneCuenta = (d) => !!(d && (d.basicInfo || d.account || d.AccountInfo || d.nickname
    || (d.data && (d.data.basicInfo || d.data.nickname))));

/* Un intento contra un proveedor. Devuelve los datos, o por qué no. */
export async function intentarPerfil(plantilla, uidFF, region, env, esHtml) {
    const destino = plantilla
        .replace('{uid}', encodeURIComponent(uidFF))
        .replace('{region}', encodeURIComponent(String(region).toUpperCase()));

    /* Quien pregunta se identifica y dice para qué: si al dueño del sitio le
       molesta, que sepa a quién escribirle antes que bloquear a ciegas. */
    const cabeceras = esHtml
        ? { Accept: 'text/html', 'User-Agent': 'TorneosFF/1.0 (+https://estroncri.github.io/barbaazul/torneos/)' }
        : { Accept: 'application/json', 'User-Agent': 'TorneosFF/1.0' };
    if (env.FF_API_KEY) {
        cabeceras.Authorization = 'Bearer ' + env.FF_API_KEY;
        cabeceras['x-api-key'] = env.FF_API_KEY;
    }

    let r;
    try {
        r = await fetch(destino, { headers: cabeceras, signal: AbortSignal.timeout(7000) });
    } catch (e) {
        return { ok: false, porque: 'no respondió a tiempo' };
    }
    if (!r.ok) return { ok: false, porque: 'contestó ' + r.status };

    let datos;
    if (esHtml) {
        datos = extraerDeHtml(await r.text(), uidFF, region);
        if (!datos) return { ok: false, porque: 'la página no trae el nick donde se esperaba' };
        return { ok: true, datos };
    }
    try { datos = await r.json(); } catch (e) { return { ok: false, porque: 'respuesta ilegible' }; }

    // Algunos contestan 200 con el error dentro
    if (!tieneCuenta(datos)) return { ok: false, porque: 'no tiene esa cuenta' };
    return { ok: true, datos };
}

/* Busca el perfil donde sea. Orden pensado para tardar poco en el caso
   normal y aun así encontrar las cuentas raras:

     1. El proveedor configurado, con la región que dijo el jugador.
     2. El proveedor que no necesita región: de un golpe cubre todas.
     3. El resto de regiones, una por una.

   Se para en cuanto uno contesta. */
export async function buscarPerfil(uidFF, region, env) {
    const intentos = [];
    const principal = env.FF_API_URL || PROVEEDORES[env.FF_PROVEEDOR]?.url || PROVEEDORES.jinix.url;

    intentos.push({ plantilla: principal, region, quien: env.FF_PROVEEDOR || 'principal' });

    /* Primero los que contestan JSON, que es lo estable; los que hay que
       leer del HTML van después, como último recurso. */
    for (const [nombre, prov] of Object.entries(PROVEEDORES)) {
        if (!prov.html && !prov.porRegion && prov.url !== principal) {
            intentos.push({ plantilla: prov.url, region, quien: nombre });
        }
    }

    for (const otra of REGIONES) {
        if (otra !== region) intentos.push({ plantilla: principal, region: otra, quien: (env.FF_PROVEEDOR || 'principal') + ':' + otra });
    }

    for (const [nombre, prov] of Object.entries(PROVEEDORES)) {
        if (prov.html) intentos.push({ plantilla: prov.url, region, quien: nombre, html: true });
    }

    const fallos = [];
    for (const intento of intentos) {
        const r = await intentarPerfil(intento.plantilla, uidFF, intento.region, env, intento.html);
        if (r.ok) return { ok: true, datos: r.datos, quien: intento.quien, region: intento.region, fallos };
        fallos.push(`${intento.quien}: ${r.porque}`);
    }
    return { ok: false, fallos };
}

ruta('GET', /^\/api\/perfil$/, async (c) => {
    const uidFF = String(c.url.searchParams.get('uid') || '').replace(/\D/g, '');
    const region = String(c.url.searchParams.get('region') || 'us').toLowerCase().slice(0, 4);
    if (!/^\d{6,14}$/.test(uidFF)) throw malaPeticion('El ID de Free Fire son solo números (entre 6 y 14 dígitos).');

    /* Un mismo ID consultado varias veces no golpea al proveedor cada vez. La
       caché no lleva región: da igual en cuál se encontró, la cuenta es la
       misma y así el segundo jugador que pregunte lo tiene al instante. */
    const claveCache = new Request(`https://cache.torneosff/perfil/${uidFF}`);
    const cache = caches.default;
    const guardado = await cache.match(claveCache);
    if (guardado) return guardado.json();

    const r = await buscarPerfil(uidFF, region, c.env);
    if (!r.ok) {
        /* Los motivos van a los registros, no al jugador: a él solo le sirve
           saber que escriba el nick a mano. */
        console.log(`perfil ${uidFF}: ` + r.fallos.join(' | '));
        /* Ojo con lo que se afirma aquí. Que un servicio de terceros conteste
           404 no significa que la cuenta no exista: significa que ese
           servicio no la tiene. Con los proveedores caídos, decirle a un
           jugador que su cuenta no existe es mentirle y perderlo. */
        throw noEncontrado('No pudimos comprobar esa cuenta ahora mismo. Escribe el nick tal como aparece en el juego.');
    }

    const respuesta = new Response(JSON.stringify(r.datos), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }
    });
    c.espera(cache.put(claveCache, respuesta.clone()));
    return r.datos;
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
