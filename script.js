/* ============================================================
   BARBERÍA BARBA AZUL — JavaScript
   Optimizado para rendimiento y compatibilidad móvil
   ============================================================ */

(function () {
    'use strict';

    // ===== UTILIDADES =====
    const $ = (sel, ctx = document) => ctx.querySelector(sel);
    const $$ = (sel, ctx = document) => ctx.querySelectorAll(sel);
    const isTouchDevice = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    // ===== PRELOADER =====
    window.addEventListener('load', () => {
        setTimeout(() => {
            const preloader = $('#preloader');
            if (preloader) {
                preloader.classList.add('hidden');
                // Liberar memoria después de la transición
                setTimeout(() => preloader.remove(), 600);
            }
        }, 1200);
    });

    // ===== CURSOR GLOW (solo desktop) =====
    if (!isTouchDevice()) {
        const glow = $('#cursorGlow');
        if (glow) {
            let rafId;
            document.addEventListener('mousemove', (e) => {
                if (rafId) cancelAnimationFrame(rafId);
                rafId = requestAnimationFrame(() => {
                    glow.style.left = e.clientX + 'px';
                    glow.style.top = e.clientY + 'px';
                });
            }, { passive: true });
        }
    } else {
        // Ocultar glow en móvil
        const glow = $('#cursorGlow');
        if (glow) glow.style.display = 'none';
    }

    // ===== PARTICLES (reducidas en móvil) =====
    const particlesContainer = $('#particles');
    if (particlesContainer) {
        const count = isTouchDevice() ? 12 : 30;
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < count; i++) {
            const p = document.createElement('div');
            p.className = 'particle';
            p.style.left = Math.random() * 100 + '%';
            p.style.animationDelay = Math.random() * 8 + 's';
            p.style.animationDuration = (6 + Math.random() * 6) + 's';
            const size = (1 + Math.random() * 2) + 'px';
            p.style.width = size;
            p.style.height = size;
            fragment.appendChild(p);
        }
        particlesContainer.appendChild(fragment);
    }

    // ===== HERO SPARKLES (reducidas en móvil) =====
    const sparklesContainer = $('#heroSparkles');
    if (sparklesContainer) {
        const count = isTouchDevice() ? 6 : 15;
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < count; i++) {
            const s = document.createElement('div');
            s.className = 'sparkle';
            s.style.left = Math.random() * 100 + '%';
            s.style.top = Math.random() * 100 + '%';
            s.style.animationDelay = Math.random() * 5 + 's';
            s.style.animationDuration = (2 + Math.random() * 3) + 's';
            fragment.appendChild(s);
        }
        sparklesContainer.appendChild(fragment);
    }

    // ===== NAVBAR SCROLL =====
    const navbar = $('#navbar');
    if (navbar) {
        let ticking = false;
        window.addEventListener('scroll', () => {
            if (!ticking) {
                requestAnimationFrame(() => {
                    navbar.classList.toggle('scrolled', window.scrollY > 80);
                    ticking = false;
                });
                ticking = true;
            }
        }, { passive: true });
    }

    // ===== HAMBURGER MENU =====
    const hamburger = $('#hamburger');
    const navLinks = $('#navLinks');
    if (hamburger && navLinks) {
        hamburger.addEventListener('click', () => {
            const isOpen = hamburger.classList.toggle('active');
            navLinks.classList.toggle('open');
            // Bloquear scroll del body cuando el menú está abierto
            document.body.style.overflow = isOpen ? 'hidden' : '';
        });

        // Cerrar menú al hacer clic en un enlace
        $$('a', navLinks).forEach(link => {
            link.addEventListener('click', () => {
                hamburger.classList.remove('active');
                navLinks.classList.remove('open');
                document.body.style.overflow = '';
            });
        });

        // Cerrar menú con tecla Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && navLinks.classList.contains('open')) {
                hamburger.classList.remove('active');
                navLinks.classList.remove('open');
                document.body.style.overflow = '';
            }
        });
    }

    // ===== SCROLL REVEAL =====
    const revealElements = $$('.reveal, .reveal-left, .reveal-right, .reveal-scale');
    if (revealElements.length && 'IntersectionObserver' in window) {
        const revealObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry, index) => {
                if (entry.isIntersecting) {
                    setTimeout(() => {
                        entry.target.classList.add('active');
                    }, index * 80);
                    revealObserver.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
        revealElements.forEach(el => revealObserver.observe(el));
    } else {
        // Fallback: mostrar todo directamente
        revealElements.forEach(el => el.classList.add('active'));
    }

    // ===== COUNTER ANIMATION =====
    const counters = $$('.stat-number');
    if (counters.length && 'IntersectionObserver' in window) {
        const counterObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const el = entry.target;
                    const target = parseInt(el.dataset.target, 10);
                    const hasSuffix = el.querySelector('.plus') !== null;
                    let current = 0;
                    const increment = Math.ceil(target / 60);
                    const timer = setInterval(() => {
                        current += increment;
                        if (current >= target) {
                            current = target;
                            clearInterval(timer);
                        }
                        el.innerHTML = current.toLocaleString('es-CO') +
                            (hasSuffix ? '<span class="plus">+</span>' : '');
                    }, 30);
                    counterObserver.unobserve(el);
                }
            });
        }, { threshold: 0.5 });
        counters.forEach(c => counterObserver.observe(c));
    }

    // ===== BACK TO TOP =====
    const backToTop = $('#backToTop');
    if (backToTop) {
        let scrollTicking = false;
        window.addEventListener('scroll', () => {
            if (!scrollTicking) {
                requestAnimationFrame(() => {
                    backToTop.classList.toggle('visible', window.scrollY > 500);
                    scrollTicking = false;
                });
                scrollTicking = true;
            }
        }, { passive: true });

        backToTop.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // ===== ACTIVE NAV LINK =====
    const sections = $$('section[id]');
    if (sections.length) {
        let navTicking = false;
        window.addEventListener('scroll', () => {
            if (!navTicking) {
                requestAnimationFrame(() => {
                    const scrollY = window.scrollY + 200;
                    sections.forEach(sec => {
                        const top = sec.offsetTop;
                        const height = sec.offsetHeight;
                        const id = sec.getAttribute('id');
                        const link = $(`.nav-links a[href="#${id}"]`);
                        if (link) {
                            if (scrollY >= top && scrollY < top + height) {
                                link.style.color = 'var(--gold)';
                                link.classList.add('active-link');
                            } else {
                                link.style.color = '';
                                link.classList.remove('active-link');
                            }
                        }
                    });
                    navTicking = false;
                });
                navTicking = true;
            }
        }, { passive: true });
    }

    // ===== TILT ON SERVICE CARDS (solo desktop) =====
    if (!isTouchDevice()) {
        $$('.service-card').forEach(card => {
            card.addEventListener('mousemove', (e) => {
                const rect = card.getBoundingClientRect();
                const x = (e.clientX - rect.left) / rect.width - 0.5;
                const y = (e.clientY - rect.top) / rect.height - 0.5;
                card.style.transform =
                    `translateY(-8px) perspective(600px) rotateX(${y * -5}deg) rotateY(${x * 5}deg)`;
            });
            card.addEventListener('mouseleave', () => {
                card.style.transform = '';
            });
        });
    }

    // ===== LAZY LOADING FALLBACK =====
    // Para navegadores que no soportan loading="lazy" nativo
    if (!('loading' in HTMLImageElement.prototype)) {
        const lazyImages = $$('img[loading="lazy"]');
        if (lazyImages.length && 'IntersectionObserver' in window) {
            const imgObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        if (img.dataset.src) {
                            img.src = img.dataset.src;
                        }
                        imgObserver.unobserve(img);
                    }
                });
            }, { rootMargin: '100px' });
            lazyImages.forEach(img => imgObserver.observe(img));
        }
    }

    // ===== VIEWPORT HEIGHT FIX para iOS =====
    function setVH() {
        const vh = window.innerHeight * 0.01;
        document.documentElement.style.setProperty('--vh', `${vh}px`);
    }
    setVH();
    window.addEventListener('resize', setVH, { passive: true });

})();
