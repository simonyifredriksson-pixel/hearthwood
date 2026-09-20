/* Input.js — keyboard, mouse, touch.

   Two distinct mouse concepts, deliberately kept apart, because conflating
   them is what makes a camera fight the player:

     CURSOR  (mouse.x / nx / ny) — a position on screen. For clicking the UI.
     LOOK    (lookDx / lookDy)   — a relative movement this frame. For turning
                                   the camera, and nothing else.

   `lookDx/lookDy` are non-zero only while the camera is genuinely under mouse
   control: pointer locked, or the right button held as the fallback. They are
   forced to zero whenever a menu is open. That single rule is what guarantees
   the camera cannot rotate while the player is reading a signpost.
*/

class InputSystem {
  constructor() {
    this.keys = new Set();
    this.justPressed = new Set();
    this.justReleased = new Set();

    /** Set while a UI screen or a conversation owns the input. */
    this.blocked = false;

    this.mouse = { x: 0, y: 0, nx: 0, ny: 0, wheel: 0 };
    this.lookDx = 0;
    this.lookDy = 0;
    this.buttons = [false, false, false];
    this.clicked = [false, false, false];
    this.overUI = false;

    this.pointerLocked = false;
    this.lockWanted = false;
    this.lockSupported = true;

    /** Touch: a left-side virtual stick, so the game is playable on a tablet. */
    this.touchMove = { x: 0, y: 0, active: false };

    this._bound = false;
    this._onLockChange = null;
  }

