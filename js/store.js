/* ============================================================
   TORNEOS FF — Capa de datos (store.js)
   ------------------------------------------------------------
   IMPORTANTE: esta capa simula el backend usando localStorage.
   Todas las funciones son asíncronas (devuelven Promise) a
   propósito: cuando exista el backend real, solo hay que
   cambiar el cuerpo de cada función por un fetch() al API.
   Ver torneos/ARQUITECTURA.md
   ============================================================ */

window.Store = (function () {
    'use strict';

    const KEY = 'torneos_ff_v1';
    const DELAY = 220; // simula latencia de red

    /* ===== Utilidades ===== */
    const uid = (p) => p + '_' + Math.random().toString(36).slice(2, 9);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const clone = (o) => JSON.parse(JSON.stringify(o));

    // Hash de demostración. En producción: bcrypt/argon2 en el servidor.
    const hash = (txt) => {
        let h = 0;
        for (let i = 0; i < txt.length; i++) h = (h * 31 + txt.charCodeAt(i)) | 0;
        return 'h' + Math.abs(h).toString(36);
    };

    const fmtCOP = (n) =>
        new Intl.NumberFormat('es-CO', {
            style: 'currency', currency: 'COP', maximumFractionDigits: 0
        }).format(Number(n) || 0);

    const cupoPorModo = { solo: 1, duo: 2, escuadra: 4 };
    const nombreModo = { solo: 'Solo', duo: 'Dúo', escuadra: 'Escuadra' };

    /* ===== Persistencia ===== */
    let db = null;

    function save() {
        try {
            localStorage.setItem(KEY, JSON.stringify(db));
        } catch (e) {
            console.warn('No se pudo guardar el estado local', e);
        }
    }

    function load() {
        try {
            const raw = localStorage.getItem(KEY);
            if (raw) { db = JSON.parse(raw); return; }
        } catch (e) {
            console.warn('Estado local corrupto, se regenera', e);
        }
        db = seed();
        save();
    }

    /* ===== Datos de ejemplo ===== */
    function futuro(dias, hora) {
        const d = new Date();
        d.setDate(d.getDate() + dias);
        const [h, m] = hora.split(':');
        d.setHours(+h, +m, 0, 0);
        return d.toISOString();
    }

    const NICKS = ['ZeusFF', 'Kraken', 'ElCosta', 'NovaKill', 'Maracucho', 'LoboGris',
        'Yeikob', 'SirBooy', 'DarkAlex', 'Kenny07', 'JuanFF', 'MrTiburon',
        'Valeria', 'Shadow', 'RojoFF', 'BlackMamba', 'Samu', 'Pipe10',
        'Dani', 'Kira', 'AxelFF', 'Fenix'];

    function seed() {
        const admin = {
            id: 'u_admin',
            ffUid: '1000000001',
            nick: 'ARENA ADMIN',
            nivel: 72,
            region: 'us',
            email: 'admin@torneosff.co',
            whatsapp: '573000000000',
            pass: hash('admin123'),
            rol: 'admin',
            saldo: 0,
            verificado: true,
            creado: new Date().toISOString()
        };

        const demo = {
            id: 'u_demo',
            ffUid: '2148563097',
            nick: 'ElCostaXD',
            nivel: 58,
            region: 'us',
            email: 'demo@torneosff.co',
            whatsapp: '573001112233',
            pass: hash('demo123'),
            rol: 'jugador',
            saldo: 25000,
            verificado: true,
            creado: new Date().toISOString()
        };

        const torneos = [
            {
                id: 't_1',
                nombre: 'Copa Barranquilla — Escuadra',
                modo: 'escuadra',
                fecha: futuro(2, '20:00'),
                cupoMax: 12,            // equipos
                costo: 5000,            // por jugador
                premioTotal: 180000,
                distribucion: [{ pos: 1, pct: 55 }, { pos: 2, pct: 30 }, { pos: 3, pct: 15 }],
                mapa: 'Bermuda',
                reglas: [
                    'Prohibido el uso de emuladores, hacks o cuentas de terceros.',
                    'Debes entrar a la sala 10 minutos antes de la hora de inicio.',
                    'El nick en la partida debe ser el mismo registrado en la plataforma.',
                    'Puntos: 1 punto por kill + puntos por posición (12, 9, 8, 7, 6, 5, 4, 3, 2, 1).',
                    'Grabar la partida es obligatorio para poder reclamar.'
                ],
                estado: 'abierto',
                sala: { id: '', pass: '', publicada: false },
                tema: 'fuego',
                encuesta: {
                    pregunta: '¿Modo para la copa del fin de semana?',
                    opciones: [
                        { texto: 'Escuadra', votos: 41 },
                        { texto: 'Dúo', votos: 18 },
                        { texto: 'Solo', votos: 9 }
                    ],
                    cerrada: true
                }
            },
            {
                id: 't_2',
                nombre: 'Duelo Nocturno — Dúo',
                modo: 'duo',
                fecha: futuro(4, '21:30'),
                cupoMax: 20,
                costo: 3000,
                premioTotal: 90000,
                distribucion: [{ pos: 1, pct: 60 }, { pos: 2, pct: 40 }],
                mapa: 'Purgatorio',
                reglas: [
                    'Solo dúos. No se permite jugar con un tercero en la sala.',
                    'Una sola partida clasificatoria: gana quien sume más puntos.',
                    'Si te desconectas, la partida no se reinicia.'
                ],
                estado: 'abierto',
                sala: { id: '', pass: '', publicada: false },
                tema: 'neon',
                encuesta: null
            },
            {
                id: 't_3',
                nombre: 'Solo Kill Race #14',
                modo: 'solo',
                fecha: futuro(-3, '20:00'),
                cupoMax: 48,
                costo: 2000,
                premioTotal: 70000,
                distribucion: [{ pos: 1, pct: 50 }, { pos: 2, pct: 30 }, { pos: 3, pct: 20 }],
                mapa: 'Kalahari',
                reglas: ['Gana quien haga más kills en 2 partidas.'],
                estado: 'finalizado',
                sala: { id: '48291045', pass: '2211', publicada: true },
                tema: 'hielo',
                encuesta: null
            }
        ];

        // Inscripciones de ejemplo para que la lista de participantes no esté vacía
        const inscripciones = [];
        const mkInsc = (torneoId, i, nMiembros, nombreEquipo) => {
            const miembros = [];
            for (let k = 0; k < nMiembros; k++) {
                const n = NICKS[(i * 3 + k) % NICKS.length];
                miembros.push({ nick: n + (k ? '_' + k : ''), uid: String(2100000000 + i * 977 + k * 13) });
            }
            return {
                id: uid('i'),
                torneoId,
                userId: 'u_' + (i + 10),
                equipo: { nombre: nombreEquipo, miembros },
                estado: 'confirmada',
                creado: new Date(Date.now() - (i + 1) * 36e5).toISOString(),
                resultado: null
            };
        };
        const equiposDemo = ['Los Tiburones', 'Team Nova', 'Killer Crew', 'La Arenosa',
            'Fénix GG', 'Los Primos', 'Sin Piedad', 'Escuadrón 7'];
        equiposDemo.slice(0, 7).forEach((nom, i) => inscripciones.push(mkInsc('t_1', i, 4, nom)));
        ['Doble Impacto', 'Dos Locos', 'Hermanos FF', 'Duo Costeño', 'Pareja Letal']
            .forEach((nom, i) => inscripciones.push(mkInsc('t_2', i + 2, 2, nom)));

        // Resultados del torneo finalizado
        ['Kira', 'AxelFF', 'Fenix', 'Samu', 'Pipe10'].forEach((nick, i) => {
            const ins = mkInsc('t_3', i + 5, 1, nick);
            ins.equipo.miembros = [{ nick, uid: String(2200000000 + i * 31) }];
            const premio = i === 0 ? 35000 : i === 1 ? 21000 : i === 2 ? 14000 : 0;
            ins.resultado = { puesto: i + 1, kills: 14 - i * 2, puntos: 26 - i * 4, premio };
            inscripciones.push(ins);
        });

        return {
            usuarios: [admin, demo],
            torneos,
            inscripciones,
            transacciones: [
                {
                    id: uid('tx'), userId: 'u_demo', tipo: 'recarga', monto: 25000,
                    estado: 'completada', metodo: 'Nequi', ref: 'NQ-884512',
                    creado: new Date(Date.now() - 864e5).toISOString(), nota: 'Recarga inicial'
                }
            ],
            sesion: null,
            config: {
                marca: 'TORNEOS FF',
                // Endpoint propio que consulta el perfil de Free Fire por ID.
                // Vacío = modo demostración (datos simulados en el navegador).
                // Para activarlo: despliega torneos/servidor/perfil-ff.worker.js
                // y pon aquí su URL, por ejemplo:
                //   'https://torneos-ff-perfil.tu-usuario.workers.dev/perfil'
                perfilApi: '',
                regionPorDefecto: 'us',
                // Estos dos se ponen en config.js, que es donde se buscan.
                whatsappGrupo: (window.CONFIG_TORNEOS || {}).whatsappGrupo || '',
                whatsappReclamos: (window.CONFIG_TORNEOS || {}).whatsappReclamos || '',
                whatsappSoporte: (window.CONFIG_TORNEOS || {}).whatsappSoporte || '573001112233',
                metodosPago: ['Nequi', 'Daviplata', 'Bancolombia', 'Efecty'],
                comision: 10, // % que se queda la plataforma sobre lo recaudado
                minRetiro: 10000
            }
        };
    }

    load();

    /* ===== Helpers internos ===== */
    function usuarioPorId(id) { return db.usuarios.find((u) => u.id === id) || null; }

    function inscripcionesDe(torneoId) {
        return db.inscripciones.filter((i) => i.torneoId === torneoId);
    }

    function tx(userId, tipo, monto, extra) {
        const t = Object.assign({
            id: uid('tx'), userId, tipo, monto,
            estado: 'completada', metodo: '—', ref: '—',
            creado: new Date().toISOString(), nota: ''
        }, extra || {});
        db.transacciones.unshift(t);
        return t;
    }

    /* ============================================================
       API PÚBLICA
       ============================================================ */
    const api = {
        fmtCOP, cupoPorModo, nombreModo,

        config: () => clone(db.config),

        /* ---------- Sesión / cuenta ---------- */

        // Consulta el perfil público por ID de Free Fire.
        // La lógica vive en perfil-ff.js (proveedor + normalización + caché).
        consultarPerfilFF: async (ffUid, region) => {
            const perfil = await window.PerfilFF.consultar(ffUid, region || db.config.regionPorDefecto);
            return Object.assign({}, perfil, {
                codigoVerificacion: window.PerfilFF.codigoVerificacion(perfil.uid),
                ffUid: perfil.uid
            });
        },

        registrar: async ({ ffUid, nick, nivel, region, email, whatsapp, pass, perfil }) => {
            await wait(DELAY);
            if (db.usuarios.some((u) => u.ffUid === String(ffUid))) {
                throw new Error('Ese ID de Free Fire ya está registrado.');
            }
            if (!pass || pass.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
            if (!/^\d{10,13}$/.test(String(whatsapp).replace(/\D/g, ''))) {
                throw new Error('Escribe un número de WhatsApp válido (con indicativo).');
            }
            const u = {
                id: uid('u'), ffUid: String(ffUid), nick, nivel: nivel || 0,
                region: region || 'us',
                perfil: perfil || null,          // datos del juego tal como llegaron
                email: email || '',
                whatsapp: String(whatsapp).replace(/\D/g, ''),
                pass: hash(pass), rol: 'jugador', saldo: 0,
                verificado: true, // en producción: false hasta que un admin valide la captura
                creado: new Date().toISOString()
            };
            db.usuarios.push(u);
            db.sesion = u.id;
            save();
            return clone(u);
        },

        actualizarPerfilFF: async () => {
            const yo = db.sesion ? usuarioPorId(db.sesion) : null;
            if (!yo) throw new Error('Inicia sesión.');
            const p = await window.PerfilFF.consultar(yo.ffUid, yo.region, { sinCache: true });
            // Sin servicio conectado los datos son inventados: se muestran como ejemplo,
            // pero nunca pisan el nick que el jugador escribió.
            yo.perfil = p;
            if (p.fuente === 'api') {
                yo.nick = p.nick || yo.nick;
                yo.nivel = p.nivel || yo.nivel;
            }
            save();
            return clone(yo);
        },

        login: async (ffUidOrEmail, pass) => {
            await wait(DELAY);
            const q = String(ffUidOrEmail).trim().toLowerCase();
            const u = db.usuarios.find(
                (x) => x.ffUid === q || (x.email || '').toLowerCase() === q
            );
            if (!u || u.pass !== hash(pass)) {
                throw new Error('ID/correo o contraseña incorrectos.');
            }
            db.sesion = u.id;
            save();
            return clone(u);
        },

        logout: async () => { db.sesion = null; save(); },

        yo: () => (db.sesion ? clone(usuarioPorId(db.sesion)) : null),

        esAdmin: () => {
            const u = db.sesion ? usuarioPorId(db.sesion) : null;
            return !!u && u.rol === 'admin';
        },

        /* ---------- Torneos ---------- */
        torneos: async () => {
            await wait(60);
            return clone(db.torneos)
                .map((t) => {
                    const ins = inscripcionesDe(t.id);
                    t.inscritos = ins.length;
                    t.jugadores = ins.reduce((a, i) => a + i.equipo.miembros.length, 0);
                    return t;
                })
                .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
        },

        torneo: async (id) => {
            await wait(60);
            const t = db.torneos.find((x) => x.id === id);
            if (!t) throw new Error('Torneo no encontrado.');
            const out = clone(t);
            out.participantes = clone(inscripcionesDe(id))
                .sort((a, b) => new Date(a.creado) - new Date(b.creado));
            out.inscritos = out.participantes.length;
            out.jugadores = out.participantes.reduce((a, i) => a + i.equipo.miembros.length, 0);
            const yo = api.yo();
            out.miInscripcion = yo
                ? out.participantes.find((p) => p.userId === yo.id) || null
                : null;
            return out;
        },

        crearTorneo: async (data) => {
            await wait(DELAY);
            if (!api.esAdmin()) throw new Error('Solo un administrador puede crear torneos.');
            const t = {
                id: uid('t'),
                nombre: data.nombre,
                modo: data.modo,
                fecha: data.fecha,
                cupoMax: +data.cupoMax,
                costo: +data.costo,
                premioTotal: +data.premioTotal,
                distribucion: data.distribucion && data.distribucion.length
                    ? data.distribucion
                    : [{ pos: 1, pct: 60 }, { pos: 2, pct: 25 }, { pos: 3, pct: 15 }],
                mapa: data.mapa || 'Bermuda',
                reglas: (data.reglas || '').split('\n').map((s) => s.trim()).filter(Boolean),
                estado: 'abierto',
                sala: { id: '', pass: '', publicada: false },
                tema: data.tema || 'fuego',
                encuesta: null
            };
            if (!t.nombre) throw new Error('Ponle un nombre al torneo.');
            if (!t.fecha) throw new Error('Falta la fecha y hora.');
            db.torneos.push(t);
            save();
            return clone(t);
        },

        actualizarTorneo: async (id, cambios) => {
            await wait(DELAY);
            if (!api.esAdmin()) throw new Error('Acción solo para administradores.');
            const t = db.torneos.find((x) => x.id === id);
            if (!t) throw new Error('Torneo no encontrado.');
            Object.assign(t, cambios);
            save();
            return clone(t);
        },

        cancelarTorneo: async (id) => {
            await wait(DELAY);
            if (!api.esAdmin()) throw new Error('Acción solo para administradores.');
            const t = db.torneos.find((x) => x.id === id);
            if (!t) throw new Error('Torneo no encontrado.');
            const ins = inscripcionesDe(id);
            ins.forEach((i) => {
                const u = usuarioPorId(i.userId);
                const devolver = t.costo * i.equipo.miembros.length;
                if (u && devolver > 0) {
                    u.saldo += devolver;
                    tx(u.id, 'reembolso', devolver, { nota: 'Torneo cancelado — ' + t.nombre, metodo: 'Saldo', ref: t.id });
                }
            });
            t.estado = 'cancelado';
            save();
            return { ok: true, devueltos: ins.length };
        },

        eliminarTorneo: async (id) => {
            await wait(DELAY);
            if (!api.esAdmin()) throw new Error('Acción solo para administradores.');
            const t = db.torneos.find((x) => x.id === id);
            if (!t) throw new Error('Torneo no encontrado.');
            if (t.estado !== 'cancelado' && inscripcionesDe(id).length > 0) {
                throw new Error('Este torneo tiene inscritos con dinero pagado. Cancélalo primero.');
            }
            db.torneos = db.torneos.filter((x) => x.id !== id);
            db.inscripciones = db.inscripciones.filter((i) => i.torneoId !== id);
            save();
            return { ok: true };
        },

        publicarSala: async (id, salaId, pass) => {
            await wait(DELAY);
            if (!api.esAdmin()) throw new Error('Acción solo para administradores.');
            const t = db.torneos.find((x) => x.id === id);
            if (!t) throw new Error('Torneo no encontrado.');
            if (!salaId || !pass) throw new Error('Escribe el ID y la contraseña de la sala.');
            t.sala = { id: salaId, pass, publicada: true };
            t.estado = 'en_curso';
            save();
            return clone(t);
        },

        /* ---------- Inscripciones ---------- */
        inscribirse: async (torneoId, equipo) => {
            await wait(DELAY);
            const yo = db.sesion ? usuarioPorId(db.sesion) : null;
            if (!yo) throw new Error('Inicia sesión para inscribirte.');
            const t = db.torneos.find((x) => x.id === torneoId);
            if (!t) throw new Error('Torneo no encontrado.');
            if (t.estado !== 'abierto') throw new Error('Las inscripciones de este torneo están cerradas.');

            const ins = inscripcionesDe(torneoId);
            if (ins.some((i) => i.userId === yo.id)) throw new Error('Ya estás inscrito en este torneo.');
            if (ins.length >= t.cupoMax) throw new Error('Ya no quedan cupos.');

            const requeridos = cupoPorModo[t.modo];
            const miembros = (equipo.miembros || []).filter((m) => m.nick && m.nick.trim());
            const buscando = !!equipo.buscarCompanero && requeridos > 1;
            if (buscando ? miembros.length !== 1 : miembros.length !== requeridos) {
                throw new Error(buscando
                    ? 'Si no tienes compañero, solo van tus datos.'
                    : `Este torneo es ${nombreModo[t.modo]}: necesitas ${requeridos} jugador(es).`);
            }
            // Cada quien paga por los suyos: el que entra solo paga una parte.
            const total = t.costo * miembros.length;
            if (yo.saldo < total) {
                throw new Error(`Saldo insuficiente. Necesitas ${fmtCOP(total)} y tienes ${fmtCOP(yo.saldo)}. Recarga en tu billetera.`);
            }

            yo.saldo -= total;
            tx(yo.id, 'inscripcion', -total, { nota: t.nombre, metodo: 'Saldo', ref: t.id });
            const insc = {
                id: uid('i'),
                torneoId,
                userId: yo.id,
                equipo: { nombre: equipo.nombre || yo.nick, miembros },
                estado: 'confirmada',
                buscando,
                creado: new Date().toISOString(),
                resultado: null
            };
            insc.grupo = insc.id;

            /* En la demo también se junta a los sueltos, para que la pantalla
               se comporte igual que con servidor. */
            if (buscando) {
                const hueco = inscripcionesDe(torneoId)
                    .filter((i) => i.buscando && i.grupo !== insc.id)
                    .find((i) => inscripcionesDe(torneoId)
                        .filter((x) => x.grupo === i.grupo)
                        .reduce((a, x) => a + x.equipo.miembros.length, 0) + miembros.length <= requeridos);
                if (hueco) insc.grupo = hueco.grupo;
            }
            db.inscripciones.push(insc);

            // Si el grupo quedó completo, deja de buscar y toma el nombre de todos.
            const delGrupo = inscripcionesDe(torneoId).filter((i) => i.grupo === insc.grupo);
            const cuantos = delGrupo.reduce((a, i) => a + i.equipo.miembros.length, 0);
            if (cuantos >= requeridos) {
                const nombre = delGrupo.flatMap((i) => i.equipo.miembros).map((x) => x.nick).join(' + ');
                delGrupo.forEach((i) => { i.buscando = false; i.equipo.nombre = nombre; });
            }

            const equipos = new Set(inscripcionesDe(torneoId).map((i) => i.grupo || i.id));
            if (equipos.size >= t.cupoMax) t.estado = 'lleno';
            save();
            return clone(insc);
        },

        jugarSolo: async (torneoId) => {
            await wait(DELAY);
            const yo = db.sesion ? usuarioPorId(db.sesion) : null;
            const i = db.inscripciones.find((x) => x.torneoId === torneoId && x.userId === yo?.id);
            if (!i) throw new Error('No estás inscrito en este torneo.');
            if (!i.buscando) throw new Error('Ya tienes equipo: no hay nada que decidir.');
            i.buscando = false;
            save();
            return { ok: true };
        },

        cancelarInscripcion: async (torneoId) => {
            await wait(DELAY);
            const yo = db.sesion ? usuarioPorId(db.sesion) : null;
            if (!yo) throw new Error('Inicia sesión.');
            const t = db.torneos.find((x) => x.id === torneoId);
            const idx = db.inscripciones.findIndex((i) => i.torneoId === torneoId && i.userId === yo.id);
            if (idx < 0) throw new Error('No estás inscrito en este torneo.');
            if (t.sala.publicada) throw new Error('La sala ya fue publicada: no se puede cancelar.');
            const insc = db.inscripciones[idx];
            const devolver = t.costo * insc.equipo.miembros.length;
            yo.saldo += devolver;
            tx(yo.id, 'reembolso', devolver, { nota: 'Cancelación — ' + t.nombre, metodo: 'Saldo', ref: t.id });
            db.inscripciones.splice(idx, 1);
            if (t.estado === 'lleno') t.estado = 'abierto';
            save();
            return true;
        },

        misTorneos: async () => {
            await wait(60);
            const yo = api.yo();
            if (!yo) return [];
            return db.inscripciones
                .filter((i) => i.userId === yo.id)
                .map((i) => {
                    const t = db.torneos.find((x) => x.id === i.torneoId);
                    return { inscripcion: clone(i), torneo: t ? clone(t) : null };
                })
                .filter((x) => x.torneo)
                .sort((a, b) => new Date(b.torneo.fecha) - new Date(a.torneo.fecha));
        },

        /* ---------- Resultados y premios ---------- */
        registrarResultados: async (torneoId, filas) => {
            await wait(DELAY);
            if (!api.esAdmin()) throw new Error('Acción solo para administradores.');
            const t = db.torneos.find((x) => x.id === torneoId);
            if (!t) throw new Error('Torneo no encontrado.');

            filas.forEach((f) => {
                const insc = db.inscripciones.find((i) => i.id === f.inscripcionId);
                if (!insc) return;
                const dist = t.distribucion.find((d) => d.pos === +f.puesto);
                const premio = dist ? Math.round(t.premioTotal * dist.pct / 100) : 0;
                insc.resultado = { puesto: +f.puesto || 0, kills: +f.kills || 0, puntos: +f.puntos || 0, premio };
                if (premio > 0) {
                    const u = usuarioPorId(insc.userId);
                    if (u) {
                        u.saldo += premio;
                        tx(u.id, 'premio', premio, {
                            nota: `Puesto #${insc.resultado.puesto} — ${t.nombre}`,
                            metodo: 'Saldo', ref: t.id
                        });
                    }
                }
            });
            t.estado = 'finalizado';
            save();
            return clone(t);
        },

        /* ---------- Billetera ---------- */
        movimientos: async () => {
            await wait(60);
            const yo = api.yo();
            if (!yo) return [];
            return clone(db.transacciones.filter((t) => t.userId === yo.id));
        },

        // Recarga. En producción esto lo confirma el webhook de la pasarela,
        // nunca el navegador. Ver ARQUITECTURA.md
        recargar: async (monto, metodo, ref) => {
            await wait(900);
            const yo = db.sesion ? usuarioPorId(db.sesion) : null;
            if (!yo) throw new Error('Inicia sesión.');
            monto = Math.round(+monto);
            if (!monto || monto < 1000) throw new Error('La recarga mínima es de $1.000.');
            yo.saldo += monto;
            const t = tx(yo.id, 'recarga', monto, {
                metodo: metodo || 'Nequi',
                ref: ref || 'SIM-' + Math.floor(Math.random() * 999999),
                nota: 'Recarga de saldo (simulada)'
            });
            save();
            return clone(t);
        },

        solicitarRetiro: async (monto, metodo, cuenta) => {
            await wait(DELAY);
            const yo = db.sesion ? usuarioPorId(db.sesion) : null;
            if (!yo) throw new Error('Inicia sesión.');
            monto = Math.round(+monto);
            if (monto < db.config.minRetiro) {
                throw new Error(`El retiro mínimo es de ${fmtCOP(db.config.minRetiro)}.`);
            }
            if (monto > yo.saldo) throw new Error('No tienes saldo suficiente.');
            if (!cuenta) throw new Error('Escribe el número de cuenta o celular que recibe el dinero.');
            yo.saldo -= monto; // se reserva mientras el admin paga
            const t = tx(yo.id, 'retiro', -monto, {
                estado: 'pendiente', metodo: metodo || 'Nequi',
                ref: cuenta, nota: 'Retiro solicitado'
            });
            save();
            return clone(t);
        },

        retirosPendientes: async () => {
            await wait(60);
            if (!api.esAdmin()) throw new Error('Acción solo para administradores.');
            return db.transacciones
                .filter((t) => t.tipo === 'retiro' && t.estado === 'pendiente')
                .map((t) => {
                    const u = usuarioPorId(t.userId);
                    return Object.assign(clone(t), {
                        nick: u ? u.nick : '—',
                        whatsapp: u ? u.whatsapp : '',
                        ffUid: u ? u.ffUid : ''
                    });
                });
        },

        resolverRetiro: async (txId, aprobar, nota) => {
            await wait(DELAY);
            if (!api.esAdmin()) throw new Error('Acción solo para administradores.');
            const t = db.transacciones.find((x) => x.id === txId);
            if (!t || t.tipo !== 'retiro') throw new Error('Retiro no encontrado.');
            if (t.estado !== 'pendiente') throw new Error('Ese retiro ya fue resuelto.');
            t.estado = aprobar ? 'completada' : 'rechazada';
            t.nota = nota || (aprobar ? 'Pago enviado' : 'Rechazado');
            if (!aprobar) {
                const u = usuarioPorId(t.userId);
                if (u) u.saldo += Math.abs(t.monto); // se devuelve lo reservado
            }
            save();
            return clone(t);
        },

        /* ---------- Encuestas (espejo de la encuesta de WhatsApp) ---------- */
        guardarEncuesta: async (torneoId, encuesta) => {
            await wait(DELAY);
            if (!api.esAdmin()) throw new Error('Acción solo para administradores.');
            const t = db.torneos.find((x) => x.id === torneoId);
            if (!t) throw new Error('Torneo no encontrado.');
            t.encuesta = encuesta;
            save();
            return clone(t);
        },

        /* ---------- Estadísticas ---------- */
        estadisticas: async () => {
            await wait(60);
            const finalizados = db.torneos.filter((t) => t.estado === 'finalizado');
            return {
                torneos: db.torneos.length,
                jugadores: db.inscripciones.reduce((a, i) => a + i.equipo.miembros.length, 0),
                repartido: db.inscripciones.reduce((a, i) => a + (i.resultado ? i.resultado.premio : 0), 0),
                finalizados: finalizados.length
            };
        },

        /* ---------- Utilidades de demo ---------- */
        reiniciarDemo: async () => {
            db = seed();
            save();
        },

        entrarComoDemo: async () => api.login('2148563097', 'demo123'),
        entrarComoAdmin: async () => api.login('1000000001', 'admin123')
    };

    return api;
})();
