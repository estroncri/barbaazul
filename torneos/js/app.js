/* ============================================================
   TORNEOS FF — Aplicación (app.js)
   SPA sin framework: router por hash + vistas que devuelven HTML.
   ============================================================ */

(function () {
    'use strict';

    const S = window.Store;
    const app = document.getElementById('app');
    const $ = (s, c = document) => c.querySelector(s);
    const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

    /* ===== Utilidades ===== */
    const esc = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const money = S.fmtCOP;

    const fecha = (iso) => new Date(iso).toLocaleString('es-CO', {
        weekday: 'short', day: 'numeric', month: 'short',
        hour: 'numeric', minute: '2-digit'
    });

    const fechaCorta = (iso) => new Date(iso).toLocaleDateString('es-CO', {
        day: '2-digit', month: 'short'
    });

    const initials = (nick) => String(nick || '?').trim().slice(0, 2).toUpperCase();

    function toast(texto, tipo) {
        const zone = $('#toasts');
        const el = document.createElement('div');
        el.className = 'toast ' + (tipo || '');
        const ico = tipo === 'err' ? 'bi-exclamation-triangle-fill'
            : tipo === 'ok' ? 'bi-check-circle-fill' : 'bi-info-circle-fill';
        el.innerHTML = `<i class="bi ${ico}"></i><span>${esc(texto)}</span>`;
        zone.appendChild(el);
        setTimeout(() => {
            el.style.transition = 'opacity .3s, transform .3s';
            el.style.opacity = '0'; el.style.transform = 'translateY(10px)';
            setTimeout(() => el.remove(), 320);
        }, 3800);
    }

    function modal(titulo, html) {
        cerrarModal();
        const bg = document.createElement('div');
        bg.className = 'modal-bg';
        bg.id = 'modalBg';
        bg.innerHTML = `
            <div class="modal" role="dialog" aria-modal="true">
                <div class="modal-head">
                    <h3>${esc(titulo)}</h3>
                    <button class="x-btn" data-cerrar aria-label="Cerrar">&times;</button>
                </div>
                ${html}
            </div>`;
        document.body.appendChild(bg);
        bg.addEventListener('click', (e) => {
            if (e.target === bg || e.target.hasAttribute('data-cerrar')) cerrarModal();
        });
        return bg;
    }
    function cerrarModal() { const m = $('#modalBg'); if (m) m.remove(); }
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarModal(); });

    function waLink(texto, numero) {
        const base = numero ? `https://wa.me/${numero}` : 'https://wa.me/';
        return `${base}?text=${encodeURIComponent(texto)}`;
    }

    async function copiar(texto, etiqueta) {
        try {
            await navigator.clipboard.writeText(texto);
            toast((etiqueta || 'Copiado') + ' ✔', 'ok');
        } catch (e) {
            toast('Tu navegador no permitió copiar. Selecciona el texto a mano.', 'err');
        }
    }

    /* ===== Countdown ===== */
    let cdTimer = null;
    let timerVista = null;

    function pararTimerVista() {
        if (timerVista) { clearInterval(timerVista); timerVista = null; }
    }

    /* Refresco en vivo de una pantalla.
       Solo vuelve a pintar si algo CAMBIÓ de verdad (llegó un inscrito, se
       publicó la sala, se cerraron las inscripciones). Repintar cada vez
       reiniciaría las animaciones y cerraría lo que el jugador tenga abierto. */
    function vigilar(traer, firma, cada) {
        pararTimerVista();
        if (S.modo !== 'api') return;          // en modo local no hay nada que vigilar
        let ultima = null;
        timerVista = setInterval(async () => {
            if (document.hidden || document.getElementById('modalBg')) return;
            try {
                const datos = await traer();
                const f = firma(datos);
                if (ultima !== null && f !== ultima) render();
                ultima = f;
            } catch (e) { /* si el servidor no responde, se reintenta luego */ }
        }, cada || 20000);
    }
    function iniciarCountdowns() {
        if (cdTimer) clearInterval(cdTimer);
        const pintar = () => {
            const nodos = $$('[data-cd]');
            if (!nodos.length) { clearInterval(cdTimer); cdTimer = null; return; }
            nodos.forEach((n) => {
                const ms = new Date(n.dataset.cd) - Date.now();
                if (ms <= 0) { n.innerHTML = `<div class="cd-box" style="flex:1"><div class="cd-num">¡EN VIVO!</div></div>`; return; }
                const d = Math.floor(ms / 864e5),
                    h = Math.floor(ms / 36e5) % 24,
                    m = Math.floor(ms / 6e4) % 60,
                    s = Math.floor(ms / 1e3) % 60;
                const box = (v, l, tic) => `<div class="cd-box"><div class="cd-num${tic ? ' tic' : ''}">${String(v).padStart(2, '0')}</div><div class="cd-lbl">${l}</div></div>`;
                n.innerHTML = box(d, 'días') + box(h, 'horas') + box(m, 'min') + box(s, 'seg', true);
            });
        };
        pintar();
        cdTimer = setInterval(pintar, 1000);
    }

    /* ===== Navbar ===== */
    const RUTAS_NAV = [
        { h: '#/', t: 'Inicio', i: 'bi-house-door-fill' },
        { h: '#/torneos', t: 'Torneos', i: 'bi-trophy-fill' },
        { h: '#/billetera', t: 'Billetera', i: 'bi-wallet2' },
        { h: '#/perfil', t: 'Mi perfil', i: 'bi-person-fill' },
        { h: '#/reglas', t: 'Reglas', i: 'bi-shield-check' }
    ];

    function pintarNav() {
        const yo = S.yo();
        const ruta = location.hash || '#/';
        const activo = (h) => (ruta === h || (h !== '#/' && ruta.startsWith(h)) ? 'on' : '');

        $('#navLinks').innerHTML = RUTAS_NAV
            .map((r) => `<a href="${r.h}" class="${activo(r.h)}">${r.t}</a>`).join('') +
            (S.esAdmin() ? `<a href="#/admin" class="${activo('#/admin')}">Panel</a>` : '');

        $('#drawer').innerHTML = RUTAS_NAV
            .map((r) => `<a href="${r.h}" class="${activo(r.h)}"><i class="bi ${r.i}"></i>${r.t}</a>`).join('') +
            (S.esAdmin() ? `<a href="#/admin" class="${activo('#/admin')}"><i class="bi bi-sliders"></i>Panel admin</a>` : '') +
            (yo
                ? `<a href="#" id="salirDrawer"><i class="bi bi-box-arrow-right"></i>Cerrar sesión</a>`
                : `<a href="#/entrar"><i class="bi bi-box-arrow-in-right"></i>Entrar / Registrarme</a>`);

        $('#navRight').innerHTML = yo
            ? `<span class="saldo-chip"><i class="bi bi-cash-coin"></i>${money(yo.saldo)}</span>
               <button class="avatar-btn" id="btnPerfil" title="${esc(yo.nick)}">${esc(initials(yo.nick))}</button>`
            : `<a href="#/entrar" class="btn btn-fire btn-sm">Entrar</a>`;

        const bp = $('#btnPerfil');
        if (bp) bp.onclick = () => { location.hash = '#/perfil'; };
        const sd = $('#salirDrawer');
        if (sd) sd.onclick = async (e) => {
            e.preventDefault();
            await S.logout();
            cerrarDrawer(); toast('Sesión cerrada', 'ok');
            location.hash = '#/';
            render();
        };
    }

    function cerrarDrawer() { $('#drawer').classList.remove('open'); }
    $('#burger').onclick = () => $('#drawer').classList.toggle('open');
    $('#drawer').addEventListener('click', (e) => { if (e.target.tagName === 'A') cerrarDrawer(); });

    /* ============================================================
       VISTAS
       ============================================================ */
    const V = {};

    /* ---------- INICIO ---------- */
    V.inicio = async function () {
        const [torneos, stats, cfg] = await Promise.all([S.torneos(), S.estadisticas(), Promise.resolve(S.config())]);
        const proximos = torneos.filter((t) => t.estado === 'abierto' || t.estado === 'lleno' || t.estado === 'en_curso');
        const destacado = proximos[0] || torneos[0];

        return `
        <section class="hero wrap">
            <img src="img/logo.svg" alt="Torneos FF" class="hero-logo reveal">
            <div class="hero-badge reveal"><span class="dot-live"></span>Inscripciones abiertas</div>
            <h1 class="reveal">${porPalabras('Torneos de')} ${porPalabras('Free Fire', 'grad-fire')}<br>${porPalabras('con premios')} ${porPalabras('reales', 'grad-oro')}</h1>
            <p class="lead reveal">Conecta tu cuenta de Free Fire, paga tu cupo desde la plataforma y compite.
            Los participantes, la sala y los resultados se publican aquí para que todo quede claro.
            El aviso de cada torneo y la encuesta del modo salen en el grupo de WhatsApp.</p>
            <div class="hero-cta reveal">
                <a href="#/torneos" class="btn btn-fire"><i class="bi bi-trophy-fill"></i> Ver torneos</a>
                <a href="${esc(cfg.whatsappGrupo)}" target="_blank" rel="noopener" class="btn btn-wa"><i class="bi bi-whatsapp"></i> Entrar al grupo</a>
            </div>
        </section>

        ${destacado ? `
        <section class="section wrap">
            <div class="card card-ardiendo destacada" style="padding:clamp(20px,4vw,32px)">
                <div class="t-meta">
                    <span class="pill pill-${destacado.modo}">${S.nombreModo[destacado.modo]}</span>
                    <span class="pill pill-${destacado.estado}">${etiquetaEstado(destacado.estado)}</span>
                    <span class="muted"><i class="bi bi-geo-alt"></i> ${esc(destacado.mapa)}</span>
                </div>
                <h2 style="margin:6px 0 2px">${esc(destacado.nombre)}</h2>
                <div class="t-fecha mb"><i class="bi bi-calendar-event"></i> ${fecha(destacado.fecha)}</div>
                <div class="countdown" data-cd="${destacado.fecha}"></div>
                <div class="grid g3" style="gap:10px">
                    <div class="stat card" style="padding:12px 8px">
                        <div class="stat-num grad-fire" data-valor="${destacado.precioKill || 0}" data-formato="cop">${money(destacado.precioKill || 0)}</div>
                        <div class="stat-lbl">Por cada kill</div>
                    </div>
                    <div class="stat card" style="padding:12px 8px">
                        <div class="stat-num">${money(destacado.premioGanador || 0)}</div>
                        <div class="stat-lbl">Al ganador</div>
                    </div>
                    <div class="stat card" style="padding:12px 8px">
                        <div class="stat-num">${destacado.inscritos}/${destacado.cupoMax}</div>
                        <div class="stat-lbl">${destacado.modo === 'solo' ? 'Jugadores' : 'Equipos'}</div>
                    </div>
                </div>
                <a href="#/torneo/${destacado.id}" class="btn btn-fire btn-block mt">
                    <i class="bi bi-controller"></i> Inscribirme ahora
                </a>
            </div>
        </section>` : ''}

        <div class="separador" aria-hidden="true"><i class="bi bi-fire"></i></div>

        <section class="section wrap">
            <div class="titulo-seccion">
                <span class="eyebrow">Agenda</span>
                <h2>Próximos torneos</h2>
                <p>Cada torneo dice su modo, su cupo y cuánto reparte antes de que pagues nada.</p>
            </div>
            <div class="grid g-cards">
                ${(proximos.length ? proximos : torneos).slice(0, 3).map(cardTorneo).join('')}
            </div>
            <div class="center mt">
                <a href="#/torneos" class="btn btn-ghost">Ver todos los torneos <i class="bi bi-arrow-right"></i></a>
            </div>
        </section>

        <section class="section wrap">
            <div class="titulo-seccion">
                <span class="eyebrow">La comunidad</span>
                <h2>Los números</h2>
            </div>
            <div class="grid g4">
                <div class="card stat reveal"><div class="stat-num grad-fire" data-valor="${stats.torneos}">${stats.torneos}</div><div class="stat-lbl">Torneos</div></div>
                <div class="card stat reveal"><div class="stat-num grad-oro" data-valor="${stats.jugadores}">${stats.jugadores}</div><div class="stat-lbl">Inscripciones</div></div>
                <div class="card stat reveal"><div class="stat-num" style="color:var(--verde)" data-valor="${stats.repartido}" data-formato="cop">${money(stats.repartido)}</div><div class="stat-lbl">Repartido</div></div>
                <div class="card stat reveal"><div class="stat-num" data-valor="${stats.finalizados}">${stats.finalizados}</div><div class="stat-lbl">Finalizados</div></div>
            </div>
        </section>

        <div class="separador" aria-hidden="true"><i class="bi bi-fire"></i></div>

        <section class="section wrap">
            <div class="titulo-seccion">
                <span class="eyebrow">Paso a paso</span>
                <h2>Cómo funciona</h2>
                <p>Del aviso en el grupo hasta la plata en tu cuenta, en seis pasos.</p>
            </div>
            <div class="grid g2">
                ${[
                    ['Conecta tu cuenta', 'Entras con tu ID de Free Fire. La plataforma trae tu nick, nivel y rango, y te da un código para verificar que la cuenta es tuya.'],
                    ['Mira el aviso en WhatsApp', 'En el grupo se anuncia el torneo y se hace la encuesta: Solo, Dúo o Escuadra. El resultado queda publicado también aquí.'],
                    ['Compra tu cupo', 'Recargas saldo (Nequi, Daviplata, Bancolombia) y pagas la inscripción. Tu nombre aparece de una en la lista de participantes.'],
                    ['Entra a la sala', 'El ID y la contraseña de la sala se liberan solo para los inscritos, poco antes de empezar.'],
                    ['Resultados públicos', 'Kills, puestos y puntos quedan en la tabla del torneo. Nada de capturas por privado.'],
                    ['Retira tu plata', 'Los premios caen a tu saldo y pides el retiro a tu Nequi o cuenta bancaria.']
                ].map(([t, d], i) => `
                    <div class="card paso reveal">
                        <div class="paso-n">${i + 1}</div>
                        <h4>${t}</h4>
                        <p>${d}</p>
                    </div>`).join('')}
            </div>
        </section>`;
    };

    /* Parte un texto en palabras animables, escalonadas.
       La clase del degradado va en CADA palabra: si se pone solo en el
       contenedor, el recorte del degradado no alcanza a los hijos y las
       palabras salen transparentes (es decir, invisibles). */
    let contadorPalabra = 0;
    function porPalabras(texto, clase) {
        return texto.split(' ').map((p) => {
            const n = contadorPalabra++;
            return `<span class="palabra ${clase || ''}" style="animation-delay:${(0.05 + n * 0.07).toFixed(2)}s">${esc(p)}</span>`;
        }).join(' ');
    }

    /* Lo que se propone al crear cada tipo de torneo. El organizador lo
       puede cambiar torneo por torneo; esto es solo el punto de partida. */
    const REGLAS_MODO = {
        solo:     { costo: 5000, minimo: 20, precioKill: 3000, premioGanador: 10000, unidad: 'jugadores' },
        duo:      { costo: 5000, minimo: 5,  precioKill: 3000, premioGanador: 15000, unidad: 'dúos' },
        escuadra: { costo: 5000, minimo: 10, precioKill: 3500, premioGanador: 0,     unidad: 'escuadras' }
    };
    const unidadDe = (modo) => (REGLAS_MODO[modo] || REGLAS_MODO.solo).unidad;

    /* Cómo se describe el premio ahora: no hay bolsa fija, sale de las kills. */
    function textoPremio(t) {
        const partes = [];
        if (t.precioKill) partes.push(`${money(t.precioKill)} por kill`);
        if (t.premioGanador) partes.push(`${money(t.premioGanador)} al ganador`);
        return partes.length ? partes.join(' + ') : 'Sin premio en dinero';
    }

    function etiquetaEstado(e) {
        return { abierto: 'Inscripciones abiertas', lleno: 'Cupos llenos', en_curso: 'En curso',
                 finalizado: 'Finalizado', proximo: 'Próximamente', cancelado: 'Cancelado' }[e] || e;
    }

    function cardTorneo(t) {
        const pct = Math.min(100, Math.round((t.inscritos / t.cupoMax) * 100));
        return `
        <a href="#/torneo/${t.id}" class="card card-hover t-card reveal" data-tema="${esc(t.tema || 'fuego')}" data-estado="${esc(t.estado)}">
            <div class="t-top">
                <div class="t-meta">
                    <span class="pill pill-${t.modo}">${S.nombreModo[t.modo]}</span>
                    <span class="pill pill-${t.estado}">${etiquetaEstado(t.estado)}</span>
                </div>
                <h3>${esc(t.nombre)}</h3>
                <div class="t-fecha"><i class="bi bi-calendar-event"></i> ${fecha(t.fecha)}</div>
            </div>
            <div class="t-body">
                <div class="t-rows">
                    <div class="t-row"><span>Por kill</span><b class="premio grad-fire">${money(t.precioKill || 0)}</b></div>
                    ${t.premioGanador ? `<div class="t-row"><span>Al ganador</span><b>${money(t.premioGanador)}</b></div>` : ''}
                    <div class="t-row"><span>Inscripción</span><b>${money(t.costo)}</b></div>
                    <div class="t-row"><span>Mapa</span><b>${esc(t.mapa)}</b></div>
                </div>
                <div class="t-row" style="margin-bottom:6px">
                    <span>${t.modo === 'solo' ? 'Jugadores' : 'Equipos'}</span>
                    <b>${t.inscritos}/${t.cupoMax}</b>
                </div>
                ${t.minimo && t.inscritos < t.minimo ? `<div class="muted" style="font-size:.74rem;margin-bottom:6px">
                    Faltan ${t.minimo - t.inscritos} ${unidadDe(t.modo)} para que la sala se juegue</div>` : ''}
                <div class="cupo-bar"><div class="cupo-fill ${pct >= 100 ? 'full' : ''}" style="width:${pct}%"></div></div>
            </div>
        </a>`;
    }

    /* ---------- LISTA DE TORNEOS ---------- */
    let filtroTorneos = 'todos';
    V.torneos = async function () {
        const torneos = await S.torneos();
        const filtrar = (lista) => {
            if (filtroTorneos === 'todos') return lista;
            if (filtroTorneos === 'abiertos') return lista.filter((t) => t.estado === 'abierto');
            if (filtroTorneos === 'finalizados') return lista.filter((t) => t.estado === 'finalizado');
            return lista.filter((t) => t.modo === filtroTorneos);
        };
        const lista = filtrar(torneos);
        const tabs = [
            ['todos', 'Todos'], ['abiertos', 'Abiertos'], ['solo', 'Solo'],
            ['duo', 'Dúo'], ['escuadra', 'Escuadra'], ['finalizados', 'Finalizados']
        ];
        return `
        <div class="wrap">
            <div class="titulo-seccion" style="margin-top:8px">
                <span class="eyebrow">Calendario</span>
                <h2>Torneos</h2>
                <p>Escoge tu torneo, paga el cupo y aparece en la lista de participantes al instante.</p>
            </div>
            <div class="tabs tabs-centro" id="tabsTorneos">
                ${tabs.map(([k, t]) => `<button class="tab ${filtroTorneos === k ? 'on' : ''}" data-f="${k}">${t}</button>`).join('')}
            </div>
            ${lista.length
                ? `<div class="grid g-cards">${lista.map(cardTorneo).join('')}</div>`
                : `<div class="empty"><i class="bi bi-inbox"></i>No hay torneos en este filtro.</div>`}
        </div>`;
    };

    V.torneos.despues = function () {
        vigilar(() => S.torneos(),
                (l) => l.map((t) => t.id + t.estado + t.inscritos).join('|'), 25000);
        $$('#tabsTorneos .tab').forEach((b) => {
            b.onclick = () => { filtroTorneos = b.dataset.f; render(); };
        });
    };

    /* ---------- DETALLE DE TORNEO ---------- */
    V.torneo = async function (id) {
        const t = await S.torneo(id);
        const yo = S.yo();
        const pct = Math.min(100, Math.round((t.inscritos / t.cupoMax) * 100));
        const requeridos = S.cupoPorModo[t.modo];
        const finalizado = t.estado === 'finalizado';

        const participantes = finalizado
            ? t.participantes.slice().sort((a, b) =>
                ((a.resultado && a.resultado.puesto) || 99) - ((b.resultado && b.resultado.puesto) || 99))
            : t.participantes;

        const puedeInscribirse = t.estado === 'abierto' && !t.miInscripcion;

        return `
        <div class="wrap">
            <a href="#/torneos" class="muted" style="display:inline-block;margin-bottom:14px">
                <i class="bi bi-arrow-left"></i> Volver a torneos
            </a>

            <div class="split">
                <div>
                    <div class="card" data-tema="${esc(t.tema || 'fuego')}" style="padding:0">
                        <div class="t-top detalle-cabecera" style="padding:clamp(20px,4vw,28px)">
                            <div class="t-meta">
                                <span class="pill pill-${t.modo}">${S.nombreModo[t.modo]}</span>
                                <span class="pill pill-${t.estado}">${etiquetaEstado(t.estado)}</span>
                                <span class="muted"><i class="bi bi-geo-alt"></i> ${esc(t.mapa)}</span>
                            </div>
                            <h1 style="font-size:clamp(1.9rem,7vw,3rem);margin-bottom:6px">${esc(t.nombre)}</h1>
                            <div class="t-fecha"><i class="bi bi-calendar-event"></i> ${fecha(t.fecha)}</div>
                        </div>
                        <div class="detalle-cuerpo" style="padding:clamp(18px,3vw,26px)">
                            ${!finalizado ? `<div class="countdown" data-cd="${t.fecha}"></div>` : ''}
                            <div class="grid g3" style="gap:10px">
                                <div class="stat" style="padding:10px 6px">
                                    <div class="stat-num grad-fire" data-valor="${t.precioKill || 0}" data-formato="cop">${money(t.precioKill || 0)}</div>
                                    <div class="stat-lbl">Por cada kill</div>
                                </div>
                                <div class="stat" style="padding:10px 6px">
                                    <div class="stat-num">${money(t.costo * requeridos)}</div>
                                    <div class="stat-lbl">Inscripción ${t.modo === 'solo' ? '' : '(' + requeridos + ' jug.)'}</div>
                                </div>
                                <div class="stat" style="padding:10px 6px">
                                    <div class="stat-num">${t.inscritos}/${t.cupoMax}</div>
                                    <div class="stat-lbl">${t.modo === 'solo' ? 'Jugadores' : 'Equipos'}</div>
                                </div>
                            </div>
                            <div class="cupo-bar mt"><div class="cupo-fill ${pct >= 100 ? 'full' : ''}" style="width:${pct}%"></div></div>
                            <div class="muted mt">${pct >= 100 ? 'Cupos agotados' : `Quedan ${t.cupoMax - t.inscritos} cupos`}</div>
                            ${t.minimo ? `<div class="msg ${t.inscritos >= t.minimo ? 'msg-ok' : 'msg-warn'} mt" style="font-size:.82rem">
                                ${t.inscritos >= t.minimo
                                    ? `<i class="bi bi-check-circle-fill"></i> Ya hay ${t.inscritos} ${unidadDe(t.modo)}: la sala se juega.`
                                    : `Esta sala se juega con mínimo <b>${t.minimo} ${unidadDe(t.modo)}</b>. Van ${t.inscritos}: faltan ${t.minimo - t.inscritos}. Si no se llega, se cancela y se devuelve el cupo completo.`}
                            </div>` : ''}

                            <div class="flex mt">
                                ${puedeInscribirse
                                    ? `<button class="btn btn-fire" id="btnInscribir"><i class="bi bi-controller"></i> Comprar mi cupo — ${money(t.costo * requeridos)}</button>`
                                    : t.miInscripcion
                                        ? `<span class="pill pill-abierto" style="padding:9px 14px"><i class="bi bi-check-circle-fill"></i> Ya estás inscrito</span>
                                           ${!t.sala.publicada ? `<button class="btn btn-danger btn-sm" id="btnCancelar">Cancelar y que me devuelvan</button>` : ''}`
                                        : `<button class="btn btn-ghost" disabled>${etiquetaEstado(t.estado)}</button>`}
                                <button class="btn btn-wa btn-sm" id="btnCompartir"><i class="bi bi-whatsapp"></i> Compartir</button>
                            </div>
                        </div>
                    </div>

                    ${bloqueSala(t)}

                    <div class="card mt">
                        <div class="section-head" style="margin-bottom:12px">
                            <h3>${finalizado ? 'Resultados' : 'Participantes inscritos'}</h3>
                            <span class="muted">${t.jugadores} jugador(es)</span>
                        </div>
                        ${participantes.length ? `<div class="p-list">${participantes.map((p, i) => filaParticipante(p, i, t, yo)).join('')}</div>`
                            : `<div class="empty"><i class="bi bi-people"></i>Todavía nadie se ha inscrito. ¡Sé el primero!</div>`}
                    </div>
                </div>

                <div>
                    ${bloqueEncuesta(t)}
                    <div class="card mt">
                        <h3 class="mb">Cómo se gana</h3>
                        <div class="t-row" style="padding:9px 0;border-bottom:1px solid var(--line)">
                            <span><i class="bi bi-crosshair"></i> Cada kill</span><b>${money(t.precioKill || 0)}</b>
                        </div>
                        ${t.premioGanador ? `<div class="t-row" style="padding:9px 0;border-bottom:1px solid var(--line)">
                            <span><i class="bi bi-trophy-fill"></i> Ganar la partida</span><b>${money(t.premioGanador)}</b>
                        </div>` : ''}
                        <p class="muted mt" style="line-height:1.6">
                            Se juega <b>una sola partida</b>. Lo que ganes sale de tus kills; si además quedas
                            primero, se suma el bono. Ejemplo: 6 kills${t.premioGanador ? ' y el primer puesto' : ''}
                            son <b>${money(6 * (t.precioKill || 0) + (t.premioGanador || 0))}</b>.
                        </p>
                    </div>
                    <div class="card mt">
                        <h3 class="mb">Reglas del torneo</h3>
                        ${t.reglas.length ? `<ul style="padding-left:18px;display:grid;gap:9px">
                            ${t.reglas.map((r) => `<li style="font-size:.85rem;color:var(--txt-2);line-height:1.5">${esc(r)}</li>`).join('')}
                        </ul>` : '<p class="muted">Sin reglas específicas.</p>'}
                        <a href="#/reglas" class="muted mt" style="display:inline-block">Ver reglas generales <i class="bi bi-arrow-right"></i></a>
                    </div>
                </div>
            </div>
        </div>`;
    };

    function bloqueSala(t) {
        const yo = S.yo();
        if (!t.sala.publicada) {
            return `<div class="card mt">
                <h3 class="mb">Sala personalizada</h3>
                <div class="locked">
                    <i class="bi bi-lock-fill"></i>
                    El ID y la contraseña de la sala se publican aquí 10 minutos antes de empezar,
                    y solo los ven los inscritos.
                </div>
            </div>`;
        }
        if (!t.miInscripcion && !(yo && yo.rol === 'admin')) {
            return `<div class="card mt">
                <h3 class="mb">Sala personalizada</h3>
                <div class="locked"><i class="bi bi-lock-fill"></i>Los datos de la sala son solo para los jugadores inscritos.</div>
            </div>`;
        }
        return `<div class="card mt">
            <h3 class="mb">Sala personalizada</h3>
            <div class="sala-box">
                <div class="sala-dato">
                    <span class="muted">ID de sala</span>
                    <span class="flex"><span class="sala-val">${esc(t.sala.id)}</span>
                    <button class="btn btn-ghost btn-sm" data-copiar="${esc(t.sala.id)}"><i class="bi bi-clipboard"></i></button></span>
                </div>
                <div class="sala-dato">
                    <span class="muted">Contraseña</span>
                    <span class="flex"><span class="sala-val">${esc(t.sala.pass)}</span>
                    <button class="btn btn-ghost btn-sm" data-copiar="${esc(t.sala.pass)}"><i class="bi bi-clipboard"></i></button></span>
                </div>
            </div>
        </div>`;
    }

    function bloqueEncuesta(t) {
        if (!t.encuesta) return '';
        const e = t.encuesta;
        const total = e.opciones.reduce((a, o) => a + o.votos, 0) || 1;
        const max = Math.max(...e.opciones.map((o) => o.votos));
        return `<div class="card">
            <div class="flex" style="justify-content:space-between;margin-bottom:4px">
                <h3>Encuesta de WhatsApp</h3>
                <span class="pill ${e.cerrada ? 'pill-finalizado' : 'pill-abierto'}">${e.cerrada ? 'Cerrada' : 'Abierta'}</span>
            </div>
            <p class="muted mb">${esc(e.pregunta)}</p>
            ${e.opciones.map((o) => {
                const pct = Math.round(o.votos / total * 100);
                return `<div class="enc-opt">
                    <div class="enc-top"><span>${esc(o.texto)}${o.votos === max ? ' <i class="bi bi-trophy-fill" style="color:var(--fire-2)"></i>' : ''}</span><b>${pct}% · ${o.votos}</b></div>
                    <div class="enc-bar"><div class="enc-fill ${o.votos === max ? 'win' : ''}" style="width:${pct}%"></div></div>
                </div>`;
            }).join('')}
            <div class="muted mt">Resultado tomado de la encuesta del grupo. Votos totales: ${total}.</div>
        </div>`;
    }

    function filaParticipante(p, i, t, yo) {
        const r = p.resultado;
        const esMio = yo && p.userId === yo.id;
        const num = r && r.puesto ? r.puesto : i + 1;
        const clase = r && r.puesto && r.puesto <= 3 ? 'top' + r.puesto : '';
        return `<div class="p-item ${esMio ? 'yo' : ''}" style="animation: subir .5s ${Math.min(i * 0.05, 0.6)}s both">
            <div class="p-num ${clase}">${num}</div>
            <div class="p-info">
                <div class="p-nick">${esc(p.equipo.nombre)} ${esMio ? '<span class="pill pill-abierto" style="font-size:.6rem">TÚ</span>' : ''}</div>
                <div class="p-sub">Inscrito ${fechaCorta(p.creado)} · ${p.equipo.miembros.length} jug.</div>
                ${t.modo !== 'solo' ? `<div class="miembros">${p.equipo.miembros.map((m) => `<span class="chip-mini">${esc(m.nick)}</span>`).join('')}</div>` : ''}
            </div>
            ${r ? `<div class="p-right">
                <div class="p-kills">${r.kills} <span style="font-size:.7rem;color:var(--txt-3)">kills</span></div>
                ${r.premio ? `<div class="muted" style="color:var(--verde)">+${money(r.premio)}</div>` : `<div class="muted">${r.puntos} pts</div>`}
            </div>` : `<div class="p-right"><span class="pill pill-abierto">Pago ✔</span></div>`}
        </div>`;
    }

    V.torneo.despues = function (id) {
        iniciarCountdowns();

        // Si entra alguien más o el organizador publica la sala, la pantalla
        // se actualiza sola: nadie tiene que recargar para ver su sala.
        vigilar(
            () => S.torneo(id),
            (t) => [t.inscritos, t.estado, t.sala.publicada, t.sala.id,
                    (t.participantes || []).length].join('|'),
            15000
        );
        $$('[data-copiar]').forEach((b) => { b.onclick = () => copiar(b.dataset.copiar); });

        const bi = $('#btnInscribir');
        if (bi) bi.onclick = () => abrirInscripcion(id);

        const bc = $('#btnCancelar');
        if (bc) bc.onclick = async () => {
            if (!confirm('¿Seguro que quieres cancelar tu inscripción? Te devolvemos el valor a tu saldo.')) return;
            try {
                await S.cancelarInscripcion(id);
                toast('Inscripción cancelada, saldo devuelto', 'ok');
                render();
            } catch (e) { toast(e.message, 'err'); }
        };

        const bs = $('#btnCompartir');
        if (bs) bs.onclick = async () => {
            const t = await S.torneo(id);
            const txt = `🔥 *${t.nombre}* — ${S.nombreModo[t.modo]}\n`
                + `🏆 Premio: ${money(t.premioTotal)}\n`
                + `💵 Cupo: ${money(t.costo)} por jugador\n`
                + `🗓️ ${fecha(t.fecha)}\n`
                + `🎮 Mapa: ${t.mapa}\n`
                + `👥 Cupos: ${t.inscritos}/${t.cupoMax}\n\n`
                + `Inscríbete aquí 👉 ${location.origin + location.pathname}#/torneo/${t.id}`;
            window.open(waLink(txt), '_blank', 'noopener');
        };
    };

    async function abrirInscripcion(torneoId) {
        const yo = S.yo();
        if (!yo) {
            toast('Primero entra con tu cuenta de Free Fire', 'err');
            location.hash = '#/entrar';
            return;
        }
        const t = await S.torneo(torneoId);
        const req = S.cupoPorModo[t.modo];
        const total = t.costo * req;

        const campos = [];
        for (let i = 0; i < req; i++) {
            campos.push(`
            <div class="row-2">
                <div class="field">
                    <label>${i === 0 ? 'Tu nick (capitán)' : 'Nick jugador ' + (i + 1)}</label>
                    <input type="text" data-nick="${i}" value="${i === 0 ? esc(yo.nick) : ''}" placeholder="Nick exacto en el juego" ${i === 0 ? 'readonly' : ''}>
                </div>
                <div class="field">
                    <label>ID de Free Fire</label>
                    <input type="text" data-uid="${i}" value="${i === 0 ? esc(yo.ffUid) : ''}" placeholder="Ej: 2148563097" inputmode="numeric" ${i === 0 ? 'readonly' : ''}>
                </div>
            </div>`);
        }

        const m = modal('Comprar cupo', `
            <div class="msg msg-info">
                <b>${esc(t.nombre)}</b> · ${S.nombreModo[t.modo]}<br>
                Valor del cupo: <b>${money(total)}</b> ${req > 1 ? `(${money(t.costo)} × ${req} jugadores)` : ''}<br>
                Tu saldo: <b>${money(yo.saldo)}</b>
            </div>
            <div id="inscErr"></div>
            ${req > 1 ? `<div class="field">
                <label>Nombre del equipo</label>
                <input type="text" id="equipoNombre" placeholder="Ej: Los Tiburones" maxlength="24">
            </div>` : ''}
            ${campos.join('')}
            <div class="msg msg-warn" style="font-size:.78rem">
                El nick debe ser idéntico al del juego. Si no coincide, el equipo queda descalificado y no hay devolución.
            </div>
            <button class="btn btn-fire btn-block" id="confirmarInsc">Pagar ${money(total)} con mi saldo</button>
            <a href="#/billetera" class="btn btn-ghost btn-block mt" data-cerrar>Recargar saldo</a>
        `);

        $('#confirmarInsc', m).onclick = async function () {
            const btn = this;
            const miembros = [];
            for (let i = 0; i < req; i++) {
                miembros.push({
                    nick: ($(`[data-nick="${i}"]`, m).value || '').trim(),
                    uid: ($(`[data-uid="${i}"]`, m).value || '').trim()
                });
            }
            const nombre = req > 1 ? ($('#equipoNombre', m).value || '').trim() : yo.nick;
            btn.disabled = true; btn.textContent = 'Procesando...';
            try {
                await S.inscribirse(torneoId, { nombre, miembros });
                cerrarModal();
                toast('¡Listo! Ya estás en la lista de participantes', 'ok');
                render();
            } catch (e) {
                $('#inscErr', m).innerHTML = `<div class="msg msg-err">${esc(e.message)}</div>`;
                btn.disabled = false; btn.textContent = `Pagar ${money(total)} con mi saldo`;
            }
        };
    }

    /* ---------- ENTRAR ---------- */
    V.entrar = async function () {
        return `
        <div class="wrap" style="max-width:520px">
            <div class="center mb">
                <div class="eyebrow">Acceso</div>
                <h2>Entra con tu cuenta</h2>
                <p class="muted">Usa tu ID de Free Fire o tu correo.</p>
            </div>
            <div class="card">
                <div id="loginMsg"></div>
                <div class="field">
                    <label>ID de Free Fire o correo</label>
                    <input type="text" id="loginUser" placeholder="2148563097" autocomplete="username">
                </div>
                <div class="field">
                    <label>Contraseña</label>
                    <input type="password" id="loginPass" placeholder="••••••" autocomplete="current-password">
                </div>
                <button class="btn btn-fire btn-block" id="btnLogin">Entrar</button>
                <div class="divider"></div>
                <a href="#/registro" class="btn btn-ghost btn-block">
                    <i class="bi bi-person-plus-fill"></i> Conectar mi cuenta de Free Fire
                </a>
                ${S.modo === 'api' ? '' : `
                <div class="divider"></div>
                <p class="muted center mb">Cuentas de prueba de esta demo:</p>
                <div class="row-2">
                    <button class="btn btn-ghost btn-sm" id="btnDemo">Entrar como jugador</button>
                    <button class="btn btn-ghost btn-sm" id="btnAdmin">Entrar como admin</button>
                </div>`}
            </div>
        </div>`;
    };

    V.entrar.despues = function () {
        const err = (m) => { $('#loginMsg').innerHTML = `<div class="msg msg-err">${esc(m)}</div>`; };

        $('#btnLogin').onclick = async function () {
            this.disabled = true;
            try {
                const u = await S.login($('#loginUser').value.trim(), $('#loginPass').value);
                toast('¡Bienvenido, ' + u.nick + '!', 'ok');
                location.hash = '#/';
                render();
            } catch (e) { err(e.message); this.disabled = false; }
        };
        $('#loginPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnLogin').click(); });

        const bd = $('#btnDemo');
        if (!bd) return;
        bd.onclick = async () => {
            await S.entrarComoDemo(); toast('Sesión de jugador demo', 'ok');
            location.hash = '#/'; render();
        };
        $('#btnAdmin').onclick = async () => {
            await S.entrarComoAdmin(); toast('Sesión de administrador', 'ok');
            location.hash = '#/admin'; render();
        };
    };

    /* ---------- REGISTRO (conectar cuenta de Free Fire) ---------- */
    let regPerfil = null;
    V.registro = async function () {
        const cfg = S.config();
        const regiones = window.PerfilFF.REGIONES;
        return `
        <div class="wrap" style="max-width:560px">
            <div class="center mb">
                <div class="eyebrow">Paso 1 de 2</div>
                <h2>Conecta tu cuenta de Free Fire</h2>
            </div>
            <div class="steps"><div class="step on" id="s1"></div><div class="step" id="s2"></div></div>
            <div class="card" id="regCard">
                <div id="regMsg"></div>
                <div class="field">
                    <label>Tu ID de Free Fire</label>
                    <input type="text" id="regUid" inputmode="numeric" placeholder="Ej: 1890109056" autocomplete="off">
                    <div class="hint">Está en el juego, en tu perfil, debajo del nombre. Son solo números.</div>
                </div>
                <div class="field">
                    <label>Región de tu cuenta</label>
                    <select id="regRegion">
                        ${Object.entries(regiones).map(([k, v]) =>
                            `<option value="${k}" ${k === cfg.regionPorDefecto ? 'selected' : ''}>${esc(v)}</option>`).join('')}
                    </select>
                </div>
                <button class="btn btn-oro btn-block" id="btnBuscar">
                    <i class="bi bi-search"></i> Buscar mi cuenta
                </button>
                <div class="msg msg-warn mt" style="font-size:.78rem">
                    <b>Nunca</b> te vamos a pedir la contraseña de Free Fire, ni tu cuenta de Google o Facebook.
                    Con el ID solo se ven los datos públicos de tu perfil, igual que en el juego.
                </div>
            </div>
        </div>`;
    };

    V.registro.despues = function () {
        regPerfil = null;
        $('#btnBuscar').onclick = async function () {
            const uidVal = $('#regUid').value.trim();
            const regionVal = $('#regRegion').value;
            this.disabled = true; this.innerHTML = '<i class="bi bi-hourglass-split"></i> Buscando tu cuenta...';
            try {
                regPerfil = await S.consultarPerfilFF(uidVal, regionVal);
                pintarPaso2();
            } catch (e) {
                $('#regMsg').innerHTML = `<div class="msg msg-err">${esc(e.message)}</div>`;
                this.disabled = false; this.innerHTML = '<i class="bi bi-search"></i> Buscar mi cuenta';
                $('#regMsg').innerHTML += `<button class="btn btn-ghost btn-block btn-sm mb" id="btnManual">
                    <i class="bi bi-pencil"></i> Escribir mis datos a mano</button>`;
                const bm = $('#btnManual');
                if (bm) bm.onclick = () => {
                    regPerfil = Object.assign(window.PerfilFF.perfilSimulado(($('#regUid').value.trim() || '0').replace(/\D/g, '') || '1000000000', $('#regRegion').value), { fuente: 'manual', nick: '' });
                    pintarPaso2();
                };
            }
        };
    };


    /* Tarjeta con los datos del perfil de Free Fire */
    function tarjetaPerfilFF(p, opciones) {
        const op = opciones || {};
        const F = window.PerfilFF;
        const dato = (etq, val, ico) => val
            ? `<div class="ff-dato"><span class="muted"><i class="bi ${ico}"></i> ${etq}</span><b>${esc(val)}</b></div>`
            : '';
        const creada = p.creada
            ? new Date(p.creada).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })
            : null;
        const inventado = p.fuente === 'simulado';
        return `
        <div class="ff-perfil ${inventado ? 'ff-ejemplo' : ''}">
            ${inventado ? `<div class="ff-cinta"><i class="bi bi-cone-striped"></i> Ejemplo · no es una cuenta real</div>` : ''}
            <div class="ff-perfil-top">
                <div class="ff-ava">${p.avatarUrl
                    ? `<img src="${esc(p.avatarUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:14px">`
                    : esc(initials(p.nick))}</div>
                <div style="min-width:0;flex:1">
                    <div class="ff-nick">${esc(p.nick || '—')}</div>
                    <div class="muted mono">ID ${esc(p.uid)}</div>
                    ${p.bio ? `<div class="muted" style="margin-top:4px">"${esc(p.bio)}"</div>` : ''}
                </div>
                <div class="ff-nivel">
                    <div class="ff-nivel-num">${p.nivel || '—'}</div>
                    <div class="stat-lbl">Nivel</div>
                </div>
            </div>
            <div class="ff-datos">
                ${dato('Región', F.nombreRegion(p.region), 'bi-globe-americas')}
                ${dato('Likes', (p.likes || 0).toLocaleString('es-CO'), 'bi-hand-thumbs-up-fill')}
                ${dato('Rango BR', p.rangoBR, 'bi-award-fill')}
                ${dato('Rango CS', p.rangoCS, 'bi-crosshair')}
                ${dato('EXP', (p.exp || 0).toLocaleString('es-CO'), 'bi-lightning-charge-fill')}
                ${dato('Puntaje de crédito', p.credito || p.honor, 'bi-shield-fill-check')}
                ${dato('Gremio', p.gremio ? `${p.gremio.nombre}${p.gremio.nivel ? ' · Nv ' + p.gremio.nivel : ''}` : '', 'bi-people-fill')}
                ${dato('Cuenta creada', creada ? `${creada}${F.antiguedad(p.creada) ? ' (' + F.antiguedad(p.creada) + ')' : ''}` : '', 'bi-calendar-check')}
            </div>
            ${op.pie === false ? '' : `<div class="ff-fuente ${inventado ? 'aviso' : ''}">
                ${p.fuente === 'api'
                    ? `<i class="bi bi-broadcast"></i> Datos traídos del servidor de Free Fire${p.deCache ? ' (guardados hace un momento)' : ''}`
                    : p.fuente === 'manual'
                        ? `<i class="bi bi-pencil"></i> Datos escritos a mano`
                        : `<i class="bi bi-cone-striped"></i> Números inventados para mostrar el diseño. Falta conectar el servicio de perfiles.`}
            </div>`}
        </div>`;
    }

    function pintarPaso2() {
        const p = regPerfil;
        $('#s2').classList.add('on');
        const inventado = p.fuente === 'simulado';
        const aMano = p.fuente === 'manual' || inventado;
        $('#regCard').innerHTML = `
            ${inventado ? `<div class="msg msg-warn">
                <b>Todavía no está conectado el servicio que lee los datos de Free Fire</b>,
                así que no podemos traer tu perfil de verdad. El nick y los números de abajo
                están inventados: no son tu cuenta.<br><br>
                Escribe tu nick tal como aparece en el juego y sigue. El día que conectemos el
                servicio, tus datos se llenan solos con tu ID <b class="mono">${esc(p.uid)}</b>.
            </div>` : ''}
            ${tarjetaPerfilFF(p)}
            ${aMano ? `<div class="field">
                <label>Tu nick exacto en el juego</label>
                <input type="text" id="regNickManual" placeholder="Como aparece en Free Fire" autocomplete="off">
                <div class="hint">Tiene que ser idéntico al del juego: es con lo que te identificamos en la partida.</div>
            </div>
            <button class="btn btn-ghost btn-block btn-sm mb" id="btnOtroId">
                <i class="bi bi-arrow-left"></i> Cambiar de ID</button>`
            : `<button class="btn btn-ghost btn-block btn-sm mb" id="btnOtroId">
                <i class="bi bi-arrow-left"></i> Ese no soy yo, cambiar de ID</button>`}
            <div class="msg msg-info">
                <b>Falta un paso para verificarte:</b> pon el código <b class="mono">${esc(p.codigoVerificacion)}</b>
                en tu biografía dentro del juego y manda la captura por WhatsApp.
                Cualquiera puede ver el perfil de un ID, así que este código es el que demuestra que la cuenta es tuya.
            </div>
            <div id="regMsg2"></div>
            <div class="row-2">
                <div class="field">
                    <label>WhatsApp (con indicativo)</label>
                    <input type="tel" id="regWa" inputmode="numeric" placeholder="573001112233">
                </div>
                <div class="field">
                    <label>Correo (opcional)</label>
                    <input type="email" id="regEmail" placeholder="tucorreo@gmail.com">
                </div>
            </div>
            <div class="row-2">
                <div class="field">
                    <label>Contraseña</label>
                    <input type="password" id="regPass" placeholder="Mínimo 6 caracteres">
                </div>
                <div class="field">
                    <label>Repite la contraseña</label>
                    <input type="password" id="regPass2" placeholder="••••••">
                </div>
            </div>
            <button class="btn btn-fire btn-block" id="btnCrear">Crear mi cuenta</button>
            <div class="hint mt">Al crear la cuenta aceptas las <a href="#/reglas" style="color:var(--oro)">reglas de la plataforma</a>.</div>
        `;
        $('#btnCrear').onclick = async function () {
            const pass = $('#regPass').value, pass2 = $('#regPass2').value;
            const msgErr = (m) => {
                $('#regMsg2').innerHTML = `<div class="msg msg-err">${esc(m)}</div>`;
                this.disabled = false; this.textContent = 'Crear mi cuenta';
            };
            const msg = msgErr;
            if (pass !== pass2) return msg('Las contraseñas no coinciden.');
            this.disabled = true; this.textContent = 'Creando...';
            try {
                const nickManual = $('#regNickManual');
                const nickFinal = nickManual ? nickManual.value.trim() : p.nick;
                if (!nickFinal) return msgErr('Escribe tu nick exacto del juego.');
                const u = await S.registrar({
                    ffUid: p.uid || p.ffUid, nick: nickFinal,
                    nivel: p.fuente === 'api' ? p.nivel : 0,
                    region: p.region,
                    perfil: p.fuente === 'api' ? p : null,
                    email: $('#regEmail').value.trim(), whatsapp: $('#regWa').value.trim(), pass
                });
                toast('Cuenta creada. ¡Bienvenido, ' + u.nick + '!', 'ok');
                location.hash = '#/billetera';
                render();
            } catch (e) {
                msg(e.message);
            }
        };

        const bo = $('#btnOtroId');
        if (bo) bo.onclick = () => { regPerfil = null; render(); };
    }

    /* ---------- BILLETERA ---------- */
    V.billetera = async function () {
        const yo = S.yo();
        if (!yo) return vistaNecesitaSesion('tu billetera');
        const [movs, cfg] = [await S.movimientos(), S.config()];
        const icoTipo = {
            recarga: ['bi-arrow-down-circle-fill', 'var(--verde)', 'rgba(46,230,168,.14)'],
            premio: ['bi-trophy-fill', 'var(--fire-2)', 'rgba(255,209,102,.14)'],
            inscripcion: ['bi-controller', 'var(--oro)', 'rgba(255,168,60,.14)'],
            retiro: ['bi-arrow-up-circle-fill', 'var(--rojo)', 'rgba(255,77,94,.14)'],
            reembolso: ['bi-arrow-counterclockwise', 'var(--txt-2)', 'rgba(255,255,255,.08)']
        };
        return `
        <div class="wrap">
            <div class="titulo-seccion" style="margin-top:8px">
                <span class="eyebrow">Tu dinero</span>
                <h2>Billetera</h2>
            </div>
            <div class="split">
                <div>
                    <div class="wallet">
                        <div class="muted">Saldo disponible</div>
                        <div class="wallet-saldo">${money(yo.saldo)}</div>
                        <div class="flex mt">
                            <button class="btn btn-fire" id="btnRecargar"><i class="bi bi-plus-circle-fill"></i> Recargar</button>
                            <button class="btn btn-ghost" id="btnRetirar"><i class="bi bi-cash-stack"></i> Retirar</button>
                        </div>
                        <div class="muted mt">Retiro mínimo: ${money(cfg.minRetiro)} · Se paga por ${cfg.metodosPago.join(', ')}</div>
                    </div>

                    <div class="card mt">
                        <h3 class="mb">Movimientos</h3>
                        ${movs.length ? movs.map((m) => {
                            const [ico, color, bg] = icoTipo[m.tipo] || icoTipo.reembolso;
                            return `<div class="mov">
                                <div class="mov-ico" style="background:${bg};color:${color}"><i class="bi ${ico}"></i></div>
                                <div style="flex:1;min-width:0">
                                    <div style="font-weight:700;font-size:.88rem;text-transform:capitalize">${esc(m.tipo)}
                                        ${m.estado !== 'completada' ? `<span class="pill pill-${m.estado === 'pendiente' ? 'lleno' : 'en_curso'}" style="font-size:.6rem">${esc(m.estado)}</span>` : ''}
                                    </div>
                                    <div class="p-sub">${esc(m.nota || m.metodo)} · ${fechaCorta(m.creado)} · ref ${esc(m.ref)}</div>
                                </div>
                                <div class="mov-monto ${m.monto >= 0 ? 'pos' : 'neg'}">${m.monto >= 0 ? '+' : '−'}${money(Math.abs(m.monto))}</div>
                            </div>`;
                        }).join('') : `<div class="empty"><i class="bi bi-receipt"></i>Todavía no tienes movimientos.</div>`}
                    </div>
                </div>

                <div>
                    <div class="card">
                        <h3 class="mb">Cómo entra y sale la plata</h3>
                        <p class="muted" style="line-height:1.6">
                            1. Recargas por Nequi / Daviplata / Bancolombia.<br>
                            2. Con el saldo compras cupos de torneos.<br>
                            3. Los premios caen automáticamente a tu saldo cuando el admin publica los resultados.<br>
                            4. Pides el retiro y te lo pagamos al número o cuenta que registres.
                        </p>
                        <div class="divider"></div>
                        <div class="msg msg-warn" style="font-size:.78rem;margin:0">
                            En esta demo las recargas son <b>simuladas</b> (no se mueve dinero real).
                            Para cobros y pagos de verdad hay que conectar una pasarela — está explicado
                            en <span class="mono">ARQUITECTURA.md</span>.
                        </div>
                    </div>
                    <div class="card mt">
                        <h3 class="mb">¿Problemas con un pago?</h3>
                        <a class="btn btn-wa btn-block" target="_blank" rel="noopener"
                           href="${esc(waLink('Hola, tengo una duda con un pago en Torneos FF. Mi ID de Free Fire es ' + yo.ffUid, cfg.whatsappSoporte))}">
                           <i class="bi bi-whatsapp"></i> Escribir a soporte
                        </a>
                    </div>
                </div>
            </div>
        </div>`;
    };

    V.billetera.despues = function () {
        const cfg = S.config();

        $('#btnRecargar').onclick = () => {
            const m = modal('Recargar saldo', `
                <div id="recMsg"></div>
                <div class="field">
                    <label>¿Cuánto vas a recargar?</label>
                    <input type="number" id="recMonto" value="10000" min="1000" step="1000">
                </div>
                <div class="flex mb">
                    ${[5000, 10000, 20000, 50000].map((v) => `<button class="btn btn-ghost btn-sm" data-monto="${v}">${money(v)}</button>`).join('')}
                </div>
                <div class="field">
                    <label>Método</label>
                    <select id="recMetodo">${cfg.metodosPago.map((p) => `<option>${esc(p)}</option>`).join('')}</select>
                </div>
                <div class="field">
                    <label>Referencia del pago${S.modo === 'api' ? '' : ' (opcional)'}</label>
                    <input type="text" id="recRef" placeholder="Nº de comprobante de Nequi">
                    <div class="hint">${S.modo === 'api'
                        ? 'La recarga queda en revisión hasta que el organizador confirme que el pago llegó. Cuando haya pasarela conectada, eso lo confirmará el banco solo.'
                        : 'Cuando haya pasarela conectada, este paso lo confirma el banco automáticamente.'}</div>
                </div>
                <button class="btn btn-fire btn-block" id="recOk">Confirmar recarga</button>
            `);
            $$('[data-monto]', m).forEach((b) => {
                b.onclick = () => { $('#recMonto', m).value = b.dataset.monto; };
            });
            $('#recOk', m).onclick = async function () {
                this.disabled = true; this.textContent = 'Procesando pago...';
                try {
                    const r = await S.recargar($('#recMonto', m).value, $('#recMetodo', m).value, $('#recRef', m).value.trim());

                    // Con pasarela conectada, el jugador se va a pagar a Wompi y
                    // vuelve solo; el saldo lo acredita el aviso que Wompi manda
                    // al servidor, no este navegador.
                    if (r && r.checkout && r.checkout.url) {
                        toast('Te llevamos a la pasarela de pago...', 'ok');
                        window.location.href = r.checkout.url;
                        return;
                    }

                    cerrarModal();
                    toast(S.modo === 'api'
                        ? 'Recarga enviada. Queda en revisión hasta que el organizador confirme el pago.'
                        : 'Saldo recargado', 'ok');
                    render();
                } catch (e) {
                    $('#recMsg', m).innerHTML = `<div class="msg msg-err">${esc(e.message)}</div>`;
                    this.disabled = false; this.textContent = 'Confirmar recarga';
                }
            };
        };

        $('#btnRetirar').onclick = () => {
            const yo = S.yo();
            const m = modal('Retirar dinero', `
                <div class="msg msg-info">Disponible: <b>${money(yo.saldo)}</b> · Mínimo ${money(cfg.minRetiro)}</div>
                <div id="retMsg"></div>
                <div class="field">
                    <label>Monto a retirar</label>
                    <input type="number" id="retMonto" value="${Math.max(cfg.minRetiro, 0)}" min="${cfg.minRetiro}" step="1000">
                </div>
                <div class="field">
                    <label>¿A dónde te lo enviamos?</label>
                    <select id="retMetodo">${cfg.metodosPago.map((p) => `<option>${esc(p)}</option>`).join('')}</select>
                </div>
                <div class="field">
                    <label>Celular o número de cuenta</label>
                    <input type="text" id="retCuenta" placeholder="3001112233" value="${esc(yo.whatsapp || '')}">
                    <div class="hint">Debe estar a tu nombre. Los retiros se pagan en menos de 24 horas hábiles.</div>
                </div>
                <button class="btn btn-fire btn-block" id="retOk">Solicitar retiro</button>
            `);
            $('#retOk', m).onclick = async function () {
                this.disabled = true; this.textContent = 'Enviando...';
                try {
                    const t = await S.solicitarRetiro($('#retMonto', m).value, $('#retMetodo', m).value, $('#retCuenta', m).value.trim());
                    cerrarModal();
                    toast('Retiro solicitado. Queda en revisión.', 'ok');
                    const txt = `Hola, solicité un retiro en Torneos FF.\nID Free Fire: ${yo.ffUid}\nNick: ${yo.nick}\nMonto: ${money(Math.abs(t.monto))}\nMétodo: ${t.metodo}\nCuenta: ${t.ref}`;
                    window.open(waLink(txt, cfg.whatsappSoporte), '_blank', 'noopener');
                    render();
                } catch (e) {
                    $('#retMsg', m).innerHTML = `<div class="msg msg-err">${esc(e.message)}</div>`;
                    this.disabled = false; this.textContent = 'Solicitar retiro';
                }
            };
        };
    };

    /* ---------- PERFIL ---------- */
    V.perfil = async function () {
        const yo = S.yo();
        if (!yo) return vistaNecesitaSesion('tu perfil');
        const mis = await S.misTorneos();
        const ganado = mis.reduce((a, x) => a + (x.inscripcion.resultado ? x.inscripcion.resultado.premio : 0), 0);
        const kills = mis.reduce((a, x) => a + (x.inscripcion.resultado ? x.inscripcion.resultado.kills : 0), 0);
        const podios = mis.filter((x) => x.inscripcion.resultado && x.inscripcion.resultado.puesto <= 3).length;

        return `
        <div class="wrap">
            <div class="card" style="margin-top:8px">
                <div class="flex" style="gap:16px">
                    <div class="ff-ava" style="width:68px;height:68px;flex:0 0 68px;font-size:2rem">${esc(initials(yo.nick))}</div>
                    <div style="min-width:0;flex:1">
                        <h2 class="perfil-nick">${esc(yo.nick)}</h2>
                        <div class="muted">ID ${esc(yo.ffUid)}${yo.nivel ? ' · Nivel ' + yo.nivel : ''} · ${esc(window.PerfilFF.nombreRegion(yo.region))}</div>
                        <div class="flex mt" style="gap:6px">
                            ${yo.verificado ? `<span class="pill pill-abierto"><i class="bi bi-patch-check-fill"></i> Cuenta verificada</span>` : `<span class="pill pill-lleno">Sin verificar</span>`}
                            ${yo.rol === 'admin' ? `<span class="pill pill-escuadra">Admin</span>` : ''}
                        </div>
                    </div>
                    <button class="btn btn-ghost btn-sm" id="btnSalir"><i class="bi bi-box-arrow-right"></i> Salir</button>
                </div>
            </div>

            <div class="grid g4 mt">
                <div class="card stat"><div class="stat-num grad-fire">${mis.length}</div><div class="stat-lbl">Torneos</div></div>
                <div class="card stat"><div class="stat-num grad-oro">${kills}</div><div class="stat-lbl">Kills</div></div>
                <div class="card stat"><div class="stat-num" style="color:var(--amarillo)">${podios}</div><div class="stat-lbl">Podios</div></div>
                <div class="card stat"><div class="stat-num" style="color:var(--verde)">${money(ganado)}</div><div class="stat-lbl">Ganado</div></div>
            </div>

            <div class="card mt">
                <h3 class="mb">Mis torneos</h3>
                ${mis.length ? `<div class="p-list">${mis.map((x) => {
                    const r = x.inscripcion.resultado;
                    return `<a href="#/torneo/${x.torneo.id}" class="p-item">
                        <div class="p-num ${r && r.puesto <= 3 ? 'top' + r.puesto : ''}">${r ? '#' + r.puesto : '—'}</div>
                        <div class="p-info">
                            <div class="p-nick">${esc(x.torneo.nombre)}</div>
                            <div class="p-sub">${S.nombreModo[x.torneo.modo]} · ${fecha(x.torneo.fecha)} · ${esc(x.inscripcion.equipo.nombre)}</div>
                        </div>
                        <div class="p-right">
                            ${r ? (r.premio ? `<div class="mov-monto pos">+${money(r.premio)}</div>` : `<div class="muted">${r.kills} kills</div>`)
                                : `<span class="pill pill-${x.torneo.estado}">${etiquetaEstado(x.torneo.estado)}</span>`}
                        </div>
                    </a>`;
                }).join('')}</div>` : `<div class="empty"><i class="bi bi-trophy"></i>Aún no te has inscrito a ningún torneo.
                    <div class="mt"><a href="#/torneos" class="btn btn-fire btn-sm">Ver torneos</a></div></div>`}
            </div>

            <div class="card mt">
                <div class="section-head" style="margin-bottom:12px">
                    <h3>Datos de tu cuenta de Free Fire</h3>
                    <button class="btn btn-ghost btn-sm" id="btnRefrescarFF"><i class="bi bi-arrow-clockwise"></i> Actualizar</button>
                </div>
                <div id="ffPerfilBox">
                    ${yo.perfil
                        ? tarjetaPerfilFF(yo.perfil)
                        : `<div class="empty" style="padding:22px"><i class="bi bi-person-badge"></i>
                             Todavía no hemos traído los datos de tu cuenta.
                             <div class="mt"><span class="muted">Toca "Actualizar" para consultarlos por tu ID.</span></div></div>`}
                </div>
            </div>

            <div class="card mt">
                <h3 class="mb">Datos de contacto</h3>
                <div class="t-row" style="padding:8px 0;border-bottom:1px solid var(--line)"><span>WhatsApp</span><b>+${esc(yo.whatsapp)}</b></div>
                <div class="t-row" style="padding:8px 0"><span>Correo</span><b>${esc(yo.email || '—')}</b></div>
            </div>
        </div>`;
    };

    V.perfil.despues = function () {
        const br = $('#btnRefrescarFF');
        if (br) br.onclick = async function () {
            this.disabled = true; this.innerHTML = '<i class="bi bi-hourglass-split"></i> Consultando...';
            try {
                const u = await S.actualizarPerfilFF();
                if (u.perfil && u.perfil.fuente === 'api') {
                    toast('Datos actualizados desde el juego', 'ok');
                    render();   // el nick y el nivel de la cabecera también cambian
                    return;
                }
                $('#ffPerfilBox').innerHTML = tarjetaPerfilFF(u.perfil);
                toast('Falta conectar el servicio de perfiles: lo que ves es un ejemplo', 'err');
            } catch (e) {
                toast(e.message, 'err');
            }
            this.disabled = false; this.innerHTML = '<i class="bi bi-arrow-clockwise"></i> Actualizar';
        };

        const b = $('#btnSalir');
        if (b) b.onclick = async () => {
            await S.logout(); toast('Sesión cerrada', 'ok'); location.hash = '#/'; render();
        };
    };

    function vistaNecesitaSesion(qué) {
        return `<div class="wrap" style="max-width:480px">
            <div class="card center">
                <i class="bi bi-lock-fill" style="font-size:2.4rem;color:var(--fire)"></i>
                <h3 class="mt">Entra para ver ${esc(qué)}</h3>
                <p class="muted mb">Necesitas conectar tu cuenta de Free Fire.</p>
                <a href="#/entrar" class="btn btn-fire btn-block">Entrar</a>
                <a href="#/registro" class="btn btn-ghost btn-block mt">Crear cuenta</a>
            </div>
        </div>`;
    }

    /* ---------- REGLAS ---------- */
    V.reglas = async function () {
        const cfg = S.config();
        return `
        <div class="wrap" style="max-width:760px">
            <div class="titulo-seccion" style="margin-top:8px">
                <span class="eyebrow">Transparencia</span>
                <h2>Reglas y condiciones</h2>
                <p>Lo que aplica para todos los torneos. Si algo no está aquí, decide el organizador.</p>
            </div>
            ${[
                ['Cuentas y verificación', [
                    'Cada jugador usa una sola cuenta, con su ID de Free Fire real.',
                    'El nick registrado debe ser idéntico al del juego durante la partida.',
                    'Nunca pedimos tu contraseña de Free Fire, ni tu cuenta de Google o Facebook.',
                    'Cuentas prestadas, compartidas o de terceros quedan descalificadas.'
                ]],
                ['Inscripciones y pagos', [
                    'El cupo se paga con el saldo de la plataforma antes de que empiece el torneo.',
                    'Puedes cancelar y recuperar el valor mientras la sala no se haya publicado.',
                    'Si un torneo se cancela por parte nuestra, se devuelve el 100% del cupo.',
                    'No hay devolución por no presentarse, por mala conexión o por descalificación.'
                ]],
                ['Durante la partida', [
                    'Entrar a la sala 10 minutos antes de la hora fijada.',
                    'Prohibido: hacks, panel, emulador (salvo que el torneo lo diga), teaming y cuentas alternas.',
                    'Grabar la partida es obligatorio para poder reclamar un resultado.',
                    'La decisión del administrador sobre un caso dudoso es la que vale.'
                ]],
                ['Premios y retiros', [
                    `El premio cae al saldo del ganador cuando se publican los resultados.`,
                    `Retiro mínimo: ${money(cfg.minRetiro)}. Se paga por ${cfg.metodosPago.join(', ')}.`,
                    'Los retiros se pagan en menos de 24 horas hábiles a una cuenta a tu nombre.',
                    `La plataforma retiene el ${cfg.comision}% de lo recaudado para operación y premios de cortesía.`
                ]],
                ['Aviso importante', [
                    'Torneos FF no está afiliada, patrocinada ni avalada por Garena ni por Free Fire.',
                    'Free Fire es una marca de Garena; aquí solo se organizan torneos de aficionados.',
                    'Menores de edad requieren permiso de un acudiente para participar con dinero.'
                ]]
            ].map(([t, items]) => `
                <div class="card mb">
                    <h3 class="mb">${t}</h3>
                    <ul style="padding-left:18px;display:grid;gap:9px">
                        ${items.map((i) => `<li style="font-size:.88rem;color:var(--txt-2);line-height:1.6">${i}</li>`).join('')}
                    </ul>
                </div>`).join('')}
            <a class="btn btn-wa btn-block" target="_blank" rel="noopener"
               href="${esc(waLink('Hola, tengo una duda sobre las reglas de los torneos.', cfg.whatsappSoporte))}">
               <i class="bi bi-whatsapp"></i> Preguntar por WhatsApp
            </a>
        </div>`;
    };

    /* ---------- PANEL ADMIN ---------- */
    let adminTab = 'torneos';

    V.admin = async function () {
        if (!S.esAdmin()) {
            return `<div class="wrap" style="max-width:480px">
                <div class="card center">
                    <i class="bi bi-shield-lock-fill" style="font-size:2.4rem;color:var(--fire)"></i>
                    <h3 class="mt">Panel de administración</h3>
                    <p class="muted mb">Necesitas una cuenta de administrador.</p>
                    <a href="#/entrar" class="btn btn-fire btn-block">Entrar como admin</a>
                </div>
            </div>`;
        }
        const torneos = await S.torneos();
        const pendientes = S.pendientes ? await S.pendientes() : await S.retirosPendientes();
        const retiros = pendientes.filter((p) => p.tipo === 'retiro');
        const recargas = pendientes.filter((p) => p.tipo === 'recarga');

        const tabs = [['torneos', 'Torneos'], ['crear', 'Crear torneo'],
            ['retiros', `Pagos${pendientes.length ? ' (' + pendientes.length + ')' : ''}`], ['whatsapp', 'WhatsApp']];

        let cuerpo = '';
        if (adminTab === 'torneos') cuerpo = adminTorneos(torneos);
        if (adminTab === 'crear') cuerpo = adminCrear();
        if (adminTab === 'retiros') cuerpo = adminRecargas(recargas) + adminRetiros(retiros);
        if (adminTab === 'whatsapp') cuerpo = adminWhatsapp(torneos);

        return `
        <div class="wrap">
            <div class="section-head" style="margin-top:8px">
                <div><div class="eyebrow">Organizador</div><h2>Panel</h2></div>
                ${S.modo === 'api' ? '' : `<button class="btn btn-ghost btn-sm" id="btnReset"><i class="bi bi-arrow-repeat"></i> Reiniciar datos demo</button>`}
            </div>
            <div class="tabs" id="adminTabs">
                ${tabs.map(([k, t]) => `<button class="tab ${adminTab === k ? 'on' : ''}" data-t="${k}">${t}</button>`).join('')}
            </div>
            ${cuerpo}
        </div>`;
    };

    function adminTorneos(torneos) {
        if (!torneos.length) return `<div class="empty"><i class="bi bi-trophy"></i>No hay torneos creados.</div>`;
        return `<div class="grid g-cards">${torneos.map((t) => `
            <div class="card">
                <div class="t-meta">
                    <span class="pill pill-${t.modo}">${S.nombreModo[t.modo]}</span>
                    <span class="pill pill-${t.estado}">${etiquetaEstado(t.estado)}</span>
                </div>
                <h3 style="margin:4px 0">${esc(t.nombre)}</h3>
                <div class="muted mb">${fecha(t.fecha)} · ${t.inscritos}/${t.cupoMax} · Premio ${money(t.premioTotal)}</div>
                <div class="muted mb">Recaudado hasta ahora: <b style="color:var(--verde)">${money(t.jugadores * t.costo)}</b>
                    · Premios: ${esc(textoPremio(t))}<br>
                    ${t.minimo ? (t.inscritos >= t.minimo
                        ? `<b style="color:var(--verde)">Ya se juega</b> (mínimo ${t.minimo})`
                        : `<b style="color:var(--amarillo)">Faltan ${t.minimo - t.inscritos} ${unidadDe(t.modo)}</b> para el mínimo de ${t.minimo}`) : ''}</div>
                <div class="flex">
                    <a href="#/torneo/${t.id}" class="btn btn-ghost btn-sm"><i class="bi bi-eye"></i> Ver</a>
                    <button class="btn btn-ghost btn-sm" data-editar="${t.id}"><i class="bi bi-pencil"></i> Editar</button>
                    <button class="btn btn-oro btn-sm" data-sala="${t.id}"><i class="bi bi-door-open-fill"></i> ${t.sala.publicada ? 'Editar sala' : 'Publicar sala'}</button>
                    <button class="btn btn-fire btn-sm" data-result="${t.id}"><i class="bi bi-list-ol"></i> Resultados</button>
                    ${t.estado !== 'finalizado' ? `<button class="btn btn-ghost btn-sm" data-cerrar-insc="${t.id}">${t.estado === 'abierto' ? 'Cerrar inscripciones' : 'Reabrir'}</button>` : ''}
                    ${t.estado !== 'cancelado' && t.estado !== 'finalizado' ? `<button class="btn btn-danger btn-sm" data-cancelar="${t.id}">Cancelar y devolver</button>` : ''}
                </div>
            </div>`).join('')}</div>`;
    }

    /* Un solo formulario para crear y para editar. Si se le pasa un torneo,
       viene relleno con sus datos; si no, con lo que se propone para el modo. */
    function camposTorneo(t) {
        const v = t || {};
        const base = REGLAS_MODO[v.modo || 'solo'];
        const fechaLocal = v.fecha ? new Date(new Date(v.fecha) - new Date(v.fecha).getTimezoneOffset() * 60000)
            .toISOString().slice(0, 16) : '';
        return `
            <div class="field">
                <label>Nombre</label>
                <input type="text" id="cNombre" value="${esc(v.nombre || '')}" placeholder="Copa Barranquilla — Escuadra">
            </div>
            <div class="row-2">
                <div class="field">
                    <label>Modo</label>
                    <select id="cModo">
                        <option value="solo" ${v.modo === 'solo' ? 'selected' : ''}>Solo</option>
                        <option value="duo" ${v.modo === 'duo' ? 'selected' : ''}>Dúo</option>
                        <option value="escuadra" ${v.modo === 'escuadra' ? 'selected' : ''}>Escuadra</option>
                    </select>
                </div>
                <div class="field">
                    <label>Fecha y hora</label>
                    <input type="datetime-local" id="cFecha" value="${fechaLocal}">
                </div>
            </div>
            <div class="row-2">
                <div class="field">
                    <label>Inscripción por jugador</label>
                    <input type="number" id="cCosto" value="${v.costo !== undefined ? v.costo : base.costo}" min="0" step="500">
                </div>
                <div class="field">
                    <label>Cupo máximo</label>
                    <input type="number" id="cCupo" value="${v.cupoMax || 48}" min="1">
                    <div class="hint" id="cUnidad"></div>
                </div>
            </div>
            <div class="row-2">
                <div class="field">
                    <label>Premio por kill</label>
                    <input type="number" id="cKill" value="${v.precioKill !== undefined ? v.precioKill : base.precioKill}" min="0" step="500">
                </div>
                <div class="field">
                    <label>Premio al ganador</label>
                    <input type="number" id="cGanador" value="${v.premioGanador !== undefined ? v.premioGanador : base.premioGanador}" min="0" step="1000">
                    <div class="hint">0 = sin bono por ganar</div>
                </div>
            </div>
            <div class="row-2">
                <div class="field">
                    <label>Mínimo para que se juegue</label>
                    <input type="number" id="cMinimo" value="${v.minimo !== undefined ? v.minimo : base.minimo}" min="0">
                    <div class="hint" id="cMinimoNota"></div>
                </div>
                <div class="field">
                    <label>Mapa</label>
                    <select id="cMapa">${['Bermuda', 'Purgatorio', 'Kalahari', 'Alpes', 'NexTerra']
                        .map((mp) => `<option ${v.mapa === mp ? 'selected' : ''}>${mp}</option>`).join('')}</select>
                </div>
            </div>
            <div class="field">
                <label>Color de la tarjeta</label>
                <select id="cTema">
                    <option value="fuego" ${v.tema === 'fuego' ? 'selected' : ''}>Naranja</option>
                    <option value="neon" ${v.tema === 'neon' ? 'selected' : ''}>Brasa (rojo)</option>
                    <option value="hielo" ${v.tema === 'hielo' ? 'selected' : ''}>Oro</option>
                </select>
            </div>
            <div class="field">
                <label>Reglas (una por línea)</label>
                <textarea id="cReglas" placeholder="Prohibido emuladores&#10;Entrar 10 minutos antes">${esc((v.reglas || []).join('\n'))}</textarea>
            </div>
            <div class="msg msg-info" id="cResumen" style="font-size:.82rem"></div>`;
    }

    /* Recalcula el resumen mientras se escribe: cuánto se recauda, cuánto
       se puede llegar a pagar y si el torneo queda en pérdida. */
    function conectarCalculadora(raiz) {
        const $$$ = (s) => $(s, raiz || document);
        const modo = $$$('#cModo'), cupo = $$$('#cCupo'), costo = $$$('#cCosto'),
              kill = $$$('#cKill'), ganador = $$$('#cGanador'), minimo = $$$('#cMinimo');
        if (!modo) return;

        const recalcular = (cambioDeModo) => {
            const base = REGLAS_MODO[modo.value];
            if (cambioDeModo) {
                costo.value = base.costo; kill.value = base.precioKill;
                ganador.value = base.premioGanador; minimo.value = base.minimo;
            }
            const jugadoresPorEquipo = S.cupoPorModo[modo.value];
            const equipos = Number(cupo.value) || 0;
            const jugadores = equipos * jugadoresPorEquipo;
            const recauda = jugadores * (Number(costo.value) || 0);
            // En una partida hay tantas kills como jugadores menos el ganador
            const killsPosibles = Math.max(0, jugadores - 1);
            const pagoMax = killsPosibles * (Number(kill.value) || 0) + (Number(ganador.value) || 0);

            $$$('#cUnidad').textContent = modo.value === 'solo'
                ? 'jugadores' : `${base.unidad} (${jugadoresPorEquipo} jugadores cada uno)`;
            $$$('#cMinimoNota').textContent = `${base.unidad} para que la sala se juegue`;
            $$$('#cResumen').innerHTML =
                `Si se llena: <b>${jugadores} jugadores</b> y recaudas <b>${money(recauda)}</b>.<br>` +
                `Pago máximo posible (todas las kills + el bono): <b>${money(pagoMax)}</b>.<br>` +
                `Te quedarían <b style="color:${recauda - pagoMax >= 0 ? 'var(--verde)' : 'var(--rojo)'}">${money(recauda - pagoMax)}</b>` +
                (recauda - pagoMax < 0 ? ' — ojo, así el torneo te cuesta plata.' : '.');
        };

        modo.onchange = () => recalcular(true);
        [cupo, costo, kill, ganador, minimo].forEach((c) => { c.oninput = () => recalcular(false); });
        recalcular(false);
    }

    function leerFormularioTorneo(raiz) {
        const $$$ = (s) => $(s, raiz || document);
        return {
            nombre: $$$('#cNombre').value.trim(),
            modo: $$$('#cModo').value,
            fecha: $$$('#cFecha').value ? new Date($$$('#cFecha').value).toISOString() : '',
            cupoMax: $$$('#cCupo').value,
            costo: $$$('#cCosto').value,
            precioKill: $$$('#cKill').value,
            premioGanador: $$$('#cGanador').value,
            minimo: $$$('#cMinimo').value,
            mapa: $$$('#cMapa').value,
            tema: $$$('#cTema').value,
            reglas: $$$('#cReglas').value.split('\n').map((s) => s.trim()).filter(Boolean)
        };
    }

    function adminCrear() {
        return `<div class="card" style="max-width:620px;margin:0 auto">
            <h3 class="mb">Nuevo torneo</h3>
            <div id="crearMsg"></div>
            ${camposTorneo(null)}
            <button class="btn btn-fire btn-block" id="btnCrearTorneo">Crear torneo</button>
        </div>`;
    }

    function adminRecargas(recargas) {
        if (!recargas.length) return '';
        return `<div class="card mb">
            <h3 class="mb">Recargas por confirmar</h3>
            <p class="muted mb" style="font-size:.82rem">
                El jugador dice que pagó. Revisa que la plata haya llegado de verdad antes de
                confirmar: al confirmar, el saldo queda disponible para inscribirse.
            </p>
            <div class="tabla-wrap"><table>
                <thead><tr><th>Jugador</th><th>Monto</th><th>Método</th><th>Referencia</th><th>Fecha</th><th>Acción</th></tr></thead>
                <tbody>${recargas.map((r) => `<tr>
                    <td><b>${esc(r.nick)}</b><div class="muted">ID ${esc(r.ffUid)}</div></td>
                    <td class="mov-monto pos nowrap">${money(Math.abs(r.monto))}</td>
                    <td>${esc(r.metodo)}</td>
                    <td class="mono">${esc(r.ref || '—')}</td>
                    <td class="nowrap">${fechaCorta(r.creado)}</td>
                    <td><div class="flex" style="gap:6px">
                        <button class="btn btn-ok btn-sm" data-aprobar="${r.id}">Confirmar</button>
                        <button class="btn btn-danger btn-sm" data-rechazar="${r.id}">Rechazar</button>
                    </div></td>
                </tr>`).join('')}</tbody>
            </table></div>
        </div>`;
    }

    function adminRetiros(retiros) {
        if (!retiros.length) return `<div class="empty"><i class="bi bi-check2-circle"></i>No hay retiros pendientes.</div>`;
        return `<div class="card">
            <h3 class="mb">Retiros por pagar</h3>
            <div class="tabla-wrap"><table>
                <thead><tr><th>Jugador</th><th>Monto</th><th>Método</th><th>Cuenta</th><th>Fecha</th><th>Acción</th></tr></thead>
                <tbody>${retiros.map((r) => `<tr>
                    <td><b>${esc(r.nick)}</b><div class="muted">ID ${esc(r.ffUid)}</div></td>
                    <td class="mov-monto neg nowrap">${money(Math.abs(r.monto))}</td>
                    <td>${esc(r.metodo)}</td>
                    <td class="mono">${esc(r.ref)}</td>
                    <td class="nowrap">${fechaCorta(r.creado)}</td>
                    <td><div class="flex" style="gap:6px">
                        <button class="btn btn-ok btn-sm" data-pagar="${r.id}">Pagado</button>
                        <button class="btn btn-danger btn-sm" data-rechazar="${r.id}">Rechazar</button>
                        <a class="btn btn-wa btn-sm" target="_blank" rel="noopener"
                           href="${esc(waLink(`Hola ${r.nick}, te acabo de enviar ${money(Math.abs(r.monto))} por ${r.metodo} a ${r.ref}. ¡Gracias por jugar en Torneos FF!`, r.whatsapp))}"><i class="bi bi-whatsapp"></i></a>
                    </div></td>
                </tr>`).join('')}</tbody>
            </table></div>
        </div>`;
    }

    function adminWhatsapp(torneos) {
        const abiertos = torneos.filter((t) => t.estado !== 'finalizado');
        return `<div class="split">
            <div class="card">
                <h3 class="mb">Aviso para el grupo</h3>
                <div class="field">
                    <label>Torneo</label>
                    <select id="waTorneo">${abiertos.map((t) => `<option value="${t.id}">${esc(t.nombre)}</option>`).join('')}</select>
                </div>
                <div class="field">
                    <label>Mensaje generado</label>
                    <textarea id="waTexto" style="min-height:220px"></textarea>
                </div>
                <div class="flex">
                    <button class="btn btn-wa" id="waEnviar"><i class="bi bi-whatsapp"></i> Abrir WhatsApp</button>
                    <button class="btn btn-ghost" id="waCopiar"><i class="bi bi-clipboard"></i> Copiar</button>
                </div>
            </div>
            <div>
                <div class="card">
                    <h3 class="mb">Encuesta del modo</h3>
                    <p class="muted mb" style="font-size:.82rem">
                        WhatsApp no permite crear encuestas desde una API: la encuesta se crea a mano en el grupo
                        y aquí guardas el resultado para que quede publicado en el torneo.
                    </p>
                    <div class="field">
                        <label>Pregunta</label>
                        <input type="text" id="encPregunta" value="¿Modo para el próximo torneo?">
                    </div>
                    <div class="row-2">
                        <div class="field"><label>Votos Solo</label><input type="number" id="encSolo" value="0" min="0"></div>
                        <div class="field"><label>Votos Dúo</label><input type="number" id="encDuo" value="0" min="0"></div>
                    </div>
                    <div class="row-2">
                        <div class="field"><label>Votos Escuadra</label><input type="number" id="encEsc" value="0" min="0"></div>
                        <div class="field"><label>Estado</label>
                            <select id="encEstado"><option value="abierta">Abierta</option><option value="cerrada">Cerrada</option></select></div>
                    </div>
                    <button class="btn btn-fire btn-block" id="encGuardar">Guardar en el torneo seleccionado</button>
                </div>
                <div class="card mt">
                    <h3 class="mb">Texto de la encuesta</h3>
                    <p class="muted" style="font-size:.82rem;line-height:1.6">Copia esto y créalo como encuesta en el grupo:</p>
                    <div class="mono" style="background:rgba(5,7,15,.6);padding:12px;border-radius:12px;font-size:.78rem;line-height:1.7">
                        ¿Cómo jugamos el torneo del fin de semana?<br>
                        1️⃣ Solo<br>2️⃣ Dúo<br>3️⃣ Escuadra
                    </div>
                </div>
            </div>
        </div>`;
    }

    V.admin.despues = async function () {
        if (S.pendientes) {
            vigilar(() => S.pendientes(), (p) => p.map((x) => x.id + x.estado).join('|'), 20000);
        }
        $$('#adminTabs .tab').forEach((b) => {
            b.onclick = () => { adminTab = b.dataset.t; render(); };
        });

        const br = $('#btnReset');
        if (br) br.onclick = async () => {
            if (!confirm('Esto borra todos los datos locales de la demo y vuelve a los de ejemplo. ¿Seguir?')) return;
            await S.reiniciarDemo();
            toast('Datos de demo reiniciados', 'ok');
            location.hash = '#/'; render();
        };

        /* --- Crear torneo --- */
        if ($('#btnCrearTorneo')) {
            conectarCalculadora(document);
            $('#btnCrearTorneo').onclick = async function () {
                this.disabled = true;
                try {
                    const t = await S.crearTorneo(leerFormularioTorneo(document));
                    toast('Torneo creado', 'ok');
                    adminTab = 'torneos';
                    location.hash = '#/torneo/' + t.id;
                    render();
                } catch (e) {
                    $('#crearMsg').innerHTML = `<div class="msg msg-err">${esc(e.message)}</div>`;
                    this.disabled = false;
                }
            };
        }

        /* --- Editar un torneo que ya existe --- */
        $$('[data-editar]').forEach((b) => {
            b.onclick = async () => {
                const t = await S.torneo(b.dataset.editar);
                const m = modal('Editar — ' + t.nombre, `
                    ${t.inscritos > 0 ? `<div class="msg msg-warn">
                        Este torneo ya tiene <b>${t.inscritos} inscrito(s)</b>. Puedes corregir lo que
                        necesites, pero si cambias la inscripción, a los que ya pagaron no se les
                        cobra ni se les devuelve la diferencia: eso hay que arreglarlo aparte.
                    </div>` : ''}
                    <div id="editarMsg"></div>
                    ${camposTorneo(t)}
                    <button class="btn btn-fire btn-block" id="btnGuardarTorneo">Guardar cambios</button>
                `);
                conectarCalculadora(m);
                $('#btnGuardarTorneo', m).onclick = async function () {
                    this.disabled = true; this.textContent = 'Guardando...';
                    try {
                        await S.actualizarTorneo(t.id, leerFormularioTorneo(m));
                        cerrarModal(); toast('Torneo actualizado', 'ok'); render();
                    } catch (e) {
                        $('#editarMsg', m).innerHTML = `<div class="msg msg-err">${esc(e.message)}</div>`;
                        this.disabled = false; this.textContent = 'Guardar cambios';
                    }
                };
            };
        });

        /* --- Cancelar el torneo y devolver el dinero --- */
        $$('[data-cancelar]').forEach((b) => {
            b.onclick = async () => {
                const t = await S.torneo(b.dataset.cancelar);
                const m = modal('Cancelar — ' + t.nombre, `
                    <div class="msg msg-warn">
                        Se cancela el torneo y se le devuelve el cupo completo a los
                        <b>${t.inscritos} inscrito(s)</b>. El dinero vuelve al saldo de cada uno
                        al instante. Esto no se puede deshacer.
                    </div>
                    <div id="cancelarMsg"></div>
                    <button class="btn btn-danger btn-block" id="btnConfirmarCancelar">
                        Sí, cancelar y devolver ${money(t.jugadores * t.costo)}
                    </button>
                    <button class="btn btn-ghost btn-block mt" data-cerrar>Mejor no</button>
                `);
                $('#btnConfirmarCancelar', m).onclick = async function () {
                    this.disabled = true; this.textContent = 'Devolviendo...';
                    try {
                        const r = await S.cancelarTorneo(t.id);
                        cerrarModal();
                        toast(`Torneo cancelado, se devolvió el cupo a ${r.devueltos} inscrito(s)`, 'ok');
                        render();
                    } catch (e) {
                        $('#cancelarMsg', m).innerHTML = `<div class="msg msg-err">${esc(e.message)}</div>`;
                        this.disabled = false;
                    }
                };
            };
        });

        /* --- Publicar sala --- */
        $$('[data-sala]').forEach((b) => {
            b.onclick = async () => {
                const t = await S.torneo(b.dataset.sala);
                const m = modal('Publicar sala — ' + t.nombre, `
                    <div class="msg msg-info">Al publicar, los inscritos ven el ID y la contraseña, y el torneo pasa a "En curso".</div>
                    <div id="salaMsg"></div>
                    <div class="row-2">
                        <div class="field"><label>ID de la sala</label><input type="text" id="sId" value="${esc(t.sala.id)}" inputmode="numeric"></div>
                        <div class="field"><label>Contraseña</label><input type="text" id="sPass" value="${esc(t.sala.pass)}"></div>
                    </div>
                    <button class="btn btn-fire btn-block" id="sOk">Publicar</button>
                `);
                $('#sOk', m).onclick = async function () {
                    this.disabled = true;
                    try {
                        await S.publicarSala(t.id, $('#sId', m).value.trim(), $('#sPass', m).value.trim());
                        cerrarModal(); toast('Sala publicada', 'ok'); render();
                    } catch (e) {
                        $('#salaMsg', m).innerHTML = `<div class="msg msg-err">${esc(e.message)}</div>`;
                        this.disabled = false;
                    }
                };
            };
        });

        /* --- Cerrar / reabrir inscripciones --- */
        $$('[data-cerrar-insc]').forEach((b) => {
            b.onclick = async () => {
                const t = await S.torneo(b.dataset.cerrarInsc);
                await S.actualizarTorneo(t.id, { estado: t.estado === 'abierto' ? 'lleno' : 'abierto' });
                toast('Estado actualizado', 'ok'); render();
            };
        });

        /* --- Registrar resultados --- */
        $$('[data-result]').forEach((b) => {
            b.onclick = async () => {
                const t = await S.torneo(b.dataset.result);
                if (!t.participantes.length) return toast('Ese torneo no tiene inscritos', 'err');
                const m = modal('Resultados — ' + t.nombre, `
                    <div class="msg msg-info" style="font-size:.84rem">
                        El premio se calcula solo: <b>${money(t.precioKill || 0)} por kill</b>${t.premioGanador
                            ? ` más <b>${money(t.premioGanador)}</b> para el puesto 1` : ''}.
                    </div>
                    <div class="msg msg-warn">Al guardar, los premios se abonan al saldo de cada ganador y el torneo queda finalizado.</div>
                    <div id="resMsg"></div>
                    <div class="tabla-wrap"><table>
                        <thead><tr><th>Equipo</th><th>Puesto</th><th>Kills</th><th>Puntos</th><th>Premio</th></tr></thead>
                        <tbody>${t.participantes.map((p) => `<tr>
                            <td><b>${esc(p.equipo.nombre)}</b></td>
                            <td><input type="number" data-r-puesto="${p.id}" value="${p.resultado ? p.resultado.puesto : ''}" min="1" style="width:74px;padding:8px"></td>
                            <td><input type="number" data-r-kills="${p.id}" value="${p.resultado ? p.resultado.kills : ''}" min="0" style="width:74px;padding:8px"></td>
                            <td><input type="number" data-r-puntos="${p.id}" value="${p.resultado ? p.resultado.puntos : ''}" min="0" style="width:74px;padding:8px"></td>
                            <td class="nowrap"><b data-r-premio="${p.id}" style="color:var(--verde)">${money(p.resultado ? p.resultado.premio : 0)}</b></td>
                        </tr>`).join('')}</tbody>
                    </table></div>
                    <button class="btn btn-fire btn-block mt" id="resOk">Guardar y pagar premios</button>
                `);
                // El premio se muestra mientras el organizador escribe, para que
                // vea lo que va a pagar antes de guardar.
                const recalcularPremios = () => {
                    t.participantes.forEach((p) => {
                        const kills = Number($(`[data-r-kills="${p.id}"]`, m).value) || 0;
                        const puesto = Number($(`[data-r-puesto="${p.id}"]`, m).value) || 0;
                        const premio = kills * (t.precioKill || 0) + (puesto === 1 ? (t.premioGanador || 0) : 0);
                        $(`[data-r-premio="${p.id}"]`, m).textContent = money(premio);
                    });
                };
                $$('[data-r-kills], [data-r-puesto]', m).forEach((c) => { c.oninput = recalcularPremios; });
                recalcularPremios();

                $('#resOk', m).onclick = async function () {
                    this.disabled = true; this.textContent = 'Guardando...';
                    const filas = t.participantes.map((p) => ({
                        inscripcionId: p.id,
                        puesto: $(`[data-r-puesto="${p.id}"]`, m).value,
                        kills: $(`[data-r-kills="${p.id}"]`, m).value,
                        puntos: $(`[data-r-puntos="${p.id}"]`, m).value
                    }));
                    try {
                        await S.registrarResultados(t.id, filas);
                        cerrarModal(); toast('Resultados publicados y premios pagados', 'ok'); render();
                    } catch (e) {
                        $('#resMsg', m).innerHTML = `<div class="msg msg-err">${esc(e.message)}</div>`;
                        this.disabled = false; this.textContent = 'Guardar y pagar premios';
                    }
                };
            };
        });

        /* --- Retiros --- */
        $$('[data-aprobar]').forEach((b) => {
            b.onclick = async () => {
                try {
                    await (S.resolverPendiente || S.resolverRetiro)(b.dataset.aprobar, true, 'Pago confirmado');
                    toast('Recarga confirmada, el saldo ya está disponible', 'ok'); render();
                } catch (e) { toast(e.message, 'err'); }
            };
        });
        $$('[data-pagar]').forEach((b) => {
            b.onclick = async () => {
                try { await (S.resolverPendiente || S.resolverRetiro)(b.dataset.pagar, true, 'Pago enviado'); toast('Retiro marcado como pagado', 'ok'); render(); }
                catch (e) { toast(e.message, 'err'); }
            };
        });
        $$('[data-rechazar]').forEach((b) => {
            b.onclick = async () => {
                const nota = prompt('¿Por qué se rechaza? (el saldo se devuelve al jugador)');
                if (nota === null) return;
                try {
                    await (S.resolverPendiente || S.resolverRetiro)(b.dataset.rechazar, false, nota);
                    toast('Rechazado', 'ok'); render();
                }
                catch (e) { toast(e.message, 'err'); }
            };
        });

        /* --- WhatsApp --- */
        const sel = $('#waTorneo');
        if (sel) {
            const cfg = S.config();
            const pintar = async () => {
                const t = await S.torneo(sel.value);
                const req = S.cupoPorModo[t.modo];
                $('#waTexto').value =
                    `🔥 *${t.nombre}* 🔥\n\n` +
                    `🎮 Modo: ${S.nombreModo[t.modo]}\n` +
                    `🗺️ Mapa: ${t.mapa}\n` +
                    `🗓️ ${fecha(t.fecha)}\n` +
                    `💵 Cupo: ${money(t.costo)} por jugador${req > 1 ? ` (${money(t.costo * req)} el equipo)` : ''}\n` +
                    `🏆 Premio total: ${money(t.premioTotal)}\n` +
                    t.distribucion.map((d) => `   ${d.pos}° lugar: ${money(Math.round(t.premioTotal * d.pct / 100))}`).join('\n') + '\n' +
                    `👥 Cupos: ${t.inscritos}/${t.cupoMax}\n\n` +
                    `✅ Inscríbete y paga tu cupo en la plataforma:\n${location.origin + location.pathname}#/torneo/${t.id}\n\n` +
                    `La lista de participantes, el ID de la sala y los resultados salen ahí mismo.\n` +
                    `Dudas: wa.me/${cfg.whatsappSoporte}`;
            };
            sel.onchange = pintar;
            await pintar();
            $('#waEnviar').onclick = () => window.open(waLink($('#waTexto').value), '_blank', 'noopener');
            $('#waCopiar').onclick = () => copiar($('#waTexto').value, 'Mensaje copiado');
            $('#encGuardar').onclick = async () => {
                try {
                    await S.guardarEncuesta(sel.value, {
                        pregunta: $('#encPregunta').value.trim(),
                        opciones: [
                            { texto: 'Solo', votos: +$('#encSolo').value || 0 },
                            { texto: 'Dúo', votos: +$('#encDuo').value || 0 },
                            { texto: 'Escuadra', votos: +$('#encEsc').value || 0 }
                        ],
                        cerrada: $('#encEstado').value === 'cerrada'
                    });
                    toast('Encuesta publicada en el torneo', 'ok');
                } catch (e) { toast(e.message, 'err'); }
            };
        }
    };

    /* ============================================================
       ROUTER
       ============================================================ */
    const RUTAS = [
        [/^#?\/?$/, () => V.inicio()],
        [/^#\/torneos$/, () => V.torneos()],
        [/^#\/torneo\/(.+)$/, (m) => V.torneo(m[1])],
        [/^#\/entrar$/, () => V.entrar()],
        [/^#\/registro$/, () => V.registro()],
        [/^#\/billetera$/, () => V.billetera()],
        [/^#\/perfil$/, () => V.perfil()],
        [/^#\/reglas$/, () => V.reglas()],
        [/^#\/admin$/, () => V.admin()]
    ];

    const DESPUES = {
        '#/torneos': V.torneos.despues,
        '#/entrar': V.entrar.despues,
        '#/registro': V.registro.despues,
        '#/billetera': V.billetera.despues,
        '#/perfil': V.perfil.despues,
        '#/admin': V.admin.despues
    };

    let renderizando = false;

    async function render() {
        if (renderizando) return;
        renderizando = true;
        pararTimerVista();
        contadorPalabra = 0;
        cerrarModal();

        /* En modo servidor los datos del usuario pueden haber cambiado desde
           OTRO dispositivo: el organizador confirmó una recarga, entró un
           premio. Se refrescan en cada pantalla para no mostrar un saldo
           viejo. */
        if (S.modo === 'api' && S.sesionLista) {
            try { await S.sesionLista(); } catch (e) { /* si falla, se pinta con lo que hay */ }
        }
        const ruta = location.hash || '#/';
        app.innerHTML = `<div class="wrap" style="padding-top:20px"><div class="grid g3">
            <div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div></div>`;

        try {
            let html = null, match = null, fn = null;
            for (const [re, handler] of RUTAS) {
                match = ruta.match(re);
                if (match) { fn = handler; break; }
            }
            html = fn
                ? await fn(match)
                : `<div class="wrap"><div class="empty"><i class="bi bi-compass"></i>
                     Esta página no existe.<div class="mt"><a href="#/" class="btn btn-fire btn-sm">Ir al inicio</a></div></div></div>`;

            const pintar = () => {
                app.innerHTML = html;
                // Respaldo para navegadores sin View Transitions
                app.classList.remove('entrando');
                void app.offsetWidth;
                app.classList.add('entrando');
            };

            const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (document.startViewTransition && !quieto) {
                const vt = document.startViewTransition(pintar);
                await vt.updateCallbackDone;   // el DOM ya está cambiado
            } else {
                pintar();
            }
            window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });

            if (ruta.startsWith('#/torneo/')) {
                V.torneo.despues(ruta.replace('#/torneo/', ''));
            } else if (DESPUES[ruta]) {
                await DESPUES[ruta]();
            } else {
                iniciarCountdowns();
            }
            pintarNav();
            if (window.Efectos) {
                window.Efectos.activarContadores(app);
                window.Efectos.aplicarLogo();
            }
        } catch (e) {
            if (e && e.silencioso) return;      // petición cancelada al cambiar de pantalla
            console.error(e);
            app.innerHTML = `<div class="wrap"><div class="msg msg-err">Ocurrió un error: ${esc(e.message)}</div>
                <a href="#/" class="btn btn-ghost">Volver al inicio</a></div>`;
        } finally {
            renderizando = false;
        }
    }

    window.addEventListener('hashchange', render);

    /* En modo servidor la sesión vive en un token: hay que preguntarle al
       servidor quién es antes de pintar, o el primer render saldría como
       si nadie hubiera iniciado sesión. */
    if (S.sesionLista) {
        S.sesionLista().then(render, render);
    } else {
        render();
    }
})();
