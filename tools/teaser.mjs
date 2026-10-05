// Renders the teaser animation headlessly, frame by frame, so it is smooth and reproducible.
//   node tools/teaser.mjs [live-site-url]
// Needs Playwright (with Chromium) and ffmpeg (or the imageio-ffmpeg Python package).
// Writes media/teaser.mp4, media/teaser.gif and media/poster.jpg.

import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = createRequire('/opt/node22/lib/node_modules/')('playwright')); }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const liveUrl = process.argv[2] || '';
const W = 1280, H = 720, FPS = 30, SECONDS = 18;

function ffmpegPath() {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return 'ffmpeg'; }
  catch { return execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim(); }
}

const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'teaser-'));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', e => console.error('page error:', e.message));
await page.goto(`file://${root}/index.html?teaser=1&seed=8&w=${W}&h=${H}`);

// The teaser is the page's opening reveal (intro.js), with a few words laid over it:
// follow one ball, speed up and pull back, then the finished picture with the name.
// [start, end, caption]
const CAPTIONS = [
  [0.4, 4.4, { title: 'Follow one ball.', pos: 'low' }],
  [5.4, 10.0, { title: 'Four rules decide where it goes next.', pos: 'low' }],
  [11.0, 99, { eyebrow: 'An emergent animation', title: 'Long Rally.', sub: 'One ball. Four rules. Every path it ever took.', pos: 'top',
    foot: liveUrl || 'Scroll it. Play with it.' }],
];

const total = FPS * SECONDS;
const ease = t => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);
const fade = (t, a, b, c, d) => Math.min(ease((t - a) / (b - a)), 1 - ease((t - c) / (d - c)));

await page.evaluate(() => rallyIntro.start(rally));
for (let i = 0; i < total; i++) {
  const t = i / FPS;
  const c = CAPTIONS.find(([a, e]) => t >= a && t < e);
  const caption = c && { ...c[2], alpha: fade(t, c[0], c[0] + 0.6, c[1] - 0.6, c[1]), footAlpha: ease((t - 14) / 0.8) };

  const data = await page.evaluate(([t, caption]) => {
    const R = rally;
    rallyIntro.frame(R, t, 1 / 30);
    R.setCaption(caption);
    R.advance(1 / 30);
    R.render();
    return R.capture('image/jpeg', 0.93);
  }, [t, caption]);

  fs.writeFileSync(path.join(frames, `f${String(i).padStart(4, '0')}.jpg`), Buffer.from(data.split(',')[1], 'base64'));
  if (i % 90 === 0) process.stdout.write(`frame ${i}/${total}\n`);
}
await browser.close();

const ff = ffmpegPath();
const media = path.join(root, 'media');
fs.mkdirSync(media, { recursive: true });
const input = ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, 'f%04d.jpg')];

execFileSync(ff, [...input, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart',
  path.join(media, 'teaser.mp4')], { stdio: 'inherit' });

execFileSync(ff, [...input, '-vf',
  'fps=12,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a',
  '-loop', '0', path.join(media, 'teaser.gif')], { stdio: 'inherit' });

// poster: the finished picture with its name
fs.copyFileSync(path.join(frames, `f${String(Math.round(17 * FPS)).padStart(4, '0')}.jpg`), path.join(media, 'poster.jpg'));

fs.rmSync(frames, { recursive: true, force: true });
for (const f of ['teaser.mp4', 'teaser.gif', 'poster.jpg']) {
  console.log(f, (fs.statSync(path.join(media, f)).size / 1e6).toFixed(1) + ' MB');
}
