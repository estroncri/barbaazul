/* ============================================================
   TORNEOS FF — Los mensajes para el grupo (mensajes.js)
   ------------------------------------------------------------
   El organizador crea el torneo en el panel y de ahí sale, ya
   escrito, lo que hay que pegar en el grupo de avisos.

   Existe por una razón concreta: copiar la hora, el cupo y el
   premio a mano de una pantalla a un chat es donde se cuela el
   error. Un aviso que dice 8:00 cuando el torneo es a las 9:00
   son cuarenta personas en la sala equivocada y cuarenta
   reclamos.

   Todo aquí es función pura: entra el torneo, sale texto. Sin
   DOM, sin red. Así se puede probar en Node (probar.mjs) sin
   abrir un navegador.
   ============================================================ */

(function (raiz) {
    'use strict';

    /* La hora se fija a Bogotá y no a la del computador. El organizador
       puede estar de viaje, con el portátil en otro huso; el torneo sigue
       siendo a las 8 de la noche en Colombia. */
    const ZONA = 'America/Bogota';

    const UNIDAD = { solo: 'jugadores', duo: 'dúos', escuadra: 'escuadras' };
    const NOMBRE_MODO = { solo: 'SOLO', duo: 'DÚO', escuadra: 'ESCUADRA' };
    /* En Dúo y Escuadra el ganador es una pareja o un equipo, no una
       persona. Decir "al ganador" de una escuadra invita al reclamo de
       "¿a cuál de los cuatro?". */
    const QUIEN_GANA = { solo: 'al ganador', duo: 'a la pareja ganadora', escuadra: 'al equipo ganador' };

    const unidadDe = (modo) => UNIDAD[modo] || UNIDAD.solo;

    const pesos = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO');

    /* "sábado, 19 de septiembre" con mayúscula: en es-CO el día viene en
       minúscula, y abre el renglón del aviso. */
    const dia = (iso) => {
        const d = new Date(iso).toLocaleDateString('es-CO',
            { weekday: 'long', day: 'numeric', month: 'long', timeZone: ZONA });
        return d.charAt(0).toUpperCase() + d.slice(1);
    };

    /* La misma fecha para meterla dentro de una frase: "del sábado 19 de
       septiembre", sin mayúscula y sin la coma que la parte en dos. */
    const diaSuelto = (iso) => new Date(iso).toLocaleDateString('es-CO',
        { weekday: 'long', day: 'numeric', month: 'long', timeZone: ZONA }).replace(',', '');

    const hora = (iso) => new Date(iso).toLocaleTimeString('es-CO',
        { hour: 'numeric', minute: '2-digit', timeZone: ZONA });

    /* Cuántos minutos antes de una hora, dicho en hora de Colombia. Sirve
       para "la sala sale a las 7:50": ese dato lo calcula la plataforma, no
       el organizador de memoria. */
    const horaMenos = (iso, minutos) => hora(new Date(new Date(iso).getTime() - minutos * 60000));

    /* Quita las líneas de más que dejan los condicionales: sin esto, un
       torneo sin mapa deja un renglón vacío en la mitad del aviso. */
    const limpiar = (texto) => String(texto)
        .split('\n').filter((l, i, a) => !(l.trim() === '' && a[i - 1] !== undefined && a[i - 1].trim() === ''))
        .join('\n').replace(/\n{3,}/g, '\n\n')
        /* La hora en es-CO termina en punto ("8:00 p. m."), así que una frase
           que cierra con la hora acaba en "p. m..". */
        .replace(/\.\.+/g, '.')
        .trim();

    const sitioDe = (o) => (o && o.sitio) || 'torneosff.online';

    /* Los minutos con los que la plataforma libera la sala. Está aquí y en
       app.js el mismo número; si un día cambia, cambia en los dos o el
       aviso miente. */
    const MIN_SALA = 10;

    function premios(t) {
        const l = [];
        if (t.precioKill) l.push(`${pesos(t.precioKill)} por kill`);
        if (t.premioGanador) l.push(`${pesos(t.premioGanador)} ${QUIEN_GANA[t.modo] || QUIEN_GANA.solo}`);
        return l.join(' + ');
    }

    /* ---- Los mensajes ---- */

    function anuncio(t, o) {
        const enEquipo = t.modo === 'duo' || t.modo === 'escuadra';
        return limpiar(`🔥 TORNEO ABIERTO — ${NOMBRE_MODO[t.modo] || 'SOLO'}

📅 ${dia(t.fecha)}
🕗 ${hora(t.fecha)}
${t.mapa ? `🗺️ ${t.mapa}` : ''}
👥 Cupo: ${t.cupoMax} ${unidadDe(t.modo)}
💵 Inscripción: ${pesos(t.costo)} por jugador

💰 ${premios(t)}

${enEquipo ? `¿No tienes ${t.modo === 'duo' ? 'dúo' : 'equipo'}? Inscríbete solo, la página te busca compañero.\n` : ''}
Inscríbete 👉 ${sitioDe(o)}`);
    }

    function ultimosCupos(t, o) {
        const quedan = Math.max(0, (t.cupoMax || 0) - (t.inscritos || 0));
        return limpiar(`⏳ ${quedan === 1
            ? `Queda 1 cupo para el torneo ${NOMBRE_MODO[t.modo] || 'SOLO'} del ${diaSuelto(t.fecha)}.`
            : `Quedan ${quedan} cupos para el torneo ${NOMBRE_MODO[t.modo] || 'SOLO'} del ${diaSuelto(t.fecha)}.`}

Empieza a las ${hora(t.fecha)} 👉 ${sitioDe(o)}`);
    }

    /* El que reemplaza al viejo "aquí está la sala": manda a la página, que
       es donde los datos solo los ve quien pagó. */
    function recordatorio(t, o) {
        return limpiar(`⏰ El torneo ${NOMBRE_MODO[t.modo] || 'SOLO'} empieza a las ${hora(t.fecha)}.

Los inscritos: abran ${sitioDe(o)}, entren al torneo y ahí les va a aparecer el ID y la contraseña de la sala, solos, a las ${horaMenos(t.fecha, MIN_SALA)}.

El que no esté adentro a las ${hora(t.fecha)} en punto pierde el cupo.`);
    }

    /* Falta gente para el mínimo. Es el mensaje que salva el torneo: sin
       él, el organizador se entera de que no se llenó cuando ya es la hora. */
    function faltanParaJugar(t, o) {
        const faltan = Math.max(0, (t.minimo || 0) - (t.inscritos || 0));
        return limpiar(`⚠️ El torneo ${NOMBRE_MODO[t.modo] || 'SOLO'} del ${diaSuelto(t.fecha)} necesita ${faltan} ${unidadDe(t.modo)} más para jugarse.

Si no llegamos al mínimo de ${t.minimo}, se cancela y a todos se les devuelve el cupo completo.

Corre la voz 👉 ${sitioDe(o)}`);
    }

    /* Le entra la tabla ya calculada por el panel: nombre, kills y premio
       de cada equipo. Se muestran los tres primeros porque un mensaje de
       WhatsApp con cuarenta líneas no lo lee nadie. */
    function resultados(t, o) {
        const podio = ((o && o.podio) || []).slice(0, 3);
        const medallas = ['🥇', '🥈', '🥉'];
        const lineas = podio.map((p, i) =>
            `${medallas[i]} ${p.nombre} — ${p.kills} kill${p.kills === 1 ? '' : 's'} — ${pesos(p.premio)}`);
        const jugaron = (o && o.jugaron) || t.jugadores || 0;
        return limpiar(`🏆 RESULTADOS — ${NOMBRE_MODO[t.modo] || 'SOLO'}, ${diaSuelto(t.fecha)}

${lineas.join('\n')}

La tabla completa está en ${sitioDe(o)}. El premio ya está en el saldo de cada uno; se retira desde ${pesos((o && o.minRetiro) || 10000)} en Billetera.

¿Algo no cuadra? En el grupo de reclamos, hoy mismo.

${jugaron ? `Gracias a ${jugaron === 1 ? 'el que jugó' : `los ${jugaron} que jugaron`}.` : ''}`);
    }

    function cancelado(t, o) {
        return limpiar(`❌ El torneo ${NOMBRE_MODO[t.modo] || 'SOLO'} del ${diaSuelto(t.fecha)} no se juega: no llegamos al mínimo de ${t.minimo} ${unidadDe(t.modo)}.

A todos se les devolvió el cupo completo al saldo. Revisen su billetera, ya está ahí.

Los demás torneos siguen abiertos 👉 ${sitioDe(o)}`);
    }

    /* ---- Qué mensaje toca ahora ----
       El panel no enseña los seis a la vez: enseña el que corresponde al
       estado del torneo y deja los otros a un clic. Un organizador con
       prisa no debería tener que elegir. */
    const TODOS = [
        { clave: 'anuncio',     titulo: 'Torneo abierto',    cuando: 'Apenas lo creas',            hacer: anuncio },
        { clave: 'faltan',      titulo: 'Faltan para jugar', cuando: 'Si no llega al mínimo',      hacer: faltanParaJugar },
        { clave: 'ultimos',     titulo: 'Últimos cupos',     cuando: 'Cuando queden pocos',        hacer: ultimosCupos },
        { clave: 'recordatorio',titulo: 'Recordatorio',      cuando: 'Media hora antes',           hacer: recordatorio },
        { clave: 'resultados',  titulo: 'Resultados',        cuando: 'Al publicar la tabla',       hacer: resultados },
        { clave: 'cancelado',   titulo: 'Cancelado',         cuando: 'Si se cancela',              hacer: cancelado }
    ];

    function sugerido(t) {
        if (t.estado === 'cancelado') return 'cancelado';
        if (t.estado === 'finalizado') return 'resultados';
        if (t.estado === 'en_curso') return 'recordatorio';
        const faltanMin = (t.minimo || 0) - (t.inscritos || 0);
        const quedan = (t.cupoMax || 0) - (t.inscritos || 0);
        /* Que no se llegue al mínimo es más urgente que que queden pocos
           cupos: lo primero cancela el torneo, lo segundo solo lo llena. */
        if (faltanMin > 0 && (t.inscritos || 0) > 0) return 'faltan';
        if (quedan > 0 && quedan <= Math.max(3, Math.round((t.cupoMax || 0) * 0.15))) return 'ultimos';
        return 'anuncio';
    }

    function lista(t, o) {
        return TODOS.map((m) => ({
            clave: m.clave, titulo: m.titulo, cuando: m.cuando,
            texto: m.hacer(t, o || {})
        }));
    }

    function para(t, clave, o) {
        const m = TODOS.find((x) => x.clave === clave);
        return m ? m.hacer(t, o || {}) : '';
    }

    raiz.MensajesTorneo = { lista, para, sugerido, MIN_SALA, unidadDe };
}(typeof window !== 'undefined' ? window : globalThis));