  attach(canvas) {
    if (this._bound) return;
    this._bound = true;
    this.canvas = canvas;
    this.lockSupported = !!canvas.requestPointerLock;

    addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const k = e.code;
      if (!this.keys.has(k)) this.justPressed.add(k);
      this.keys.add(k);
      if (PREVENT.has(k)) e.preventDefault();
    });

    addEventListener('keyup', e => {
      this.keys.delete(e.code);
      this.justReleased.add(e.code);
    });

    // Losing focus must clear held state, or the player alt-tabs back to a
    // character quietly walking into a tree.
    addEventListener('blur', () => {
      this.keys.clear();
      this.buttons = [false, false, false];
      this.lookDx = this.lookDy = 0;
      this.touchMove.active = false;
      this.touchMove.x = this.touchMove.y = 0;
    });

    addEventListener('mousemove', e => {
      if (this.pointerLocked) {
        this.lookDx += e.movementX || 0;
        this.lookDy += e.movementY || 0;
        return;
      }
      const px = this.mouse.x, py = this.mouse.y;
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      this.mouse.nx = (e.clientX / innerWidth) * 2 - 1;
      this.mouse.ny = -(e.clientY / innerHeight) * 2 + 1;
      this.overUI = this._hitUI(e.target);
      if (this.buttons[2] && !this.overUI) {
        this.lookDx += e.clientX - px;
        this.lookDy += e.clientY - py;
      }
    }, { passive: true });

    addEventListener('mousedown', e => {
      this.overUI = this._hitUI(e.target);
      if (e.button < 3) {
        this.buttons[e.button] = true;
        if (!this.overUI) this.clicked[e.button] = true;
      }
    });
    addEventListener('mouseup', e => { if (e.button < 3) this.buttons[e.button] = false; });
    addEventListener('contextmenu', e => { if (!this._hitUI(e.target)) e.preventDefault(); });

    addEventListener('wheel', e => {
      if (this._hitUI(e.target)) return;
      this.mouse.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });

    /* ---------------------------------------------------------- touch ---
       Left half of the screen is a movement stick, right half turns the
       camera. Both work at once, which is the only layout that lets someone
       walk and look on a tablet. */
    let lookId = null, lx = 0, ly = 0;
    let moveId = null, mox = 0, moy = 0;
    addEventListener('touchstart', e => {
      if (this._hitUI(e.target)) return;
      for (const t of e.changedTouches) {
        if (t.clientX < innerWidth * 0.42 && moveId === null) {
          moveId = t.identifier; mox = t.clientX; moy = t.clientY;
          this.touchMove.active = true;
        } else if (lookId === null) {
          lookId = t.identifier; lx = t.clientX; ly = t.clientY;
        }
      }
    }, { passive: true });
    addEventListener('touchmove', e => {
      for (const t of e.changedTouches) {
        if (t.identifier === lookId) {
          this.lookDx += (t.clientX - lx) * 1.5;
          this.lookDy += (t.clientY - ly) * 1.5;
          lx = t.clientX; ly = t.clientY;
        } else if (t.identifier === moveId) {
          const R = 62;
          let dx = (t.clientX - mox) / R, dy = -(t.clientY - moy) / R;
          const l = Math.hypot(dx, dy);
          if (l > 1) { dx /= l; dy /= l; }
          this.touchMove.x = dx; this.touchMove.y = dy;
        }
      }
    }, { passive: true });
    const endTouch = e => {
      for (const t of e.changedTouches) {
        if (t.identifier === lookId) lookId = null;
        if (t.identifier === moveId) {
          moveId = null; this.touchMove.active = false;
          this.touchMove.x = this.touchMove.y = 0;
        }
      }
    };
    addEventListener('touchend', endTouch, { passive: true });
    addEventListener('touchcancel', endTouch, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      this.pointerLocked = locked;
      if (!locked) { this.lockWanted = false; this.lookDx = this.lookDy = 0; }
      this._onLockChange?.(locked);
    });
    document.addEventListener('pointerlockerror', () => {
      this.lockSupported = false;
      this.lockWanted = false;
    });
  }

  requestLock() {
    if (!this.lockSupported || this.pointerLocked || !this.canvas) return;
    this.lockWanted = true;
    try { this.canvas.requestPointerLock(); } catch (e) { this.lockSupported = false; }
  }

  releaseLock() {
    this.lockWanted = false;
    if (this.pointerLocked && document.exitPointerLock) {
      try { document.exitPointerLock(); } catch (e) { /* already gone */ }
    }
    this.lookDx = this.lookDy = 0;
  }

  onLockChange(fn) { this._onLockChange = fn; }

  get lookActive() { return !this.blocked && (this.pointerLocked || this.buttons[2]); }

  down(...codes) { if (this.blocked) return false; return codes.some(c => this.keys.has(c)); }
  pressed(...codes) { if (this.blocked) return false; return codes.some(c => this.justPressed.has(c)); }
  rawDown(...codes) { return codes.some(c => this.keys.has(c)); }
  rawPressed(...codes) { return codes.some(c => this.justPressed.has(c)); }

  /** WASD / arrows / touch stick as a normalised vector. x = right, y = fwd. */
  moveAxis() {
    if (this.blocked) return { x: 0, y: 0 };
    if (this.touchMove.active) return { x: this.touchMove.x, y: this.touchMove.y };
    let x = 0, y = 0;
    if (this.down('KeyW', 'ArrowUp')) y += 1;
    if (this.down('KeyS', 'ArrowDown')) y -= 1;
    if (this.down('KeyD', 'ArrowRight')) x += 1;
    if (this.down('KeyA', 'ArrowLeft')) x -= 1;
    const l = Math.hypot(x, y);
    if (l > 1e-4) { x /= l; y /= l; }
    return { x, y };
  }

  lookDelta() {
    if (this.blocked || !this.lookActive) return ZERO;
    return {
      x: Math.max(-220, Math.min(220, this.lookDx)),
      y: Math.max(-220, Math.min(220, this.lookDy)),
    };
  }

  _hitUI(el) {
    while (el) {
      if (el === this.canvas) return false;
      if (UI_IDS.has(el.id)) return true;
      if (el.classList && (el.classList.contains('screen') || el.classList.contains('overlay') ||
        el.classList.contains('panel') || el.classList.contains('dialogue'))) return true;
      el = el.parentElement;
    }
    return false;
  }

  /** Call once at the end of every frame. */
  endFrame() {
    this.justPressed.clear();
    this.justReleased.clear();
    this.clicked = [false, false, false];
    this.lookDx = 0; this.lookDy = 0;
    this.mouse.wheel = 0;
  }
}

const ZERO = { x: 0, y: 0 };
const UI_IDS = new Set(['ui', 'hud', 'toasts', 'prompt', 'compass']);

const PREVENT = new Set([
  'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab',
  'KeyE', 'KeyQ', 'KeyF', 'Digit1', 'Digit2', 'Digit3',
]);

export const input = new InputSystem();
