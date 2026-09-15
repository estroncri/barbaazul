/* ============================================================
   Torneos FF — API
   ------------------------------------------------------------
   Todo lo que toca dinero o cupos se decide AQUÍ, nunca en el
   navegador: el cliente solo pide, el servidor comprueba.

   Arrancar:   node torneos/servidor/api/servidor.js
   Variables:  PORT (o PUERTO), DB_RUTA, ORIGENES, ADMIN_FF_UID, ADMIN_PASS,
               WOMPI_LLAVE_PUBLICA, WOMPI_INTEGRIDAD, WOMPI_EVENTOS, WOMPI_REDIRECT
   ============================================================ */

const http = require('node:http');
const crypto = require('node:crypto');
const { db, uid, ahora, hashPass, verificarPass, saldoDe } = require('./db');
const wompi = require('./wompi');

// PORT es lo que inyectan Render, Railway y Fly. PUERTO queda por comodidad
// al trabajar en local. Si solo se lee PUERTO, el servicio nunca responde
// donde el proveedor lo busca y el despliegue se marca como caído.
const PUERTO = Number(process.env.PORT || process.env.PUERTO || 8790);
const ORIGENES = (process.env.ORIGENES ||
    'https://estroncri.github.io,http://localhost:8099,http://127.0.0.1:8099').split(',');
const CUPO_POR_MODO = { solo: 1, duo: 2, escuadra: 4 };

/* Reglas por defecto de cada modo. El organizador puede cambiarlas torneo
   por torneo desde el panel; esto es solo lo que se propone al crear. */
const REGLAS_MODO = {
    solo:     { costo: 5000, minimo: 20, precioKill: 3000, premioGanador: 10000 },
    duo:      { costo: 5000, minimo: 5,  precioKill: 3000, premioGanador: 15000 },
    escuadra: { costo: 5000, minimo: 10, precioKill: 3500, premioGanador: 0 }
};
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
        precioKill: t.precio_kill, premioGanador: t.premio_ganador, minimo: t.minimo,
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

    const base = REGLAS_MODO[d.modo];
    const num = (v, pordefecto) => (v === undefined || v === null || v === '' ? pordefecto : Math.max(0, Math.round(Number(v) || 0)));

    const id = uid('t');
    db.prepare(`INSERT INTO torneos (id, nombre, modo, fecha, cupo_max, costo, premio_total, distribucion,
                                     precio_kill, premio_ganador, minimo, mapa, reglas, estado, tema, creado)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'abierto',?,?)`)
        .run(id, String(d.nombre).trim(), d.modo, d.fecha, num(d.cupoMax, 48),
             num(d.costo, base.costo), num(d.premioTotal, 0),
             JSON.stringify(d.distribucion || []),
             num(d.precioKill, base.precioKill), num(d.premioGanador, base.premioGanador),
             num(d.minimo, base.minimo),
             d.mapa || 'Bermuda', JSON.stringify(d.reglas || []), d.tema || 'fuego', ahora());
    return torneoPublico(db.prepare('SELECT * FROM torneos WHERE id = ?').get(id));
});

