# מארגן הילקוט — כיתה א'

A daily packing checklist for a first-grader's schoolbag, built from the
school's official equipment list. Static site, Hebrew/RTL, works offline,
installable to a phone home screen.

## Shape

Seven files, no build step, no dependencies, no backend, no accounts, no
personal data leaves the device.

| File | Role |
|---|---|
| `index.html` | markup shell only — no inline JS, so a strict CSP applies |
| `app.js` | all logic |
| `app.css` | all styling (plain CSS, no framework) |
| `data.json` | **the equipment list** — the only file you normally edit |
| `sw.js` | offline cache + the release lever |
| `manifest.json`, `icon*.png/svg` | home-screen install |
| `test.js` | `node test.js` — logic + release checks |

State lives in `localStorage` only: the weekly schedule, and today's ticks
(date-stamped, so yesterday's never carry over).

## Deploy (GitHub Pages, free)

1. Push this repo to GitHub.
2. Settings → Pages → Source: `Deploy from a branch`, branch `main`, folder `/`.
3. Share the resulting `https://<user>.github.io/<repo>/` URL. One URL for
   everyone — no files sent around, so nobody is stuck on an old copy.

Pages requires HTTPS, which the service worker needs anyway.

## Releasing an update

The version appears in the app header, and the service worker cache is keyed
to it. Bumping it is the release.

```sh
V=1.0.1
sed -i '' "s/\"version\": \".*\"/\"version\": \"$V\"/" data.json
sed -i '' "s/^const VERSION = '.*';/const VERSION = '$V';/" sw.js
node test.js && git commit -am "release $V" && git push
```

`node test.js` fails if the two versions disagree or if `sw.js` precaches a
file that does not exist — the two ways a release silently ships broken.

What each open copy then does: the new version downloads in the background and
**waits**. The app shows `יש גרסה חדשה` with a `רענן` button. Nothing changes
until someone taps it, so a list can never mutate halfway through packing a
bag. Accepting it activates the new worker and deletes the old cache.

## Editing the equipment list

Everything is in `data.json`.

- `items` — the physical objects. One record per real object.
- `subjects` — each references `items` by id.
- `shared` on an item is the important flag:
  - `true` — one physical object serving several subjects. One row, one tick,
    every subject named on it. Use for workbooks and shoes.
  - `false` — a separate object per subject, even when they look identical.
    One row and one tick each, and the app shows `צריך N כאלה`.

Getting `shared` wrong is the difference between "you're done" and a missing
notebook, so it is deliberately explicit per item rather than inferred from
matching names.

Run `node test.js` after editing.

## Two things to confirm with the teacher

1. **Is a `קלסר חצי שקוף עם 2 שמרדפים` one binder per subject, or one shared
   across all five that list it?** Same question for
   `מחברת 10 שורות עטיפה שקופה` (four subjects). Currently modelled as
   separate (`shared: false`) — over-packing is recoverable, forgetting is
   not. If they are shared, flip `shared` to `true` on those two items.
2. **Item 26 on the school list is covered by highlighter** and is not in
   `data.json`.
