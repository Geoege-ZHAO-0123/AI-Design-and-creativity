// Long Rally: the page.
// It opens with the reveal (intro.js), then each chapter of the scrolling story switches
// rules on in the simulation (rally.js) and moves the camera, so scrolling down rebuilds
// the pattern one rule at a time. The last chapter is a sandbox.

(() => {
  const R = window.rally, I = window.rallyIntro;
  if (R.teaser) return; // the teaser recorder drives the simulation itself
  const P = R.P;

  const NONE = { chase: false, open: false, recover: false, imperfect: false };
  const ALL = { chase: true, open: true, recover: true, imperfect: true };
  const portrait = () => innerWidth < innerHeight;
  const O = [0, 0, 1];
  const VIEWS = {
    wide: () => ({ ...I.wide(), target: O, shift: 0 }),
    broadcast: () => portrait() ? { yaw: 0.12, pitch: 0.7, dist: 62, target: O, shift: 0, rise: 0.02 } : { yaw: 0.3, pitch: 0.62, dist: 72, target: O, shift: 0, rise: -0.02 },
    side: () => portrait() ? { yaw: 0.4, pitch: 0.55, dist: 62, target: O, shift: 0, rise: 0 } : { yaw: 1.15, pitch: 0.42, dist: 62, target: O, shift: 0, rise: 0 },
    game: () => portrait() ? { yaw: 0, pitch: 0.5, dist: 31, target: [0, -4, 0], shift: 0, rise: 0.16 } : { yaw: 0, pitch: 0.46, dist: 52, target: [0, -3, 0], shift: 0, rise: 0.05 },
    play: () => portrait() ? { ...I.wide(), target: O, shift: 0, rise: 0 } : { ...I.wide(), target: O, shift: 0.2, rise: 0 },
  };

  // sandbox state, kept separately so scrolling through the story doesn't overwrite it
  const sandbox = { rules: { ...ALL }, aggression: 0.5, error: 0.5, runSpeed: 4.5, matches: 1, timeScale: 1.5 };

  // warm: simulated seconds to fast-forward on entering, so the pattern is already forming
  const CHAPTERS = {
    hero:     { rules: ALL, matches: 12, timeScale: 2, view: 'wide', warm: 150 },
    serve:    { rules: NONE, matches: 1, timeScale: 1.5, view: 'broadcast', warm: 12 },
    rule1:    { rules: { ...NONE, chase: true }, matches: 1, timeScale: 1.8, view: 'broadcast', warm: 60 },
    rule2:    { rules: { ...NONE, chase: true, open: true }, matches: 1, timeScale: 1.8, view: 'broadcast', warm: 90 },
    rule3:    { rules: { ...ALL, imperfect: false }, matches: 1, timeScale: 1.8, view: 'broadcast', warm: 90 },
    rule4:    { rules: ALL, matches: 1, timeScale: 1.8, view: 'broadcast', warm: 120 },
    exposure: { rules: ALL, matches: 16, timeScale: 3, view: 'side', warm: 40 },
    play:     { sandbox: true, view: 'play' },
    game:     { game: true, view: 'game' },
  };
  const DEFAULTS = { aggression: 0.5, error: 0.5, runSpeed: 4.5, comet: 0.2, courtAlpha: 0.8 };

  let current = null;
  let intro = null; // { t } while the opening sequence plays

  function warm(seconds) {
    const keep = P.timeScale;
    P.timeScale = 1;
    for (let t = 0; t < seconds; t += 0.25) R.advance(0.25);
    P.timeScale = keep;
  }

  function enter(name) {
    if (name === current || !CHAPTERS[name]) return;
    current = name;
    document.body.dataset.chapter = name;
    if (intro && name !== 'hero') endIntro(false);
    if (intro) return;
    const c = CHAPTERS[name];
    if (!c.game) { R.stopGame(); hideResult(); }
    if (c.game) {
      // the game runs in slight slow motion, and the computer is a touch slower than in the story
      Object.assign(P.rules, ALL);
      Object.assign(P, DEFAULTS, { timeScale: 0.7, runSpeed: 4.2 });
      R.stopGame();
      R.setMatches(0);
      R.clearTrails();
      showStart();
    } else if (c.sandbox) {
      Object.assign(P.rules, sandbox.rules);
      for (const k of ['aggression', 'error', 'runSpeed', 'timeScale']) P[k] = sandbox[k];
      R.setMatches(sandbox.matches);
    } else {
      Object.assign(P.rules, c.rules);
      Object.assign(P, DEFAULTS, { timeScale: c.timeScale });
      R.setMatches(0);
      R.setMatches(c.matches);
      // each story chapter starts from a clean court, so its own pattern can form
      R.clearTrails();
      if (c.warm) warm(c.warm);
    }
    R.setCourtAlpha(DEFAULTS.courtAlpha);
    moveCamera(VIEWS[c.view]());
    paintChips();
  }

  function paintChips() {
    for (const li of document.querySelectorAll('.rulechips li')) {
      li.classList.toggle('on', !!P.rules[li.dataset.rule]);
    }
  }

  // ---------- the opening reveal ----------
  const heroBits = document.querySelectorAll('.hero .reveal');
  function startIntro() {
    I.start(R);
    intro = { t: 0 };
  }
  function endIntro(showTitle) {
    intro = null;
    document.body.classList.remove('intro');
    heroBits.forEach(el => el.classList.add('in'));
    P.comet = DEFAULTS.comet;
    if (showTitle) P.timeScale = 2;
  }

  // ---------- smooth camera moves between chapters ----------
  let tween = null;
  function moveCamera(to) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // redrawing a very full court every frame is heavy, so jump instead
    if (reduce || R.arcCount > 6000) { R.setView(to); return; }
    tween = { from: R.view, to, t0: performance.now(), dur: 1400 };
  }
  function stepTween(now) {
    if (!tween) return;
    const k = Math.min(1, (now - tween.t0) / tween.dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    const { from, to } = tween;
    const l = key => from[key] + (to[key] - from[key]) * e;
    R.setView({
      yaw: l('yaw'), pitch: l('pitch'), shift: l('shift'), rise: l('rise'),
      dist: from.dist * Math.pow(to.dist / from.dist, e),
      target: from.target.map((v, i) => v + (to.target[i] - v) * e),
    });
    if (k >= 1) tween = null;
  }

  // which chapter is in the middle of the screen
  const middle = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) enter(e.target.dataset.chapter);
  }, { rootMargin: '-45% 0px -45% 0px' });
  document.querySelectorAll('[data-chapter]').forEach(s => middle.observe(s));

  new IntersectionObserver(([e]) => {
    if (e.isIntersecting) document.body.dataset.chapter = 'credits';
    else if (current) document.body.dataset.chapter = current;
  }, { threshold: 0.35 }).observe(document.getElementById('credits'));

  // text fades up as it arrives (the hero title waits for the reveal instead)
  const reveal = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); reveal.unobserve(e.target); }
  }, { threshold: 0.2 });
  document.querySelectorAll('.reveal').forEach(el => { if (!el.closest('.hero')) reveal.observe(el); });

  // live counters in the long-exposure chapter
  const fmt = n => n.toLocaleString('en-US');
  const statEls = ['shots', 'rallies', 'longest'].map(k => [k, document.getElementById('stat-' + k)]);
  setInterval(() => {
    if (current !== 'exposure') return;
    for (const [k, el] of statEls) el.textContent = fmt(R.stats[k]);
  }, 200);

  // ---------- sandbox controls ----------
  function bindSlider(id, fmtv, apply) {
    const el = document.getElementById(id), out = document.getElementById('v-' + id);
    el.value = sandbox[id];
    const show = () => { out.textContent = fmtv(sandbox[id]); };
    el.addEventListener('input', () => {
      sandbox[id] = Number(el.value);
      if (current === 'play') apply(sandbox[id]);
      show();
    });
    show();
  }
  const setP = k => v => { P[k] = v; };
  bindSlider('aggression', v => Math.round(v * 100) + '%', setP('aggression'));
  bindSlider('error', v => Math.round(v * 100) + '%', setP('error'));
  bindSlider('runSpeed', v => v.toFixed(2).replace(/0$/, '') + ' m/s', setP('runSpeed'));
  bindSlider('matches', v => String(v), v => R.setMatches(v));
  bindSlider('timeScale', v => v + '×', setP('timeScale'));

  for (const k of Object.keys(ALL)) {
    const el = document.getElementById('r-' + k);
    el.addEventListener('change', () => {
      sandbox.rules[k] = el.checked;
      if (current === 'play') { P.rules[k] = el.checked; paintChips(); }
    });
  }
  document.getElementById('clear').addEventListener('click', () => R.clearTrails());
  document.getElementById('view').addEventListener('click', () => moveCamera(VIEWS.play()));
  document.getElementById('replay').addEventListener('click', () => {
    scrollTo({ top: 0, behavior: 'instant' });
    current = 'hero';
    document.body.dataset.chapter = 'hero';
    document.body.classList.add('intro');
    heroBits.forEach(el => el.classList.remove('in'));
    startIntro();
  });

  R.bindOrbit(document.getElementById('court'), () => current === 'play');

  // ---------- mini game controls ----------
  const KEYS = { ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0], ArrowUp: [0, 1], w: [0, 1], ArrowDown: [0, -1], s: [0, -1] };
  const held = new Set();
  const steer = () => {
    let x = 0, y = 0;
    for (const k of held) { x += KEYS[k][0]; y += KEYS[k][1]; }
    R.game.move = [Math.sign(x), Math.sign(y)];
  };
  addEventListener('keydown', e => {
    if (current !== 'game' || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (KEYS[k]) { held.add(k); steer(); }
    else if (k === 'Escape' && !over.hidden) exitGame();
    else if (k === ' ' || k === 'Enter') { if (!over.hidden) newGame(); else if (R.game.on) R.game.serveQueued = true; }
    else return;
    e.preventDefault();
  });
  addEventListener('keyup', e => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (held.delete(k)) steer();
  });
  addEventListener('blur', () => { held.clear(); steer(); });
  const court = document.getElementById('court');
  court.addEventListener('pointermove', e => {
    if (current === 'game' && (e.pointerType === 'mouse' || e.buttons)) R.gameAim(e.clientX, e.clientY);
  });
  court.addEventListener('pointerdown', e => {
    if (current !== 'game' || !over.hidden || !R.game.on) return;
    R.gameAim(e.clientX, e.clientY);
    R.game.serveQueued = true;
  });

  const gEl = id => document.getElementById(id);
  // a point is a game: whoever puts the ball out, into the net, or can't reach it, loses
  const over = gEl('g-over');
  const WHY = {
    win: { out: 'The computer hit it out.', net: 'The computer hit the net.', double: 'The computer double-faulted.', missed: 'The computer couldn’t reach your shot.' },
    lose: { out: 'Your shot went out.', net: 'Your shot hit the net.', double: 'Double fault.', missed: 'You missed the ball.' },
  };
  let shown = null;
  // before the first point: how to play, and a Start button
  function showStart() {
    shown = null;
    over.classList.remove('win');
    gEl('g-result').textContent = 'Ready to play?';
    gEl('g-why').textContent = '';
    gEl('g-how').hidden = false;
    gEl('g-new').textContent = 'Start game';
    over.hidden = false;
  }
  function showResult(last) {
    shown = last;
    const win = last.winner === 0;
    over.classList.toggle('win', win);
    gEl('g-result').textContent = win ? 'You win' : 'You lose';
    gEl('g-why').textContent = WHY[win ? 'win' : 'lose'][last.why] + (last.rally > 1 ? ` That rally lasted ${last.rally} shots.` : '');
    gEl('g-how').hidden = true;
    gEl('g-new').textContent = 'New game';
    over.hidden = false;
    gEl('g-new').focus({ preventScroll: true });
  }
  function hideResult() { over.hidden = true; }
  function newGame() {
    hideResult();
    if (R.game.on) R.nextPoint(); else R.startGame();
  }
  function exitGame() {
    hideResult();
    R.stopGame();
    scrollTo({ top: 0, behavior: 'instant' });
  }
  gEl('g-new').addEventListener('click', newGame);
  gEl('g-exit').addEventListener('click', exitGame);
  const serveBtn = gEl('g-serve');
  serveBtn.addEventListener('click', () => { R.game.serveQueued = true; });
  const hud = { rally: gEl('g-rally'), best: gEl('g-best'), you: gEl('g-you'), cpu: gEl('g-cpu'), msg: gEl('g-msg') };
  setInterval(() => {
    document.body.classList.toggle('playing', current === 'game' && R.game.on);
    if (current !== 'game' || !R.game.on) { serveBtn.hidden = true; return; }
    const m = R.matches[0], g = R.game;
    serveBtn.hidden = !(m && m.state === 'serve');
    hud.rally.textContent = m ? m.rallyLen : 0;
    hud.best.textContent = g.best;
    hud.you.textContent = g.score[0];
    hud.cpu.textContent = g.score[1];
    if (m && m.state === 'over' && g.last && g.last !== shown) showResult(g.last);
    let msg = '';
    if (g.fault && performance.now() - g.fault < 1400) msg = 'Fault. Second serve.';
    else if (m && m.state === 'serve') msg = m.secondServe ? 'Second serve' : 'Your serve';
    if (hud.msg.textContent !== msg) hud.msg.textContent = msg;
  }, 100);
  addEventListener('resize', () => { if (current && !intro) R.setView(VIEWS[CHAPTERS[current].view]()); });

  // ---------- run ----------
  current = 'hero';
  document.body.dataset.chapter = 'hero';
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // no fly-through: open straight on the finished picture
    Object.assign(P.rules, ALL);
    R.setMatches(CHAPTERS.hero.matches);
    R.setView(VIEWS.wide());
    warm(CHAPTERS.hero.warm);
    endIntro(true);
  } else {
    document.body.classList.add('intro');
    startIntro();
  }

  let last = performance.now();
  const loop = now => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (intro) {
      intro.t += dt;
      I.frame(R, intro.t, dt);
      if (intro.t >= I.T.title) heroBits.forEach((el, i) => { if (intro.t >= I.T.title + i * 0.35) el.classList.add('in'); });
      if (intro.t >= I.T.end) endIntro(true);
    } else {
      stepTween(now);
      // the finished picture keeps turning slowly, like a product on a stand
      if (current === 'hero' && !tween && R.gpu) R.setView({ yaw: R.view.yaw + dt * 0.035 });
    }
    R.advance(dt);
    R.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})();
