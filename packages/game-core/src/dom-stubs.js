/**
 * Minimal DOM / browser stubs so the real game scripts run headless in Node.
 * Only what the simulation touches: elements, canvas 2d context, storage, timers, rAF.
 */

function make2dContext(canvas) {
  const gradient = { addColorStop() {} };
  return {
    canvas,
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, transform() {},
    setTransform() {}, resetTransform() {}, setLineDash() {}, getLineDash() { return []; },
    clearRect() {}, fillRect() {}, strokeRect() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, arc() {}, arcTo() {}, ellipse() {}, rect() {}, roundRect() {},
    quadraticCurveTo() {}, bezierCurveTo() {}, fill() {}, stroke() {}, clip() {},
    fillText() {}, strokeText() {}, measureText() { return { width: 10 }; },
    createLinearGradient() { return gradient; }, createRadialGradient() { return gradient; },
    createConicGradient() { return gradient; }, createPattern() { return null; },
    drawImage() {}, getImageData() { return { data: new Uint8ClampedArray(4), width: 1, height: 1 }; },
    putImageData() {}, createImageData() { return { data: new Uint8ClampedArray(4), width: 1, height: 1 }; },
    isPointInPath() { return false; }, isPointInStroke() { return false; },
    getContextAttributes() { return {}; },
  };
}

export function makeElement(id = 'el', width = 1280, height = 720) {
  let ctx = null;
  const style = new Proxy({}, { get: () => '', set: () => true });
  const classList = {
    _set: new Set(),
    add(...c) { c.forEach((x) => this._set.add(x)); },
    remove(...c) { c.forEach((x) => this._set.delete(x)); },
    contains(c) { return this._set.has(c); },
    toggle(c, force) {
      const on = force === undefined ? !this._set.has(c) : !!force;
      if (on) this._set.add(c); else this._set.delete(c);
      return on;
    },
  };
  return {
    id, width, height, style, classList,
    offsetWidth: width, offsetHeight: height, clientWidth: width, clientHeight: height,
    innerHTML: '', textContent: '', value: 'SharkKing', disabled: false, checked: false,
    dataset: {}, children: [],
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
    appendChild(c) { return c; }, removeChild() {}, insertBefore() {}, remove() {},
    getContext(type) { if (!ctx) ctx = make2dContext(this); return ctx; },
    getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height }; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    focus() {}, blur() {}, click() {}, scrollTo() {}, setAttribute() {}, getAttribute() { return null; },
    closest() { return null; },
  };
}

export function createDomStubs() {
  const elements = new Map();
  const doc = {
    hidden: false,
    visibilityState: 'visible',
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    createElement(tag) { return makeElement(`created:${tag}`); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
    body: makeElement('body'),
    head: makeElement('head'),
    documentElement: makeElement('html'),
  };

  return { document: doc, elements };
}

export function createStorage() {
  const map = new Map();
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    clear() { map.clear(); },
    key(i) { return [...map.keys()][i] ?? null; },
    get length() { return map.size; },
  };
}
