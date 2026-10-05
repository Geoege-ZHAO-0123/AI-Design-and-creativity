// Long Rally: the opening sequence, in the manner of a product reveal.
// Follow one ball in slow motion from the serve, then pull the camera back while time
// speeds up and more rallies join, until the whole path the ball has drawn floats on
// screen like the product itself. The page and the teaser recorder both play it.

(() => {
  const ease = k => k <= 0 ? 0 : k >= 1 ? 1 : k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  const lerp = (a, b, k) => a + (b - a) * k;
  const span = (t, a, b) => ease((t - a) / (b - a));

  const T = {
    follow: 0.4,     // first serve
    pull: 5.2,       // camera starts to pull back
    wide: 10.8,      // fully pulled back
    title: 11.0,     // the name appears
    end: 14.5,       // hand over to the page
  };
  const FOLLOW = { yaw: 1.32, pitch: 0.12, dist: 7.5 };
  // the finished picture; on a tall phone screen, look down the length of the court instead
  const wide = () => innerWidth < innerHeight ? { yaw: 0.22, pitch: 0.6, dist: 46, rise: 0.1 } : { yaw: 0.72, pitch: 0.5, dist: 64, rise: 0.08 };
  const MAX_MATCHES = 14;

  let aim = [0, -10, 1.5];

  function start(R) {
    R.clearTrails();
    R.setMatches(0);
    R.setMatches(1);
    R.matches[0].wait = 0.35;
    Object.assign(R.P.rules, { chase: true, open: true, recover: true, imperfect: true });
    const m = R.matches[0], srv = m.players[m.server];
    aim = [srv.x, srv.y, 2.75];
    R.P.courtAlpha = 0;
    R.setView({ ...FOLLOW, target: aim.slice(), shift: 0, rise: 0, zoom: 1 });
  }

  // t: seconds since the sequence started; dt: seconds since the last frame
  function frame(R, t, dt) {
    const P = R.P;

    // time: slow motion while following, then a long accelerating time-lapse
    const ramp = span(t, T.pull, T.wide);
    P.timeScale = t < T.pull ? lerp(0.6, 0.9, t / T.pull)
      : t < T.wide ? 0.9 * Math.pow(70 / 0.9, ramp)
      : lerp(70, 2.5, span(t, T.wide, T.wide + 1.6));

    // more rallies join the same court as the camera pulls back
    const want = t < T.pull + 0.4 ? 1 : Math.min(MAX_MATCHES, 1 + Math.floor((t - T.pull - 0.4) / 0.28));
    if (R.matches.length !== want) R.setMatches(want);

    // camera: chase the first ball, then let go and rise
    const m0 = R.matches[0];
    if (m0 && m0.shot) {
      // look slightly ahead of the ball, so the smoothing doesn't leave it behind
      const k = 1 - Math.exp(-dt * 12);
      const b = R.ballPos(m0.shot, m0.shot.t + P.timeScale / 12);
      aim = [lerp(aim[0], b[0], k), lerp(aim[1], b[1], k), lerp(aim[2], Math.max(0.6, b[2]), k)];
    }
    const k = ramp, WIDE = wide();
    const orbit = t > T.wide ? (t - T.wide) * 0.035 : 0;
    const target = [lerp(aim[0], 0, k), lerp(aim[1], 0, k), lerp(aim[2], 1, k)];
    R.setView({
      yaw: lerp(FOLLOW.yaw, WIDE.yaw, k) + orbit,
      pitch: lerp(FOLLOW.pitch, WIDE.pitch, k),
      dist: FOLLOW.dist * Math.pow(WIDE.dist / FOLLOW.dist, k),
      rise: WIDE.rise * k,
      target,
    });

    // up close there is only the ball in the dark; the court appears as the camera pulls back
    R.setCourtAlpha(0.8 * span(t, T.pull + 1, T.wide));
    // the comet tail shortens as time speeds up, so fast balls stay points of light
    P.comet = lerp(0.45, 0.08, k);
  }

  window.rallyIntro = { T, start, frame, wide };
})();