ruta('PATCH', /^\/api\/torneos\/([\w-]+)$/, (ctx, m) => {
    ctx.exigirAdmin();
    const t = db.prepare('SELECT * FROM torneos WHERE id = ?').get(m[1]);
    if (!t) throw noEncontrado('Torneo no encontrado.');
    const c = ctx.cuerpo;

    /* El organizador puede corregir cualquier dato, incluso con gente ya
       inscrita: en la práctica se cambia la hora o el mapa a última hora.
       Lo único que no se toca es el modo cuando ya hay equipos armados,
       porque cambiaría cuántos jugadores debe tener cada uno. */
    const inscritos = db.prepare('SELECT COUNT(*) n FROM inscripciones WHERE torneo_id = ?').get(t.id).n;
    if (c.modo && c.modo !== t.modo && inscritos > 0) {
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

    for (const clave of Object.keys(c)) {
        const columna = alias[clave] || clave;
        if (!campos[columna]) continue;
        db.prepare(`UPDATE torneos SET ${columna} = ? WHERE id = ?`).run(campos[columna](c[clave]), t.id);
    }
    return torneoPublico(db.prepare('SELECT * FROM torneos WHERE id = ?').get(t.id));
});

/* Cancelar el torneo y devolverle el cupo a todo el mundo.
   Es lo que toca hacer cuando no se llega al mínimo para que la sala se juegue. */
ruta('POST', /^\/api\/torneos\/([\w-]+)\/cancelar$/, (ctx, m) => {
    ctx.exigirAdmin();
    db.exec('BEGIN IMMEDIATE');
    try {
        const t = db.prepare('SELECT * FROM torneos WHERE id = ?').get(m[1]);
        if (!t) throw noEncontrado('Torneo no encontrado.');
        if (t.estado === 'cancelado') throw malaPeticion('Ese torneo ya está cancelado.');

        const inscripciones = db.prepare('SELECT * FROM inscripciones WHERE torneo_id = ?').all(t.id);
        for (const i of inscripciones) {
            const devolver = t.costo * JSON.parse(i.miembros).length;
            if (devolver > 0) {
                anotar(i.usuario_id, 'reembolso', devolver, {
                    metodo: 'Saldo', referencia: t.id,
                    nota: 'Torneo cancelado — ' + t.nombre
                });
            }
        }
        db.prepare("UPDATE torneos SET estado = 'cancelado' WHERE id = ?").run(t.id);
        db.exec('COMMIT');
        return { ok: true, devueltos: inscripciones.length };
    } catch (e) {
        db.exec('ROLLBACK');
        throw e;
    }
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
            const kills = Math.max(0, Number(fila.kills) || 0);

            // Premio = kills x precio por kill, más el bono si quedó primero.
            const premio = kills * t.precio_kill + (puesto === 1 ? t.premio_ganador : 0);

            db.prepare(`INSERT INTO resultados (inscripcion_id, puesto, kills, puntos, premio) VALUES (?,?,?,?,?)
                        ON CONFLICT(inscripcion_id) DO UPDATE SET puesto=excluded.puesto, kills=excluded.kills,
                        puntos=excluded.puntos, premio=excluded.premio`)
                .run(i.id, puesto, kills, Math.max(0, Number(fila.puntos) || 0), premio);

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

    const conPasarela = wompi.configurado();
    const m = anotar(yo.id, 'recarga', monto, {
        estado: 'pendiente',
        metodo: conPasarela ? 'Wompi' : String(ctx.cuerpo.metodo || 'Nequi').slice(0, 30),
        referencia: '',
        nota: conPasarela ? 'Esperando el pago' : 'Recarga en revisión'
    });

    if (!conPasarela) {
        // Sin pasarela: el jugador paga por fuera y el organizador confirma.
        db.prepare('UPDATE movimientos SET referencia = ? WHERE id = ?')
            .run(String(ctx.cuerpo.ref || '').slice(0, 60), m.id);
        return { movimiento: movimientoPublico(db.prepare('SELECT * FROM movimientos WHERE id = ?').get(m.id)) };
    }

    // Con pasarela: la referencia es la del movimiento, y así el evento que
    // llegue después se puede casar con esta recarga y no con otra.
    const referencia = wompi.referenciaDe(m.id);
    db.prepare('UPDATE movimientos SET referencia = ? WHERE id = ?').run(referencia, m.id);

    return {
        movimiento: movimientoPublico(db.prepare('SELECT * FROM movimientos WHERE id = ?').get(m.id)),
        checkout: wompi.checkout(referencia, monto, {
            email: yo.email, telefono: yo.whatsapp, nombre: yo.nick
        })
    };
});

/* ---------- Eventos de Wompi ----------
   Esta dirección es pública: la llama Wompi, pero también la puede llamar
   cualquiera que la adivine. Por eso lo primero es comprobar la firma, y
   después que el monto coincida con lo que el jugador pidió recargar. */
ruta('POST', /^\/api\/wompi\/eventos$/, (ctx) => {
    const cuerpo = ctx.cuerpo || {};
    const revision = wompi.eventoValido(cuerpo);
    if (!revision.ok) {
        console.warn('Evento de Wompi rechazado:', revision.razon);
        throw new ErrorAPI(401, revision.razon);
    }

    const tx = (cuerpo.data && cuerpo.data.transaction) || {};
    const referencia = String(tx.reference || '');
    if (!referencia) return { ok: true, nota: 'Evento sin referencia, se ignora.' };

    const mov = db.prepare("SELECT * FROM movimientos WHERE referencia = ? AND tipo = 'recarga'").get(referencia);
    if (!mov) return { ok: true, nota: 'No hay ninguna recarga con esa referencia.' };

    // Si ya se resolvió, no se vuelve a tocar: Wompi reintenta los eventos y
    // sin esto una misma recarga se acreditaría dos veces.
    if (mov.estado !== 'pendiente') return { ok: true, nota: 'Esa recarga ya estaba resuelta.' };

    const centavos = Number(tx.amount_in_cents || 0);
    if (centavos !== Math.round(mov.monto) * 100) {
        db.prepare("UPDATE movimientos SET estado = 'rechazada', nota = ? WHERE id = ?")
            .run('El monto pagado no coincide con el solicitado', mov.id);
        console.warn('Wompi: monto distinto para', referencia, centavos, 'vs', mov.monto * 100);
        return { ok: true, nota: 'El monto no coincide.' };
    }

    const estado = String(tx.status || '').toUpperCase();
    if (estado === 'APPROVED') {
        db.prepare("UPDATE movimientos SET estado = 'completada', nota = ?, metodo = ? WHERE id = ?")
            .run('Pago aprobado por Wompi', String(tx.payment_method_type || 'Wompi').slice(0, 30), mov.id);
    } else if (['DECLINED', 'VOIDED', 'ERROR'].includes(estado)) {
        db.prepare("UPDATE movimientos SET estado = 'rechazada', nota = ? WHERE id = ?")
            .run('Pago ' + estado.toLowerCase() + ' en Wompi', mov.id);
    }
    // PENDING y cualquier otro estado: se deja como está y se espera otro evento.
    return { ok: true };
});

/* El navegador pregunta si hay pasarela, para saber qué pantalla mostrar */
ruta('GET', /^\/api\/pasarela$/, () => ({
    wompi: wompi.configurado(),
    llavePublica: wompi.configurado() ? wompi.CFG.publica : ''
}));

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
    // 0.0.0.0 explícito: los contenedores enrutan por ahí, no por localhost.
    servidor.listen(PUERTO, '0.0.0.0', () => {
        console.log(`\n  API de Torneos FF escuchando en el puerto ${PUERTO}`);
        console.log(`  Orígenes permitidos: ${ORIGENES.join(', ')}`);
        console.log(`  Base de datos: ${require('./db').RUTA}`);
        console.log(`  Pasarela Wompi: ${wompi.configurado() ? 'configurada (' + wompi.CFG.publica.slice(0, 12) + '…)' : 'SIN configurar — las recargas van en modo manual'}\n`);
    });
}

module.exports = { servidor, prepararAdmin };
