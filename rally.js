// Long Rally: the simulation engine.
// Two unseen players follow four simple rules. Every shot leaves its arc on the court,
// like a long-exposure photograph, and over thousands of shots the arcs weave a
// pattern nobody planned. The engine exposes itself as window.rally.
//
// Units are meters and seconds. x runs across the court, y along it (the net is
// at y = 0), z is height. Player 0 plays the near half (y < 0), player 1 the far half.

(() => {
  const params = new URLSearchParams(location.search);
  const TEASER = params.has('teaser');

  // ---------- seeded random ----------
  let seed = Number(params.get('seed')) || Math.floor(Math.random() * 1e9);
  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  let rand = mulberry32(seed);
  const gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------- the court (ITF dimensions) ----------
  const HALF_W = 4.115;     // singles sideline
  const DBL_W = 5.485;      // doubles sideline (drawn, not used)
  const HALF_L = 11.885;    // baseline
  const SERVICE = 6.40;     // service line
  const NET_H = 0.914;
  const G = 9.81;

  // ---------- parameters ----------
  const P = {
    matches: 1,         // matches played on top of each other on the same court
    timeScale: 1,       // simulated seconds per real second
    aggression: 0.5,    // 0 = play safe down the middle, 1 = aim at the lines
    error: 0.5,         // how much every shot misses its aim (rule 4)
    runSpeed: 4.5,      // m/s
    reach: 1.2,         // m, how far a player can stretch with the racket
    reaction: 0.3,      // s before a player starts running after the opponent hits
    courtAlpha: 1,      // the court is only a faint reference; the ball's path is the subject
    comet: 0.45,        // seconds of recent flight drawn as a bright tail behind each ball
    rules: { chase: true, open: true, recover: true, imperfect: true },
  };

  // ---------- canvases ----------
  const courtCv = document.getElementById('court');
  const trailCv = document.getElementById('trails');
  const liveCv = document.getElementById('live');
  const cctx = courtCv.getContext('2d');
  // the long exposure is drawn with WebGL when it can be (thousands of arcs redrawn every
  // frame while the camera moves); plain canvas 2D is the fallback
  const gl = TEASER && params.has('no-gl') ? null : trailCv.getContext('webgl', { antialias: true, preserveDrawingBuffer: true });
  const tctx = gl ? null : trailCv.getContext('2d');
  const lctx = liveCv.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  let areaK = 1; // small screens pack the same arcs into fewer pixels, so each one is fainter

  // ---------- camera: perspective, orbiting a target point ----------
  // yaw 0 looks up the court from behind the near baseline; pitch is the angle above the ground.
  const cam = { yaw: 0.6, pitch: 0.5, dist: 62, target: [0, 0, 1], shift: 0, rise: 0, zoom: 1, focal: 1, ox: 0, oy: 0, basis: null, pos: null };

  function setupCamera() {
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch), [tx, ty, tz] = cam.target;
    const pos = [tx + Math.sin(cam.yaw) * cam.dist * cp, ty - Math.cos(cam.yaw) * cam.dist * cp, tz + cam.dist * sp];
    const f = norm([tx - pos[0], ty - pos[1], tz - pos[2]]);
    const r = norm(cross(f, [0, 0, 1]));
    const u = cross(r, f);
    cam.pos = pos; cam.basis = [r, u, f];
    // at the default distance the whole court fills most of the screen (on a phone, its width)
    cam.focal = cam.zoom * 2.35 * (W < H ? W * 0.95 : Math.min(W * 0.62, H));
    cam.ox = W * (0.5 + cam.shift);
    cam.oy = H * ((W < 700 ? 0.44 : 0.52) + cam.rise);
  }
  function rawProject(x, y, z) {
    const d = [x - cam.pos[0], y - cam.pos[1], z - cam.pos[2]];
    const [r, u, f] = cam.basis;
    const zc = dot(d, f);
    return [dot(d, r) / zc, -dot(d, u) / zc, zc];
  }
  function project(x, y, z) {
    const p = rawProject(x, y, z);
    return [cam.ox + cam.focal * p[0], cam.oy + cam.focal * p[1], p[2]];
  }
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => { const m = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / m, a[1] / m, a[2] / m]; };

  function resize() {
    if (TEASER) {
      W = Number(params.get('w')) || 1280; H = Number(params.get('h')) || 720; dpr = 1;
      for (const c of [courtCv, trailCv, liveCv]) { c.style.width = W + 'px'; c.style.height = H + 'px'; }
    } else {
      W = innerWidth; H = innerHeight; dpr = Math.min(devicePixelRatio || 1, 2);
    }
    for (const c of [courtCv, trailCv, liveCv]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    areaK = clamp(Math.sqrt(W * H / 1.3e6), 0.55, 1);
    for (const g of [cctx, tctx, lctx]) if (g) g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (gl) gl.viewport(0, 0, trailCv.width, trailCv.height);
    setupCamera();
    drawCourt();
    redrawTrails();
  }

  // ---------- court drawing ----------
  function poly(g, pts) {
    g.beginPath();
    pts.forEach(([x, y, z], i) => { const p = project(x, y, z); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); });
    g.closePath();
  }
  function seg(g, a, b) {
    const p = project(...a), q = project(...b);
    g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]);
  }

  function drawCourt() {
    const g = cctx;
    g.clearRect(0, 0, W, H);
    if (P.courtAlpha <= 0.01) return;
    g.globalAlpha = P.courtAlpha;
    poly(g, [[-DBL_W, -HALF_L, 0], [DBL_W, -HALF_L, 0], [DBL_W, HALF_L, 0], [-DBL_W, HALF_L, 0]]);
    g.fillStyle = 'rgba(120,150,200,0.045)'; g.fill();

    g.strokeStyle = 'rgba(220,230,250,0.28)';
    g.lineWidth = 1;
    g.beginPath();
    for (const s of [-1, 1]) {
      seg(g, [-DBL_W, s * HALF_L, 0], [DBL_W, s * HALF_L, 0]);          // baselines
      seg(g, [s * DBL_W, -HALF_L, 0], [s * DBL_W, HALF_L, 0]);          // doubles sidelines
      seg(g, [s * HALF_W, -HALF_L, 0], [s * HALF_W, HALF_L, 0]);        // singles sidelines
      seg(g, [-HALF_W, s * SERVICE, 0], [HALF_W, s * SERVICE, 0]);      // service lines
      seg(g, [0, s * HALF_L, 0], [0, s * (HALF_L - 0.3), 0]);           // center marks
    }
    seg(g, [0, -SERVICE, 0], [0, SERVICE, 0]);                           // center service line
    g.stroke();

    // net: a thin band of light
    poly(g, [[-DBL_W - 0.9, 0, 0], [DBL_W + 0.9, 0, 0], [DBL_W + 0.9, 0, 1.07], [0, 0, NET_H], [-DBL_W - 0.9, 0, 1.07]]);
    g.fillStyle = 'rgba(200,215,240,0.05)'; g.fill();
    g.strokeStyle = 'rgba(240,245,255,0.45)';
    g.beginPath();
    seg(g, [-DBL_W - 0.9, 0, 1.07], [0, 0, NET_H]);
    seg(g, [0, 0, NET_H], [DBL_W + 0.9, 0, 1.07]);
    for (const s of [-1, 1]) seg(g, [s * (DBL_W + 0.9), 0, 0], [s * (DBL_W + 0.9), 0, 1.07]);
    g.stroke();
    g.globalAlpha = 1;
  }

  // ---------- the long exposure: every arc ever flown, kept in world space ----------
  const COLORS = [
    [214, 255, 58],   // near player: optic yellow
    [110, 200, 255],  // far player: cool blue
    [255, 255, 255],  // serve
    [255, 90, 80],    // fault: out or into the net
  ];
  const arcs = [];          // {pts: Float32Array xyz..., c}
  const marks = [];         // bounce marks [x, y, c]
  const MAX_ARCS = 30000;
  let exposure = 0.4;       // alpha of a single arc; fades as arcs pile up, like a longer exposure
  const exposureFor = n => clamp(3.2 / Math.sqrt(n + 16), 0.035, 0.45);

  function drawArc(g, a) {
    const [r, gg, b] = COLORS[a.c];
    g.strokeStyle = `rgba(${r},${gg},${b},${(a.c === 3 ? 1.5 : 1) * exposure * areaK})`;
    g.beginPath();
    const p = a.pts;
    for (let i = 0; i < p.length; i += 3) {
      const q = project(p[i], p[i + 1], p[i + 2]);
      i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]);
    }
    g.stroke();
  }
  function drawMark(g, m) {
    const [r, gg, b] = COLORS[m[2]];
    const q = project(m[0], m[1], 0);
    g.fillStyle = `rgba(${r},${gg},${b},${m[2] === 3 ? 0.5 : 0.22})`;
    g.fillRect(q[0] - 1, q[1] - 0.6, 2, 1.2);
  }

  function commitArc(pts, c) {
    const a = { pts, c };
    arcs.push(a);
    if (arcs.length > MAX_ARCS) { arcs.splice(0, MAX_ARCS / 10); rebuildGL(); }
    else if (gl) appendArcGL(a);
    const want = exposureFor(arcs.length);
    if (want < exposure * 0.7) { exposure = want; redrawTrails(); return; }
    if (gl) { trailsDirty = true; return; }
    tctx.globalCompositeOperation = 'lighter';
    tctx.lineWidth = 1;
    drawArc(tctx, a);
    tctx.globalCompositeOperation = 'source-over';
  }
  function commitMark(x, y, c) {
    const m = [x, y, c];
    marks.push(m);
    if (marks.length > MAX_ARCS) { marks.splice(0, MAX_ARCS / 10); rebuildGL(); }
    else if (gl) appendMarkGL(m);
    if (gl) { trailsDirty = true; return; }
    tctx.globalCompositeOperation = 'lighter';
    drawMark(tctx, m);
    tctx.globalCompositeOperation = 'source-over';
  }
  function redrawTrails() {
    if (gl) { trailsDirty = true; return; }
    tctx.clearRect(0, 0, W, H);
    tctx.globalCompositeOperation = 'lighter';
    tctx.lineWidth = 1;
    for (const a of arcs) drawArc(tctx, a);
    for (const m of marks) drawMark(tctx, m);
    tctx.globalCompositeOperation = 'source-over';
  }

  // ---------- the same exposure on the GPU ----------
  // Every arc becomes line segments in one vertex buffer, projected by the same camera
  // and added together with additive blending, exactly like the 2D 'lighter' mode.
  let trailsDirty = true;
  const glState = gl && setupGL();
  function setupGL() {
    const vs = `
      attribute vec3 pos; attribute vec4 col;
      uniform vec3 camPos, camR, camU, camF;
      uniform vec4 screen; // focal / W, focal / H, 2 ox / W - 1, 1 - 2 oy / H
      uniform float pointSize;
      varying vec4 v;
      void main() {
        vec3 d = pos - camPos;
        float zc = dot(d, camF);
        gl_Position = vec4(screen.z * zc + 2.0 * screen.x * dot(d, camR),
                           screen.w * zc + 2.0 * screen.y * dot(d, camU),
                           zc - 0.1, zc);
        gl_PointSize = pointSize;
        v = col;
      }`;
    const fs = `
      precision mediump float;
      uniform float alpha;
      varying vec4 v;
      void main() { gl_FragColor = vec4(v.rgb, min(1.0, v.a * alpha)); }`;
    const sh = (type, src) => { const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); return o; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const u = {};
    for (const k of ['camPos', 'camR', 'camU', 'camF', 'screen', 'pointSize', 'alpha']) u[k] = gl.getUniformLocation(prog, k);
    const at = { pos: gl.getAttribLocation(prog, 'pos'), col: gl.getAttribLocation(prog, 'col') };
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE);
    gl.clearColor(0, 0, 0, 0);
    // 7 floats per vertex: x y z r g b a
    const mk = () => ({ buf: gl.createBuffer(), data: new Float32Array(7 * 4096), n: 0, gpuCap: 0, sent: 0 });
    return { prog, u, at, lines: mk(), points: mk() };
  }
  function pushVerts(b, verts) {
    if (b.n * 7 + verts.length > b.data.length) {
      let cap = b.data.length;
      while (b.n * 7 + verts.length > cap) cap *= 2;
      const d = new Float32Array(cap); d.set(b.data.subarray(0, b.n * 7)); b.data = d;
    }
    b.data.set(verts, b.n * 7);
    b.n += verts.length / 7;
  }
  function arcVerts(a) {
    const [r, g, bl] = COLORS[a.c], k = a.c === 3 ? 1.5 : 1, p = a.pts, out = [];
    for (let i = 3; i < p.length; i += 3) {
      out.push(p[i - 3], p[i - 2], p[i - 1], r / 255, g / 255, bl / 255, k,
        p[i], p[i + 1], p[i + 2], r / 255, g / 255, bl / 255, k);
    }
    return out;
  }
  function markVerts(m) {
    const [r, g, bl] = COLORS[m[2]];
    return [m[0], m[1], 0.01, r / 255, g / 255, bl / 255, m[2] === 3 ? 0.5 : 0.22];
  }
  function appendArcGL(a) { pushVerts(glState.lines, arcVerts(a)); }
  function appendMarkGL(m) { pushVerts(glState.points, markVerts(m)); }
  function rebuildGL() {
    if (!gl) return;
    for (const b of [glState.lines, glState.points]) { b.n = 0; b.sent = 0; }
    for (const a of arcs) appendArcGL(a);
    for (const m of marks) appendMarkGL(m);
    trailsDirty = true;
  }
  function uploadGL(b) {
    gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
    if (b.gpuCap < b.data.length) {
      gl.bufferData(gl.ARRAY_BUFFER, b.data, gl.DYNAMIC_DRAW);
      b.gpuCap = b.data.length; b.sent = b.n;
    } else if (b.sent !== b.n) {
      if (b.sent > b.n) b.sent = 0;
      gl.bufferSubData(gl.ARRAY_BUFFER, b.sent * 28, b.data.subarray(b.sent * 7, b.n * 7));
      b.sent = b.n;
    }
    gl.vertexAttribPointer(glState.at.pos, 3, gl.FLOAT, false, 28, 0);
    gl.vertexAttribPointer(glState.at.col, 4, gl.FLOAT, false, 28, 12);
    gl.enableVertexAttribArray(glState.at.pos);
    gl.enableVertexAttribArray(glState.at.col);
  }
  function drawTrailsGL() {
    if (!trailsDirty) return;
    trailsDirty = false;
    const { u } = glState, [r, up, f] = cam.basis;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform3fv(u.camPos, cam.pos); gl.uniform3fv(u.camR, r); gl.uniform3fv(u.camU, up); gl.uniform3fv(u.camF, f);
    gl.uniform4f(u.screen, cam.focal / W, cam.focal / H, 2 * cam.ox / W - 1, 1 - 2 * cam.oy / H);
    // lines are one device pixel wide in WebGL; brighten them on dense screens to match
    gl.uniform1f(u.alpha, exposure * areaK * Math.max(1, dpr * 0.8));
    gl.uniform1f(u.pointSize, 2 * dpr);
    if (glState.lines.n) { uploadGL(glState.lines); gl.drawArrays(gl.LINES, 0, glState.lines.n); }
    gl.uniform1f(u.alpha, 1);
    if (glState.points.n) { uploadGL(glState.points); gl.drawArrays(gl.POINTS, 0, glState.points.n); }
  }

  function clearTrails() {
    arcs.length = 0; marks.length = 0;
    exposure = exposureFor(0);
    if (gl) rebuildGL(); else tctx.clearRect(0, 0, W, H);
    stats.shots = 0; stats.rallies = 0; stats.longest = 0;
  }

  // ---------- ball flight ----------
  // A shot flies from the hit point to a bounce, then carries on toward the receiver.
  function makeShot(from, target, speed, hitter, isServe) {
    const [hx, hy, hz] = from;
    let [bx, by] = target;
    const dist = Math.hypot(bx - hx, by - hy);
    let T = dist / speed;
    let vz = (-hz + 0.5 * G * T * T) / T;
    // clear the net with some margin: if too flat, loft it (slower flight, same target)
    const clearance = isServe ? NET_H + 0.12 : NET_H + 0.35;
    const netFrac = hy / (hy - by); // fraction of the flight at which the ball crosses the net
    if (netFrac > 0 && netFrac < 1) {
      for (let k = 0; k < 30; k++) {
        const tn = netFrac * T;
        if (hz + vz * tn - 0.5 * G * tn * tn >= clearance) break;
        T *= 1.06;
        vz = (-hz + 0.5 * G * T * T) / T;
      }
    }
    const vxs = (bx - hx) / T, vys = (by - hy) / T;
    const tnet = (0 - hy) / vys;
    const znet = hz + vz * tnet - 0.5 * G * tnet * tnet;
    // after the bounce the ball keeps 60% of its pace and pops up
    const vzLand = vz - G * T;
    const vz2 = -0.72 * vzLand;
    return {
      hx, hy, hz, vx: vxs, vy: vys, vz, T, bx, by,
      vx2: vxs * 0.6, vy2: vys * 0.6, vz2,
      tApex: vz2 / G, t2: 2 * vz2 / G,
      netT: znet < NET_H ? tnet : null,
      hitter, isServe, t: 0, bounced: false, fault: false,
    };
  }

  function ballPos(s, t) {
    if (s.netT !== null && t >= s.netT) {
      const tt = s.netT;
      return [s.hx + s.vx * tt, s.hy + s.vy * tt - Math.sign(s.vy) * 0.05, Math.max(0, s.hz + s.vz * tt - 0.5 * G * tt * tt - (t - tt) * 2)];
    }
    if (t < s.T) return [s.hx + s.vx * t, s.hy + s.vy * t, s.hz + s.vz * t - 0.5 * G * t * t];
    const u = t - s.T;
    return [s.bx + s.vx2 * u, s.by + s.vy2 * u, Math.max(0, s.vz2 * u - 0.5 * G * u * u)];
  }

  // where the receiver will meet the ball: on the rise, just before the top of its bounce
  function interceptTime(s) { return s.T + s.tApex * 0.8; }

  function sampleArc(s, t0, t1, n) {
    const pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const p = ballPos(s, t0 + (t1 - t0) * i / (n - 1));
      pts[i * 3] = p[0]; pts[i * 3 + 1] = p[1]; pts[i * 3 + 2] = p[2];
    }
    return pts;
  }

  // ---------- players and matches ----------
  const stats = { shots: 0, rallies: 0, longest: 0 };

  // the mini game: a person plays the near side (player 0) of a single match,
  // the computer plays the far side with the same four rules
  const HUMAN = 0;
  const game = {
    on: false, score: [0, 0], best: 0, last: null,
    serveQueued: false,   // the person asked to serve
    move: [0, 0],         // keyboard direction, -1..1 on each axis
    speed: 9,             // m/s, quicker than the computer
    reach: 1.9,           // m: the ring; cover the bounce with it to return the ball
  };
  const isHuman = i => game.on && i === HUMAN;
  const reachOf = i => isHuman(i) ? game.reach : P.reach;
  let matches = [];

  function newMatch() {
    const m = {
      players: [0, 1].map(i => ({ side: i ? 1 : -1, x: 0, y: (i ? 1 : -1) * (HALF_L + 1), tx: 0, ty: (i ? 1 : -1) * (HALF_L + 1), ran: 0, delay: 0 })),
      shot: null, server: rand() < 0.5 ? 0 : 1, point: 0, secondServe: false,
      state: 'wait', wait: 0.4 + rand() * 1.2, rallyLen: 0,
    };
    return m;
  }

  function setMatches(n) {
    while (matches.length < n) matches.push(newMatch());
    if (matches.length > n) matches.length = n;
  }

  function startPoint(m) {
    const srv = m.players[m.server], ret = m.players[1 - m.server];
    const deuce = m.point % 2 === 0 ? 1 : -1;     // alternate serving from the right and left
    const sx = deuce * 0.8 * -srv.side;
    srv.x = sx; srv.y = srv.side * (HALF_L + 0.3); srv.tx = srv.x; srv.ty = srv.y;
    ret.x = -sx * 2.6; ret.y = ret.side * (HALF_L + 0.8); ret.tx = ret.x; ret.ty = ret.y;
    m.rallyLen = 0;
    if (isHuman(m.server)) { m.state = 'serve'; return; }
    serve(m);
  }

  function serve(m) {
    const srv = m.players[m.server], ret = m.players[1 - m.server];
    // aim into the diagonal service box
    const boxSide = -Math.sign(srv.x) || 1;
    let tx = boxSide * (0.6 + rand() * 3.0);
    let ty = ret.side * (SERVICE - 1.2 - rand() * 2.2);
    const sigma = P.rules.imperfect ? 0.25 + 0.9 * P.error : 0;
    tx += gauss() * sigma; ty += gauss() * sigma;
    // in the game, serves are slower so a person can return them
    const speed = game.on ? 27 : m.secondServe ? 30 : 40 + P.aggression * 8;
    m.shot = makeShot([srv.x, srv.y, 2.75], [tx, ty], speed, m.server, true);
    const inBox = Math.abs(tx) <= HALF_W && Math.sign(tx) === boxSide && Math.abs(ty) <= SERVICE && Math.sign(ty) === ret.side;
    m.shot.fault = !inBox || m.shot.netT !== null;
    m.state = 'flight';
    receiverReacts(m);
  }

  function receiverReacts(m) {
    const s = m.shot, rec = m.players[1 - s.hitter];
    if (isHuman(1 - s.hitter)) return;
    if (!P.rules.chase || s.fault) return;
    // Rule 1: run to where the ball will be, standing a little behind it
    const p = ballPos(s, interceptTime(s));
    rec.tx = clamp(p[0], -DBL_W - 2, DBL_W + 2);
    rec.ty = p[1] + rec.side * 0.35;
    rec.delay = P.reaction;
  }

  function hit(m) {
    const s = m.shot, me = m.players[1 - s.hitter], opp = m.players[s.hitter];
    const t = interceptTime(s);
    const from = ballPos(s, t);
    commitArc(sampleArc(s, s.T, t, 8), s.isServe ? 2 : s.hitter);
    m.rallyLen++;
    stats.shots++;

    if (isHuman(1 - s.hitter)) return humanHit(m, s, me, from);

    // Rule 2: aim where the opponent isn't; without it, hit it back to them
    const margin = 0.5 + (1 - P.aggression) * 1.9;
    let tx;
    if (P.rules.open) {
      tx = -Math.sign(opp.x || (rand() - 0.5)) * (HALF_W - margin);
    } else {
      tx = clamp(opp.x, -HALF_W + 0.5, HALF_W - 0.5);
    }
    let ty = opp.side * (HALF_L - 1.4 - (1 - P.aggression) * 1.6);

    // Rule 4: nobody is perfect, and a stretched player is less precise
    const stretch = clamp(Math.hypot(from[0] - me.x, from[1] - me.y) / P.reach, 0, 1) * 0.4 + clamp(me.ran / 9, 0, 1) * 0.6;
    const sigma = P.rules.imperfect ? (0.2 + 0.8 * P.error) * (0.5 + stretch) : 0;
    tx += gauss() * sigma;
    ty += gauss() * sigma * 1.3;
    const speed = (19 + 9 * P.aggression) * (1 - 0.25 * stretch);

    m.shot = makeShot([from[0], from[1], Math.max(0.5, from[2])], [tx, ty], speed, 1 - s.hitter, false);
    // in the game the computer also drives some balls into the net, more often when stretched
    if (game.on && P.rules.imperfect && rand() < 0.03 + 0.1 * stretch) {
      const sh = m.shot, tn = (0 - sh.hy) / sh.vy;
      sh.vz = (0.55 - sh.hz + 0.5 * G * tn * tn) / tn;
      sh.netT = tn;
    }
    const inside = Math.abs(tx) <= HALF_W && Math.abs(ty) <= HALF_L && Math.sign(ty) === opp.side;
    m.shot.fault = !inside || m.shot.netT !== null;
    me.ran = 0;

    // Rule 3: after hitting, head back to the middle of the baseline
    if (P.rules.recover) { me.tx = 0; me.ty = me.side * (HALF_L + 1.5); }
    else { me.tx = me.x; me.ty = me.y; }
    receiverReacts(m);
  }

  // the person's shot: like a paddle, a ball met on the right side of the racket goes right
  function humanHit(m, s, me, from) {
    const opp = m.players[s.hitter];
    const off = s.humanOff ?? clamp((from[0] - me.x) / game.reach, -1, 1);
    const tx = off * (HALF_W - 0.3) + gauss() * 0.25;
    const ty = opp.side * (HALF_L - 2.4) + gauss() * 0.6;
    // a sharp angle is also a harder hit, so going for the lines can win the point
    m.shot = makeShot([from[0], from[1], Math.max(0.5, from[2])], [tx, ty], 22 + 7 * Math.abs(off), 1 - s.hitter, false);
    m.shot.fault = !(Math.abs(tx) <= HALF_W && Math.abs(ty) <= HALF_L) || m.shot.netT !== null;
    me.ran = 0;
    receiverReacts(m);
  }

  // why: 'out', 'net', 'double' (double fault) or 'missed' (the ball bounced twice)
  function endPoint(m, winner, why) {
    if (game.on) {
      game.score[winner]++;
      game.best = Math.max(game.best, m.rallyLen);
      game.last = { winner, why, rally: m.rallyLen, t: performance.now() };
    }
    stats.rallies++;
    stats.longest = Math.max(stats.longest, m.rallyLen);
    m.point++;
    if (m.point % (game.on ? 2 : 4) === 0) m.server = 1 - m.server;
    m.secondServe = false;
    m.state = game.on ? 'over' : 'wait';   // in the game, wait for the person to play on
    m.wait = 0.9;
    m.shot = null;
  }

  function stepMatch(m, dt) {
    // players run toward their targets
    m.players.forEach((p, i) => {
      if (isHuman(i)) return moveHuman(m, p, dt);
      if (p.delay > 0) { p.delay -= dt; return; }
      const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
      const mv = Math.min(d, P.runSpeed * dt);
      if (d > 1e-3) { p.x += dx / d * mv; p.y += dy / d * mv; p.ran += mv; }
    });

    if (m.state === 'wait') {
      m.wait -= dt;
      if (m.wait <= 0) startPoint(m);
      return;
    }
    if (m.state === 'serve') {
      if (game.serveQueued) { game.serveQueued = false; serve(m); }
      return;
    }
    if (m.state === 'over') return;

    const s = m.shot;
    s.t += dt;

    // the person returns the ball once their ring has covered the spot where it is
    // played (just after the bounce) before the ball gets there; moving away afterwards
    // doesn't undo it
    if (isHuman(1 - s.hitter) && !s.fault && !s.humanOk && s.t < interceptTime(s)) {
      const me = m.players[1 - s.hitter], c = contactOf(s);
      if (Math.hypot(c[0] - me.x, c[1] - me.y) <= game.reach) {
        s.humanOk = true;
        s.humanOff = clamp((c[0] - me.x) / game.reach, -1, 1);
      }
    }

    if (!s.bounced && (s.t >= s.T || (s.netT !== null && s.t >= s.netT))) {
      s.bounced = true;
      if (s.netT !== null) {
        commitArc(sampleArc(s, 0, s.netT, 12), 3);
        return faultOrEnd(m, s);
      }
      commitArc(sampleArc(s, 0, s.T, 16), s.fault ? 3 : s.isServe ? 2 : s.hitter);
      commitMark(s.bx, s.by, s.fault ? 3 : s.isServe ? 2 : s.hitter);
      if (s.fault) return faultOrEnd(m, s);
    }

    if (s.bounced && !s.fault) {
      const ti = interceptTime(s);
      if (s.t >= ti && !s.checked) {
        s.checked = true;
        const rec = m.players[1 - s.hitter];
        const p = ballPos(s, ti);
        const reached = isHuman(1 - s.hitter) ? s.humanOk : Math.hypot(p[0] - rec.x, p[1] - rec.y) <= reachOf(1 - s.hitter);
        if (reached) return hit(m);
      }
      if (s.t >= s.T + s.t2) {
        // bounced twice: point over
        commitArc(sampleArc(s, s.T, s.T + s.t2, 8), s.isServe ? 2 : s.hitter);
        return endPoint(m, s.hitter, 'missed');
      }
    }
  }

  function faultOrEnd(m, s) {
    if (s.isServe && !m.secondServe && game.on) game.fault = performance.now();
    if (s.isServe && !m.secondServe && isHuman(s.hitter)) {
      m.secondServe = true; m.shot = null; m.state = 'serve';
      return;
    }
    if (s.isServe && !m.secondServe) {
      m.secondServe = true;
      m.state = 'wait';
      m.wait = 0.5;
      m.shot = null;
      // the next point start would reposition; serve again from the same spot instead
      m.pendingSecond = true;
      return;
    }
    endPoint(m, 1 - s.hitter, s.isServe ? 'double' : s.netT !== null ? 'net' : 'out');
  }

  function contactOf(s) { return s.contact || (s.contact = ballPos(s, interceptTime(s))); }

  function moveHuman(m, p, dt) {
    if (m.state === 'serve') { p.tx = p.x; p.ty = p.y; }
    else if (game.move[0] || game.move[1]) { p.tx = p.x + game.move[0] * 2; p.ty = p.y + game.move[1] * 2; }
    p.tx = clamp(p.tx, -DBL_W - 2.5, DBL_W + 2.5);
    p.ty = clamp(p.ty, -HALF_L - 4, -1.5);
    const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
    const mv = Math.min(d, game.speed * dt);
    if (d > 1e-3) { p.x += dx / d * mv; p.y += dy / d * mv; }
  }

  // point the person's target at the spot on the ground under the screen point
  function gameAim(sx, sy) {
    if (!game.on || !matches[0]) return;
    const [r, u, f] = cam.basis, a = (sx - cam.ox) / cam.focal, b = (sy - cam.oy) / cam.focal;
    const dir = [f[0] + r[0] * a - u[0] * b, f[1] + r[1] * a - u[1] * b, f[2] + r[2] * a - u[2] * b];
    if (dir[2] >= -1e-3) return;
    const t = -cam.pos[2] / dir[2];
    const p = matches[0].players[HUMAN];
    p.tx = cam.pos[0] + dir[0] * t;
    p.ty = cam.pos[1] + dir[1] * t;
  }
  // after a point, play the next one (the score carries on)
  function nextPoint() {
    const m = matches[0];
    if (!game.on || !m || m.state !== 'over') return;
    game.last = null; game.serveQueued = false;
    m.state = 'wait'; m.wait = 0.4;
  }
  function startGame() {
    game.on = true;
    game.score = [0, 0]; game.best = 0; game.last = null; game.fault = 0; game.serveQueued = false; game.move = [0, 0];
    matches = [];
    setMatches(1);
    matches[0].server = HUMAN;
    matches[0].wait = 0.3;
  }
  function stopGame() {
    if (!game.on) return;
    game.on = false;
    matches = [];
  }

  function step(dt) {
    for (const m of matches) {
      if (m.state === 'wait' && m.pendingSecond) {
        m.wait -= dt;
        if (m.wait <= 0) { m.pendingSecond = false; serve(m); }
        continue;
      }
      stepMatch(m, dt);
    }
  }

  // advance the simulation by dtReal seconds of wall-clock time
  function advance(dtReal) {
    const total = dtReal * P.timeScale;
    const n = Math.max(1, Math.ceil(total / (1 / 120)));
    for (let i = 0; i < n; i++) step(total / n);
  }

  // ---------- live layer ----------
  function render() {
    if (gl) drawTrailsGL();
    lctx.clearRect(0, 0, W, H);
    lctx.lineCap = 'round';
    for (const m of matches) {
      if (!m.shot) continue;
      const s = m.shot;
      // comet: the last moments of flight, brightest at the ball
      const n = 14, t0 = Math.max(0, s.t - P.comet);
      let prev = null;
      for (let i = 0; i <= n; i++) {
        const b = ballPos(s, t0 + (s.t - t0) * i / n);
        const q = project(b[0], b[1], b[2]);
        if (prev) {
          const k = i / n;
          lctx.strokeStyle = `rgba(236,255,140,${0.85 * k * k})`;
          lctx.lineWidth = clamp(cam.focal * 0.05 / q[2], 1, 5) * (0.4 + 0.6 * k);
          lctx.beginPath(); lctx.moveTo(prev[0], prev[1]); lctx.lineTo(q[0], q[1]); lctx.stroke();
        }
        prev = q;
      }
      const b = ballPos(s, s.t);
      const q = project(b[0], b[1], b[2]);
      const rad = clamp(cam.focal * 0.07 / q[2], 1.6, 14);
      const glow = lctx.createRadialGradient(q[0], q[1], 0, q[0], q[1], rad * 5);
      glow.addColorStop(0, 'rgba(230,255,120,0.9)');
      glow.addColorStop(1, 'rgba(230,255,120,0)');
      lctx.fillStyle = glow;
      lctx.beginPath(); lctx.arc(q[0], q[1], rad * 5, 0, Math.PI * 2); lctx.fill();
      lctx.fillStyle = '#f4ffc0';
      lctx.beginPath(); lctx.arc(q[0], q[1], rad, 0, Math.PI * 2); lctx.fill();
    }
    if (game.on) drawGame();
    drawCaption();
  }

  function ring(x, y, rad, color, width) {
    lctx.strokeStyle = color; lctx.lineWidth = width;
    lctx.beginPath();
    for (let i = 0; i <= 32; i++) {
      const a = i / 32 * Math.PI * 2, q = project(x + Math.cos(a) * rad, y + Math.sin(a) * rad, 0);
      i ? lctx.lineTo(q[0], q[1]) : lctx.moveTo(q[0], q[1]);
    }
    lctx.stroke();
  }
  function drawGame() {
    const m = matches[0];
    if (!m) return;
    const me = m.players[HUMAN], cpu = m.players[1 - HUMAN];
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 160);
    // the person: a ring as wide as their reach, the computer: a small faint one
    ring(me.x, me.y, game.reach, `rgba(214,255,58,${0.55 + (m.state === 'serve' ? 0.35 * pulse : 0)})`, 2);
    ring(me.x, me.y, 0.12, 'rgba(214,255,58,0.9)', 3);
    ring(cpu.x, cpu.y, 0.6, 'rgba(110,200,255,0.5)', 1.5);
    const s = m.shot;
    if (!s) return;
    const b = ballPos(s, s.t);
    ring(b[0], b[1], 0.18 + b[2] * 0.04, 'rgba(255,255,255,0.35)', 1);
    // where to be: blue until your ring has covered it, then yellow (the return is locked in)
    if (!isHuman(s.hitter) && !s.fault && s.t < interceptTime(s)) {
      const c = contactOf(s);
      ring(c[0], c[1], 0.45 + 0.15 * pulse, s.humanOk ? 'rgba(214,255,58,0.95)' : 'rgba(110,200,255,0.85)', s.humanOk ? 2.5 : 2);
    }
  }

  // teaser titles: 'top' for the name above the picture, 'low' for a lower-left line;
  // 'foot' is an optional small line centered at the bottom
  let caption = null;
  function drawCaption() {
    if (!caption || caption.alpha <= 0) return;
    const g = lctx, low = caption.pos === 'low';
    const x = low ? 64 : W / 2, y = low ? H - 96 : caption.pos === 'top' ? H * 0.25 : H / 2 - 6;
    const face = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "WenQuanYi Zen Hei", sans-serif';
    g.globalAlpha = caption.alpha;
    g.textAlign = low ? 'left' : 'center';
    g.shadowColor = 'rgba(0,0,0,0.95)';
    g.shadowBlur = 26;
    if (caption.eyebrow) {
      g.fillStyle = '#d6ff3a';
      g.font = `600 20px ${face}`;
      g.fillText(caption.eyebrow, x, y - (low ? 52 : 78));
    }
    g.fillStyle = '#f5f5f7';
    g.font = `700 ${low ? 44 : 84}px ${face}`;
    g.fillText(caption.title, x, y);
    if (caption.sub) {
      g.fillStyle = '#a1a1a6';
      g.font = `500 22px ${face}`;
      g.fillText(caption.sub, x, y + (low ? 36 : 46));
    }
    if (caption.foot) {
      g.globalAlpha = caption.alpha * (caption.footAlpha ?? 1);
      g.textAlign = 'center';
      g.fillStyle = '#d6ff3a';
      g.font = `500 20px ${face}`;
      g.fillText(caption.foot, W / 2, H - 40);
    }
    g.shadowBlur = 0;
    g.textAlign = 'left';
    g.globalAlpha = 1;
  }

  // ---------- interaction: drag to orbit ----------
  function bindOrbit(target, enabled) {
    let drag = null, pending = false;
    target.addEventListener('pointerdown', e => {
      if (!enabled() || e.pointerType === 'touch') return;
      drag = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch };
    });
    addEventListener('pointermove', e => {
      if (!drag) return;
      cam.yaw = drag.yaw + (e.clientX - drag.x) * 0.006;
      cam.pitch = clamp(drag.pitch - (e.clientY - drag.y) * 0.004, 0.1, 1.45);
      if (!pending) {
        pending = true;
        requestAnimationFrame(() => { pending = false; setupCamera(); drawCourt(); redrawTrails(); });
      }
    });
    addEventListener('pointerup', () => { drag = null; });
  }

  // v: any of { yaw, pitch, dist, target, shift, rise, zoom }
  function setView(v) {
    Object.assign(cam, v);
    setupCamera(); drawCourt(); redrawTrails();
  }
  function setCourtAlpha(a) {
    if (Math.abs(a - P.courtAlpha) < 1e-3) return;
    P.courtAlpha = a;
    drawCourt();
  }

  // ---------- boot ----------
  resize();
  if (!TEASER) addEventListener('resize', resize);
  setMatches(P.matches);

  window.rally = {
    P, stats, advance, render, setMatches, clearTrails, redrawTrails, bindOrbit, setView,
    game, startGame, stopGame, gameAim, nextPoint,
    teaser: TEASER,
    get matches() { return matches; },
    setCaption(c) { caption = c; },
    get view() { return { yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist, target: cam.target.slice(), shift: cam.shift, rise: cam.rise, zoom: cam.zoom }; },
    gpu: !!gl,
    setCourtAlpha, ballPos,
    get arcCount() { return arcs.length; },
    reseed(s) { seed = s; rand = mulberry32(s); },
    capture(type = 'image/jpeg', q = 0.92) {
      const c = document.createElement('canvas');
      c.width = liveCv.width; c.height = liveCv.height;
      const g = c.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(courtCv, 0, 0); g.drawImage(trailCv, 0, 0); g.drawImage(liveCv, 0, 0);
      return c.toDataURL(type, q);
    },
  };
})();
