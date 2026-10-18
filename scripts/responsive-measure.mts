// The browser half of `check:responsive` (slice 23): what runs INSIDE the page.
//
// Kept as plain JavaScript in strings, not as TypeScript functions handed to
// `page.evaluate`: tsx compiles this repo's scripts with esbuild's keepNames,
// which wraps named functions in a `__name(...)` helper that does not exist in
// the page — so a function passed across would throw there. A string crosses
// unchanged. No backticks inside, so the strings stay plain.
//
// Three measurements, per screen and width (see `devpost/checklist.md > 23`,
// Verify): sideways scroll, small targets, and cut lettering. Each returns
// plain data; the Node side classifies, prints and writes `report.json`.

/** Makes lazy pictures load now, then waits for the fonts and every picture (each at most 8 s). */
export const SETTLE_SOURCE = String.raw`(async function () {
  var imgs = Array.prototype.slice.call(document.images);
  imgs.forEach(function (img) { if (img.loading === 'lazy') img.loading = 'eager'; });
  try { await document.fonts.ready; } catch (e) {}
  await Promise.all(imgs.map(function (img) {
    if (img.complete) return null;
    return new Promise(function (resolve) {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
      setTimeout(resolve, 8000);
    });
  }));
  var videos = Array.prototype.slice.call(document.querySelectorAll('video[poster]'));
  await Promise.all(videos.map(function (v) {
    return new Promise(function (resolve) {
      var poster = new Image();
      poster.onload = resolve; poster.onerror = resolve; poster.src = v.poster;
      setTimeout(resolve, 5000);
    });
  }));
  await new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
  return true;
})()`

/** The Next dev overlay's badge is the dev server's, never the studio's: hidden from screenshots. */
export const HIDE_DEV_CHROME_CSS = 'nextjs-portal{display:none!important}'

/** The same, as an init script: in place before the page's own scripts run, on every navigation. */
export const HIDE_DEV_CHROME_SCRIPT = String.raw`(function () {
  var add = function () {
    var s = document.createElement('style');
    s.textContent = 'nextjs-portal{display:none!important}';
    (document.head || document.documentElement).appendChild(s);
  };
  if (document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add);
})()`

export type MeasureArgs = {
  /** The width the context was opened at — the test for sideways scroll, whatever the browser zoomed to. */
  width: number
  /** 44 at touch widths, 24 on the desktop. */
  minTarget: number
  /** WCAG 2.5.8's spacing exception applies (desktop only; touch keeps the 44 px rule). */
  spacing: boolean
  /** CSS selector of the one element whose targets count (an open dialog); null for the whole page. */
  scope: string | null
  verbose: boolean
}

export type ElementInfo = {
  selector: string
  label: string
  /** Class lists from the element up to <body>, nearest first — the Node side finds the owning file from them. */
  chain: string[][]
  /** React component names that rendered it, nearest first (dev builds keep the names). */
  owners: string[]
}

export type TargetHit = ElementInfo & { w: number; h: number; hitFrom: 'self' | 'label' }
export type Exemption = ElementInfo & { reason: string; w: number; h: number }
export type Offender = ElementInfo & { left: number; right: number; width: number }
export type CutText = ElementInfo & { detail: string }

export type Measurement = {
  innerWidth: number
  visualWidth: number
  docScrollWidth: number
  bodyScrollWidth: number
  /** overflow-x on <html>/<body> that hides a sideways scroll rather than removing it. */
  masked: string | null
  sideways: boolean
  offenders: Offender[]
  small: TargetHit[]
  exempt: Exemption[]
  cut: CutText[]
  /** Ellipsis and line-clamp truncations: reported, never failed (often deliberate). */
  truncated: CutText[]
  coarse: boolean
  targetsChecked: number
  scopeFound: boolean
}

