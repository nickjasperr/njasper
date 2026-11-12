(() => {
    'use strict';

    /* ================================================================
       CONFIG: everything you'll want to tweak lives here
    ================================================================ */

    // Page smooth scroll (Lenis). Lower lerp = floatier/slower.
    // Lower wheelMultiplier = heavier scrolling (0.5 = half the distance per wheel tick).
    const LENIS = {
        lerp: 0.1,
        wheelMultiplier: 0.5,
        smoothWheel: true,
    };

    // Album lists (horizontal Lenis instances + < > buttons)
    const CAROUSEL = {
        lerp: 0.1,
        syncTouch: false,
    };

    // Cursor circle. Radii are in px.
    const CURSOR = {
        radius: 8,         // normal
        hoverRadius: 16,    // over something clickable
        pressRadius: 12,     // while mouse button is held (smaller than normal)
        thickness: 2,       // ring outline thickness in px
        lerp: {
            multiplierPlus: 18,   // speed when growing  (per second)
            multiplierMinus: 18,  // speed when shrinking (per second)
            minDistance: 0.05,    // stop updating when this close to the target
            maxSpeed: 600,        // max change per second (px/s)
        },
    };

    // Album box background fade. 0 = transparent at rest, 0.05 = 5% white on hover.
    const CARD_FADE = {
        base: 0,              // resting alpha
        alpha: 0.05,          // hovered alpha
        lerp: {
            multiplierPlus: 12,
            multiplierMinus: 8,
            minDistance: 0.0005,
            maxSpeed: 0.5,        // alpha units per second
        },
    };

    // Link underline fade. alpha 1 = fully visible underline.
    const LINK_FADE = {
        alpha: 1,
        lerp: {
            multiplierPlus: 14,
            multiplierMinus: 10,
            minDistance: 0.002,
            maxSpeed: 10,         // alpha units per second
        },
    };

    /* ================================================================
       LERP: JS port of ULebbexFunctionsBPLibrary::UpdateLerpSmoothExcluded
       Returns { value, moved }  (value = "New", moved = "Moved")
    ================================================================ */
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

    function updateLerpSmoothExcluded(desired, current, multiplierPlus, multiplierMinus, deltaTime, minDistance, maxSpeed) {
        if (Math.abs(desired - current) < minDistance) {
            return { value: current, moved: false };
        }
        const multiplier = (current < desired ? multiplierPlus : multiplierMinus) * deltaTime;
        const maxSpeedClean = maxSpeed * deltaTime;
        const lerped = current + (desired - current) * clamp(multiplier, 0, 1);
        return {
            value: clamp(lerped, current - maxSpeedClean, current + maxSpeedClean),
            moved: true,
        };
    }

    const stepWith = (cfg, desired, current, dt) =>
        updateLerpSmoothExcluded(desired, current, cfg.multiplierPlus, cfg.multiplierMinus, dt, cfg.minDistance, cfg.maxSpeed);

    /* ================================================================
       NO NATIVE DRAG GHOSTS
       Only stops the browser from picking up links / images / buttons
       and carrying them with the cursor. Dragging anywhere else
       (selecting text, touch scrolling, etc.) is untouched.
    ================================================================ */
    document.addEventListener('dragstart', (e) => {
        if (e.target instanceof Element && e.target.closest('a, img, button')) {
            e.preventDefault();
        }
    });

    /* ================================================================
       LENIS (page)
    ================================================================ */
    let lenis = null;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (window.Lenis && !reduceMotion) {
        lenis = new Lenis(LENIS);
    }

    /* ================================================================
       CURSOR STATE
    ================================================================ */
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const cursorEl = document.getElementById('cursor');

    cursorEl.style.setProperty('--ring', CURSOR.thickness + 'px');

    let mouseX = -9999, mouseY = -9999;
    let radius = CURSOR.radius;
    let pressed = false;
    let visible = false;
    let hovered = null;       // the clickable element under the cursor
    let hoverDirty = false;   // re-check what's under the cursor on the next frame

    function renderCursor() {
        const r = Math.max(radius, CURSOR.thickness);
        cursorEl.style.width = cursorEl.style.height = (r * 2) + 'px';
        cursorEl.style.transform = `translate3d(${mouseX - r}px, ${mouseY - r}px, 0)`;
    }

    function setVisible(v) {
        visible = v;
        cursorEl.classList.toggle('on', v);
    }

    function updateHover() {
        const el = document.elementFromPoint(mouseX, mouseY);
        hovered = el ? el.closest('a, button, [data-clickable]') : null;
    }

    if (finePointer) {
        renderCursor();

        // Position is written straight inside the event handler: no smoothing, no rAF wait.
        window.addEventListener('pointermove', (e) => {
            if (e.pointerType === 'touch') return;
            mouseX = e.clientX;
            mouseY = e.clientY;
            if (!visible) setVisible(true);
            renderCursor();
            hoverDirty = true;
        }, { passive: true });

        window.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'touch') return;
            pressed = true;
        }, { passive: true });

        const release = () => { pressed = false; };
        window.addEventListener('pointerup', release, { passive: true });
        window.addEventListener('pointercancel', release, { passive: true });
        window.addEventListener('blur', release);

        document.documentElement.addEventListener('mouseleave', () => {
            setVisible(false);
            pressed = false;
            hovered = null;
        });
        document.documentElement.addEventListener('mouseenter', () => {
            if (mouseX > -9000) setVisible(true);
        });
    }

    /* ================================================================
       CATEGORY LAYOUT
       "side"  = title rotated on the left, list is 1 album tall,
                 title font size is fitted so its length == height of the list
       "stack" = title above (normal size), list is 2 albums tall
       One decision for the whole section, so all categories always match.
    ================================================================ */
    const discography = document.querySelector('.discography');
    const categories = document.getElementById('categories');
    const probe = document.getElementById('side-probe');
    const CHAR_W = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--char-w')) || 0.612;

    const catItems = Array.from(document.querySelectorAll('.category')).map((section) => {
        const title = section.querySelector('.cat-title');
        return {
            title,
            chars: title.textContent.trim().length,
            albums: Array.from(section.querySelectorAll('.album')),
        };
    });

    // Stacked layout shows 2 rows only for exactly 2 albums or 6+; 3-5 stay in 1 row.
    for (const c of catItems) {
        const n = c.albums.length;
        c.title.closest('.category').classList.toggle('two-rows', n === 2 || n >= 6);
    }

    // Height one album box has in a single-row list (same in both layouts: width is fixed)
    function albumHeight(album) {
        const cs = getComputedStyle(album);
        const cover = album.querySelector('.cover');
        const label = album.querySelector('.album-title');
        let h = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + cover.getBoundingClientRect().height;
        if (label) h += label.getBoundingClientRect().height + parseFloat(getComputedStyle(label).marginTop);
        return h;
    }

    function applyLayout() {
        const fitted = catItems.map((c) => {
            const h = Math.max(0, ...c.albums.map(albumHeight));
            return { c, size: c.chars && h ? h / (c.chars * CHAR_W) : 0 };   // monospace: length = chars * 0.612em
        });
        const titleW = Math.max(0, ...fitted.map((f) => f.size));            // line-height is 1, so width = font size
        const side = categories.clientWidth >= probe.offsetWidth + titleW;
        discography.dataset.layout = side ? 'side' : 'stack';
        for (const f of fitted) {
            let px = 0;
            if (side) px = f.size;                                                        // length == list height
            else if (f.c.chars) {                                                         // stacked: exactly 1 album box wide
                const cardW = f.c.albums[0] ? f.c.albums[0].offsetWidth : categories.clientWidth;
                px = Math.floor(Math.min(cardW, categories.clientWidth) / (f.c.chars * CHAR_W));
            }
            f.c.title.style.fontSize = px ? px + 'px' : '';
        }

        // Stacked layout: when a list overflows, add spacers (as track padding) on both ends so the
        // first and last album can be scrolled to the centre. Same group size the < > buttons page by.
        const edge = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--edge')) || 0;
        for (const root of document.querySelectorAll('[data-carousel]')) {
            const track = root.querySelector('.track');
            const scroller = root.querySelector('.scroller');
            const first = track.children[0];
            let pad = '';                                   // '' = back to the default (--edge)
            if (!side && first) {
                const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
                const step = first.offsetWidth + gap;
                const rows = root.closest('.category').classList.contains('two-rows') ? 2 : 1;
                const cols = Math.ceil(track.children.length / rows);
                const W = scroller.clientWidth;
                const plain = cols * step - gap + 2 * edge; // content width with the normal edge padding
                if (plain > W) {
                    const perPage = Math.max(1, Math.floor(W / step));
                    const group = perPage * step - gap;     // width of what one page shows
                    pad = Math.max(edge, (W - group) / 2) + 'px';
                }
            }
            track.style.setProperty('--track-pad', pad);
        }
    }
    applyLayout();
    new ResizeObserver(applyLayout).observe(categories);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(applyLayout);

    /* ================================================================
       ALBUM LISTS (touch scroll + smooth < > buttons)
       The mouse wheel / trackpad never scrolls a list: over a list it is
       passed straight on to the page, so the page scrolls exactly the same
       as everywhere else.
    ================================================================ */
    const carousels = Array.from(document.querySelectorAll('[data-carousel]')).map((root) => {
        const scroller = root.querySelector('.scroller');
        const track = root.querySelector('.track');
        const prev = root.querySelector('[data-dir="-1"]');
        const next = root.querySelector('[data-dir="1"]');

        let inner = null;
        if (window.Lenis && !reduceMotion) {
            inner = new Lenis({
                wrapper: scroller,
                content: track,
                orientation: 'horizontal',
                gestureOrientation: 'horizontal', // vertical swipes still scroll the page
                lerp: CAROUSEL.lerp,
                smoothWheel: false,               // wheel does nothing to the list
                syncTouch: CAROUSEL.syncTouch,
            });
        }

        scroller.addEventListener('wheel', (e) => {
            if (e.ctrlKey) return;                // pinch-zoom: leave alone
            if (!lenis) {
                // no smooth page scroll: just stop sideways wheel from moving the list
                if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) e.preventDefault();
                return;
            }
            // Lenis ignores wheel events that start inside another Lenis element, so hand
            // the event to the page from a neutral element. Lenis then treats it exactly
            // like a wheel turn anywhere else on the page.
            e.preventDefault();
            e.stopPropagation();
            document.body.dispatchEvent(new WheelEvent('wheel', {
                deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ, deltaMode: e.deltaMode,
                clientX: e.clientX, clientY: e.clientY,
                bubbles: true, cancelable: true,
            }));
        }, { passive: false });

        const update = () => {
            const max = scroller.scrollWidth - scroller.clientWidth;
            prev.disabled = scroller.scrollLeft <= 1;
            next.disabled = scroller.scrollLeft >= max - 1;
            root.classList.toggle('no-scroll', prev.disabled && next.disabled);
            hoverDirty = true;
        };

        // Scroll by whole albums, as many as fit on screen
        let dest = null;   // where an arrow-started animation is heading (so quick repeat clicks keep paging)
        const page = (dir) => {
            const first = track.children[0];
            if (!first) return;
            const stepW = first.offsetWidth + (parseFloat(getComputedStyle(track).columnGap) || 0);
            const perPage = Math.max(1, Math.floor(scroller.clientWidth / stepW));
            const from = dest !== null ? dest : scroller.scrollLeft;
            const max = scroller.scrollWidth - scroller.clientWidth;
            const target = clamp(Math.round(from / stepW) * stepW + dir * perPage * stepW, 0, max);

            if (inner) {
                dest = target;
                inner.scrollTo(target, { lerp: CAROUSEL.lerp, onComplete: () => { dest = null; } });
            } else {
                scroller.scrollTo({ left: target, behavior: reduceMotion ? 'auto' : 'smooth' });
            }
        };

        prev.addEventListener('click', () => page(-1));
        next.addEventListener('click', () => page(1));
        scroller.addEventListener('scroll', update, { passive: true });
        // a finger grabbing the list cancels a pending arrow target
        scroller.addEventListener('touchstart', () => { dest = null; }, { passive: true });

        const ro = new ResizeObserver(update);
        ro.observe(scroller);
        ro.observe(track);
        update();

        return { inner };
    });

    /* ================================================================
       FADE ITEMS (album boxes + links)
    ================================================================ */
    const cfg_base = (isCard) => (isCard ? CARD_FADE.base : 0) || 0;
    const fadeItems = Array.from(document.querySelectorAll('[data-fade]')).map((el) => {
        const isCard = el.dataset.fade === 'card';
        return {
            el,
            cfg: isCard ? CARD_FADE : LINK_FADE,
            prop: isCard ? 'backgroundColor' : 'textDecorationColor',
            current: cfg_base(isCard),
        };
    });

    /* ================================================================
       MAIN LOOP
    ================================================================ */
    if (lenis) lenis.on('scroll', () => { hoverDirty = true; });

    let last = 0;
    function tick(now) {
        const dt = last ? Math.min((now - last) / 1000, 0.1) : 1 / 60;
        last = now;

        if (lenis) lenis.raf(now);
        for (const c of carousels) if (c.inner) c.inner.raf(now);

        if (hoverDirty && visible) {
            hoverDirty = false;
            updateHover();
        }

        // cursor radius
        if (finePointer) {
            const desired = pressed ? CURSOR.pressRadius
                : hovered ? CURSOR.hoverRadius
                    : CURSOR.radius;
            const r = stepWith(CURSOR.lerp, desired, radius, dt);
            if (r.moved) {
                radius = r.value;
                renderCursor();
            }
        }

        // album box backgrounds + link underlines
        for (const item of fadeItems) {
            const desired = item.el === hovered ? item.cfg.alpha : (item.cfg.base || 0);
            const r = stepWith(item.cfg.lerp, desired, item.current, dt);
            if (r.moved) {
                item.current = r.value;
                item.el.style[item.prop] = `rgba(255, 255, 255, ${item.current})`;
            }
        }

        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
})();