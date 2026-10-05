# Long Rally

![Teaser](media/teaser.gif)

**Try it live:** _(GitHub Pages link goes here)_

Follow one tennis ball from the serve. It flies, bounces, gets sent back, and every flight leaves its path of light on a court at night. Then the camera pulls back, time speeds up and more rallies join, until thousands of paths form a shape nobody drew. No players are shown. They exist only as four simple rules that decide where the ball goes next.

## The rules

The ball flies in an arc and bounces once. If it lands outside the lines or bounces twice, the point is over. Where it goes next is decided by four rules for the two unseen players:

1. **Chase the bounce.** See where the ball will land and run there.
2. **Hit where they aren't.** Aim for the side of the court the opponent is not on.
3. **Go back to the middle.** After every shot, head back to the center of your baseline.
4. **Nobody is perfect.** Every shot misses its aim a little, and more when you had to run for it.

Each rule changes the shape the match leaves behind:

| Rules on | What happens | The shape it leaves |
| --- | --- | --- |
| none | Nothing sends the ball back, so every point is a single serve. | A few scattered serves |
| 1 | The ball is always sent back the way it came. Rallies never end. | One bright, worn groove |
| 1 + 2 | The ball zigzags to the open side and pulls the rally out wide. Rallies are short. | Crossing diagonals |
| 1 + 2 + 3 | The next ball can always be reached. The rally repeats one figure almost forever. | A sharp, repeating figure |
| 1 + 2 + 3 + 4 | Small errors make every rally different, and rallies end with balls landing out. | A soft woven band |

## How the page works

The site reads like a product page. It opens with a reveal: the camera follows one ball in slow motion, then pulls back while time speeds up and more rallies join, until the whole accumulated path floats under the title. Below that, the court keeps running behind the text, and each screen you scroll past switches on the next rule and moves the camera. The long-exposure chapter plays sixteen matches on the same court at once. The last screen is a sandbox: switch rules on and off, change aggression, error, running speed, how many matches play at once and how fast time runs, drag to walk around the court, or replay the opening.

At the very end there is a mini game. You take the near side of the court, seen from behind your baseline, and rally against a computer that plays the far side by the same four rules. Press Start game, then Serve. The game runs in slow motion. Move with the mouse, the arrow keys or a finger. A blue ring shows where the ball should be played, just after it bounces; get your ring onto it before the ball arrives and the blue ring turns yellow, meaning your return is locked in even if you move away afterwards. A ball met on the right of your ring goes right, on the left it goes left. Each point is a game played by normal tennis rules: a shot that lands out or hits the net loses (with a second serve after a first-serve fault), and so does a ball you can't reach before its second bounce. A card then says whether you won or lost and why, with buttons to start a new game or exit. Every shot you trade is added to the long exposure, so playing draws its own pattern.

## Running it

Plain HTML, CSS and JavaScript with no build step and no libraries. `rally.js` is the simulation and renderer (the light trails are drawn with WebGL, with a canvas 2D fallback); `intro.js` is the opening reveal; the mini game lives in `rally.js` (`startGame`, `gameAim`) and `story.js` (controls and score); `story.js` connects the scrolling chapters to it with `IntersectionObserver`. Open `index.html` in a browser, or serve the folder with any static server. Add `?seed=42` to the URL to replay the same night.

The teaser in `media/` is the opening reveal, rendered frame by frame from the same code:

```sh
node tools/teaser.mjs https://<user>.github.io/<repo>/
```

It needs Playwright with Chromium, plus ffmpeg (or the `imageio-ffmpeg` Python package).

## Credits

Made by George Zhao for Cornell's AI Design & Creativity course, coded in collaboration with Claude. All code was written for this project. The court uses the official ITF singles dimensions. The look borrows from long-exposure sports photography and TV ball-tracking graphics, and the opening reveal and scroll story follow the product pages popularised by Apple.
