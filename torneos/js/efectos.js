/* ============================================================
   ARENA AZUL — Efectos visuales (efectos.js)
   ------------------------------------------------------------
   Brasas de fondo, contadores que suben, onda al pulsar y
   pequeños detalles de movimiento. Todo se apaga solo si el
   sistema pide menos animación o si la pestaña no está a la vista.
   ============================================================ */

(function () {
    'use strict';

    const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ===== Brasas subiendo ===== */
    function brasas() {
        if (quieto) return;
        const lienzo = document.getElementById('brasas');
        if (!lienzo) return;
        const ctx = lienzo.getContext('2d', { alpha: true });
        let ancho = 0, alto = 0, chispas = [], raf = null;

        // La chispa se dibuja UNA vez en un lienzo aparte y luego solo se
        // estampa: crear un degradado por chispa en cada fotograma costaba
        // la mitad de los cuadros por segundo en el celular.
        const SPRITE = 32;
        const sprite = document.createElement('canvas');
        sprite.width = sprite.height = SPRITE;
        (function () {
            const sc = sprite.getContext('2d');
            const g = sc.createRadialGradient(SPRITE / 2, SPRITE / 2, 0, SPRITE / 2, SPRITE / 2, SPRITE / 2);
            g.addColorStop(0, 'rgba(255, 216, 120, 1)');
            g.addColorStop(0.35, 'rgba(255, 168, 40, .55)');
            g.addColorStop(1, 'rgba(255, 77, 0, 0)');
            sc.fillStyle = g;
            sc.fillRect(0, 0, SPRITE, SPRITE);
        })();

        const medir = () => {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            ancho = lienzo.width = innerWidth * dpr;
            alto = lienzo.height = innerHeight * dpr;
            lienzo.style.width = innerWidth + 'px';
            lienzo.style.height = innerHeight + 'px';
            ctx.scale(dpr, dpr);
            // Menos chispas en pantallas chicas: el celular lo agradece
            const cuantas = innerWidth < 640 ? 22 : 40;
            chispas = Array.from({ length: cuantas }, nueva);
        };

        function nueva() {
            return {
                x: Math.random() * innerWidth,
                y: innerHeight + Math.random() * innerHeight,
                r: 0.7 + Math.random() * 1.9,
                v: 0.25 + Math.random() * 0.75,
                vaiven: Math.random() * Math.PI * 2,
                alfa: 0.2 + Math.random() * 0.5
            };
        }

        function pintar() {
            ctx.clearRect(0, 0, innerWidth, innerHeight);
            ctx.globalCompositeOperation = 'lighter';
            for (const c of chispas) {
                c.y -= c.v;
                c.vaiven += 0.012;
                if (c.y < -20) Object.assign(c, nueva(), { y: innerHeight + 20 });
                const x = c.x + Math.sin(c.vaiven) * 14;
                const d = c.r * 8;
                ctx.globalAlpha = c.alfa;
                ctx.drawImage(sprite, x - d / 2, c.y - d / 2, d, d);
            }
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
            raf = requestAnimationFrame(pintar);
        }

        const arrancar = () => { if (!raf) raf = requestAnimationFrame(pintar); };
        const parar = () => { if (raf) { cancelAnimationFrame(raf); raf = null; } };

        medir();
        arrancar();
        addEventListener('resize', () => { parar(); medir(); arrancar(); }, { passive: true });
        document.addEventListener('visibilitychange', () => document.hidden ? parar() : arrancar());
    }

    /* ===== Cifras que suben desde cero =====
       El número real ya viene escrito en el HTML: la animación solo lo
       adorna cuando entra en pantalla. Así una captura o un navegador sin
       JavaScript muestran la cifra de verdad, nunca un cero. */
    function contar(el) {
        const destino = Number(el.dataset.valor);
        if (!isFinite(destino)) return;
        const formato = el.dataset.formato === 'cop'
            ? (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)
            : (n) => new Intl.NumberFormat('es-CO').format(n);

        if (quieto || destino === 0) { el.textContent = formato(destino); return; }

        const dura = 950;
        const inicio = performance.now();
        el.classList.add('contando');
        (function paso(ahora) {
            const t = Math.min(1, (ahora - inicio) / dura);
            const suave = 1 - Math.pow(1 - t, 3);
            el.textContent = formato(Math.round(destino * suave));
            if (t < 1) requestAnimationFrame(paso);
        })(inicio);
    }

    // Las cifras se animan cuando aparecen en pantalla; si el navegador no
    // soporta el observador, se muestran de una (nunca quedan invisibles).
    const observador = 'IntersectionObserver' in window
        ? new IntersectionObserver((entradas, obs) => {
            entradas.forEach((e) => {
                if (e.isIntersecting) { contar(e.target); obs.unobserve(e.target); }
            });
        }, { threshold: 0.4 })
        : null;

    function activarContadores(raiz) {
        (raiz || document).querySelectorAll('[data-valor]:not([data-contado])').forEach((el) => {
            el.dataset.contado = '1';
            if (observador) observador.observe(el); else contar(el);
        });
    }

    /* ===== Onda al pulsar ===== */
    function onda(e) {
        const btn = e.target.closest('.btn');
        if (!btn || quieto) return;
        const r = btn.getBoundingClientRect();
        const d = Math.max(r.width, r.height);
        const s = document.createElement('span');
        s.className = 'onda';
        s.style.width = s.style.height = d + 'px';
        s.style.left = (e.clientX - r.left - d / 2) + 'px';
        s.style.top = (e.clientY - r.top - d / 2) + 'px';
        btn.appendChild(s);
        setTimeout(() => s.remove(), 600);
    }

    /* ===== Barra superior al desplazar ===== */
    function barraAlDesplazar() {
        const nav = document.querySelector('.nav');
        if (!nav) return;
        let tic = false;
        addEventListener('scroll', () => {
            if (tic) return;
            tic = true;
            requestAnimationFrame(() => {
                nav.classList.toggle('abajo', scrollY > 24);
                tic = false;
            });
        }, { passive: true });
    }

    /* ===== Pantalla de carga ===== */
    function quitarCarga() {
        const c = document.getElementById('carga');
        if (!c) return;
        setTimeout(() => {
            c.classList.add('fuera');
            setTimeout(() => c.remove(), 600);
        }, quieto ? 0 : 650);
    }

    /* ===== Arranque ===== */
    document.addEventListener('click', onda);
    addEventListener('load', quitarCarga);
    // Red de seguridad: si algo tarda, la pantalla de carga no se queda pegada
    setTimeout(quitarCarga, 4000);

    brasas();
    barraAlDesplazar();

    window.Efectos = { activarContadores, contar };
})();