/** `(${MEASURE_SOURCE})(args)` → Measurement. */
export const MEASURE_SOURCE = String.raw`function (args) {
  var W = args.width;
  var docEl = document.documentElement;
  var body = document.body;

  function describe(el) {
    var parts = [];
    var e = el;
    for (var i = 0; i < 4 && e && e !== body && e !== docEl; i++) {
      var s = e.tagName.toLowerCase();
      if (e.id && !/^(:|radix|headlessui)/.test(e.id) && !/[:]/.test(e.id)) {
        s += '#' + e.id;
        parts.unshift(s);
        break;
      }
      var cls = Array.prototype.filter.call(e.classList, function (c) { return !/^is-/.test(c); }).slice(0, 3);
      if (cls.length) s += '.' + cls.join('.');
      ['data-station', 'role', 'type', 'name'].forEach(function (a) {
        var v = e.getAttribute(a);
        if (v && (a !== 'type' || e.tagName === 'INPUT')) s += '[' + a + '="' + v + '"]';
      });
      parts.unshift(s);
      e = e.parentElement;
    }
    return parts.join(' > ');
  }
  function labelOf(el) {
    var t = el.getAttribute('aria-label') || '';
    if (!t) t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t) t = el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('name') || el.getAttribute('alt') || '';
    return t.length > 60 ? t.slice(0, 57) + '…' : t;
  }
  function chainOf(el) {
    var out = [];
    var e = el;
    while (e && e !== docEl && out.length < 30) {
      var c = Array.prototype.slice.call(e.classList);
      if (e.id) c = c.concat(['#' + e.id]);
      out.push(c);
      e = e.parentElement;
    }
    return out;
  }
  // The components that rendered it, nearest first, read from React's dev-mode
  // fiber (a portal's fiber returns to the component that opened it).
  function ownersOf(el) {
    var key = Object.keys(el).find(function (k) { return k.indexOf('__reactFiber$') === 0; });
    var f = key ? el[key] : null;
    var names = [];
    while (f && names.length < 25) {
      var t = f.type;
      if (t && typeof t !== 'string') {
        var n = t.displayName || t.name || (t.render && (t.render.displayName || t.render.name)) || (t.type && (t.type.displayName || t.type.name)) || '';
        if (n && names[names.length - 1] !== n) names.push(n);
      }
      f = f.return;
    }
    return names;
  }
  function info(el) { return { selector: describe(el), label: labelOf(el), chain: chainOf(el), owners: ownersOf(el) }; }
  function round(n) { return Math.round(n * 10) / 10; }
  function clipsX(cs) { return cs.overflowX !== 'visible'; }
  function clipsAny(cs) { return cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || /paint|strict|content/.test(cs.contain || ''); }
  function visible(el) {
    if (typeof el.checkVisibility === 'function') {
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false;
    } else {
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // ---- (a) sideways scroll -------------------------------------------------
  var docSW = docEl.scrollWidth;
  var bodySW = body ? body.scrollWidth : 0;
  var htmlCs = getComputedStyle(docEl);
  var bodyCs = body ? getComputedStyle(body) : htmlCs;
  var sideways = Math.max(docSW, bodySW) > W + 1 || window.innerWidth > W + 1;
  var masked = null;
  ['html', 'body'].forEach(function (name) {
    var cs = name === 'html' ? htmlCs : bodyCs;
    if (cs.overflowX === 'hidden' || cs.overflowX === 'clip') masked = (masked ? masked + ', ' : '') + name + ' overflow-x: ' + cs.overflowX;
  });
  var offenders = [];
  var all = Array.prototype.slice.call(document.querySelectorAll('body *'));
  var sticking = new Set();
  // Something sticking out past the page's right edge (or left of 0) that no
  // clipping ancestor holds in — the thing that makes the page scroll sideways.
  // Also looked for when html/body hide the overflow, which only masks it.
  all.forEach(function (el) {
    if (el.closest('nextjs-portal')) return;
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    var cs = getComputedStyle(el);
    if (cs.position === 'fixed' && cs.visibility === 'hidden') return;
    if (r.right <= W + 1 && r.left >= -1) return;
    var p = el.parentElement;
    while (p && p !== body && p !== docEl) {
      var pcs = getComputedStyle(p);
      if (clipsX(pcs)) {
        var pr = p.getBoundingClientRect();
        if (pr.right <= W + 1 && pr.left >= -1) return; // held in by a clipping box that itself fits
      }
      p = p.parentElement;
    }
    sticking.add(el);
  });
  sticking.forEach(function (el) {
    if (el.parentElement && sticking.has(el.parentElement)) return; // report the outermost only
    var r = el.getBoundingClientRect();
    var o = info(el);
    o.left = round(r.left); o.right = round(r.right); o.width = round(r.width);
    offenders.push(o);
  });
  offenders.sort(function (a, b) { return b.right - a.right; });
  if (!sideways && !masked) offenders = [];
  offenders = offenders.slice(0, 12);

  // ---- (b) small targets ---------------------------------------------------
  var scopeEl = null;
  if (args.scope) {
    var found = Array.prototype.filter.call(document.querySelectorAll(args.scope), visible);
    scopeEl = found.length ? found[found.length - 1] : null;
  }
  var root = scopeEl || document;
  var SEL = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="menuitem"], [tabindex]:not([tabindex="-1"])';
  var candidates = Array.prototype.slice.call(root.querySelectorAll(SEL));
  if (scopeEl && scopeEl.matches(SEL)) candidates.unshift(scopeEl);
  var small = [];
  var exempt = [];
  var seen = new Set();
  var measured = [];

  function labelFor(el) {
    var l = el.closest('label');
    if (l) return l;
    if (el.id) {
      try { return document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); } catch (e) { return null; }
    }
    return null;
  }
  function isInlineLink(el) {
    if (el.tagName !== 'A') return false;
    var cs = getComputedStyle(el);
    if (cs.display !== 'inline') return false;
    var block = el.parentElement;
    while (block && getComputedStyle(block).display.indexOf('inline') === 0) block = block.parentElement;
    if (!block) return false;
    var clone = block.cloneNode(true);
    Array.prototype.forEach.call(clone.querySelectorAll(SEL), function (n) { n.remove(); });
    var rest = (clone.textContent || '').replace(/[\s·|•–—,.;:()]+/g, '');
    return rest.length >= 3;
  }

  candidates.forEach(function (el) {
    if (seen.has(el)) return;
    seen.add(el);
    if (el.closest('nextjs-portal')) return;
    if (el.matches(':disabled')) return;
    var hidden = el.closest('[aria-hidden="true"], [inert]');
    var isChoice = el.tagName === 'INPUT' && /^(checkbox|radio|file)$/.test(el.type);
    var label = isChoice ? labelFor(el) : null;
    var target = el;
    var hitFrom = 'self';
    if (label && visible(label)) { target = label; hitFrom = 'label'; }
    else if (!visible(el)) return;
    if (seen.has(target) && target !== el) return;
    seen.add(target);
    var r = target.getBoundingClientRect();
    var o = info(target);
    o.w = round(r.width); o.h = round(r.height);
    if (hidden) { o.reason = 'inside ' + (hidden.hasAttribute('inert') ? 'inert' : 'aria-hidden') + ' ' + describe(hidden); exempt.push(o); return; }
    if (r.width <= 1.5 && r.height <= 1.5) { o.reason = 'visually hidden (1 px clip, a screen-reader-only control)'; exempt.push(o); return; }
    if (isInlineLink(target)) {
      if (r.width < args.minTarget || r.height < args.minTarget) { o.reason = 'inline link in running text (WCAG 2.5.8 inline exception)'; exempt.push(o); }
      return;
    }
    measured.push({ el: target, r: r, o: o, hitFrom: hitFrom });
  });

  var undersized = measured.filter(function (m) { return m.r.width < args.minTarget - 0.5 || m.r.height < args.minTarget - 0.5; });
  undersized.forEach(function (m) {
    if (args.spacing) {
      // WCAG 2.5.8: an undersized target passes when a 24 px circle on its centre
      // touches no other target and no other undersized target's circle.
      var cx = m.r.left + m.r.width / 2, cy = m.r.top + m.r.height / 2;
      var clear = measured.every(function (n) {
        if (n === m) return true;
        var dx = Math.max(n.r.left - cx, 0, cx - n.r.right);
        var dy = Math.max(n.r.top - cy, 0, cy - n.r.bottom);
        if (Math.sqrt(dx * dx + dy * dy) < 12) return false;
        var under = n.r.width < args.minTarget - 0.5 || n.r.height < args.minTarget - 0.5;
        if (under) {
          var nx = n.r.left + n.r.width / 2, ny = n.r.top + n.r.height / 2;
          if (Math.hypot(nx - cx, ny - cy) < 24) return false;
        }
        return true;
      });
      if (clear) { m.o.reason = 'spaced: a 24 px circle on it touches no other target (WCAG 2.5.8 spacing exception)'; exempt.push(m.o); return; }
    }
    m.o.hitFrom = m.hitFrom;
    small.push(m.o);
  });

  // ---- (c) cut lettering ---------------------------------------------------
  var LETTERING = '.bubble-text, .cover-title, [data-lettering]';
  var cut = [];
  Array.prototype.forEach.call(document.querySelectorAll(LETTERING), function (el) {
    if (!visible(el)) return;
    if (!(el.textContent || '').trim()) return;
    var cs = getComputedStyle(el);
    var reasons = [];
    if (cs.overflowY !== 'visible' && el.scrollHeight > el.clientHeight + 1) reasons.push('clipped vertically ' + el.scrollHeight + ' > ' + el.clientHeight + ' px');
    if (cs.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1) reasons.push('clipped horizontally ' + el.scrollWidth + ' > ' + el.clientWidth + ' px');
    var range = document.createRange();
    range.selectNodeContents(el);
    var tr = range.getBoundingClientRect();
    var p = el.parentElement;
    while (p && p !== body) {
      var pcs = getComputedStyle(p);
      if (clipsAny(pcs)) {
        var pr = p.getBoundingClientRect();
        var out = [];
        if (tr.top < pr.top - 1) out.push('top ' + round(pr.top - tr.top));
        if (tr.bottom > pr.bottom + 1) out.push('bottom ' + round(tr.bottom - pr.bottom));
        if (tr.left < pr.left - 1) out.push('left ' + round(pr.left - tr.left));
        if (tr.right > pr.right + 1) out.push('right ' + round(tr.right - pr.right));
        if (out.length) { reasons.push('text runs past ' + describe(p) + ' (' + out.join(', ') + ' px)'); break; }
      }
      p = p.parentElement;
    }
    if (reasons.length) { var o = info(el); o.detail = reasons.join('; ') + ' — font ' + cs.fontSize; cut.push(o); }
  });

  var truncated = [];
  all.forEach(function (el) {
    if (!el.firstChild) return;
    var cs = getComputedStyle(el);
    var clamp = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
    if (cs.textOverflow !== 'ellipsis' && !clamp) return;
    if (!visible(el)) return;
    var over = clamp ? el.scrollHeight > el.clientHeight + 1 : el.scrollWidth > el.clientWidth + 1;
    if (!over) return;
    var o = info(el);
    o.detail = clamp ? 'line-clamped to ' + cs.webkitLineClamp + ' lines' : 'ellipsis';
    o.detail += ': “' + (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) + '”';
    truncated.push(o);
  });

  return {
    innerWidth: window.innerWidth,
    visualWidth: window.visualViewport ? Math.round(window.visualViewport.width) : window.innerWidth,
    docScrollWidth: docSW,
    bodyScrollWidth: bodySW,
    masked: masked,
    sideways: sideways,
    offenders: offenders,
    small: small,
    exempt: exempt,
    cut: cut,
    truncated: truncated,
    coarse: matchMedia('(pointer: coarse)').matches,
    targetsChecked: measured.length,
    scopeFound: !args.scope || Boolean(scopeEl)
  };
}`
