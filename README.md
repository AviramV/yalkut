# מארגן הילקוט — כיתה א'

A daily packing checklist for a first-grader's schoolbag, built from the
school's official equipment list. Static site, Hebrew/RTL, works offline,
installable to a phone home screen.

## Shape

Eight files, no build step, no backend, no accounts, no personal data leaves
the device.

| File | Role |
|---|---|
| `index.html` | markup shell only — no inline JS, so a strict CSP applies |
| `app.js` | all logic |
| `app.css` | all styling (plain CSS, no framework) |
| `data.json` | **the equipment list** — the only file you normally edit |
| `aptabase.js` | vendored [@aptabase/web](https://github.com/aptabase/aptabase-js) 0.5.0 — the only dependency, shipped as a file because there is no bundler |
| `sw.js` | offline cache + the release lever |
| `manifest.json`, `icon*.png/svg` | home-screen install |
| `test.js` | `node test.js` — logic + release checks |

State lives in `localStorage` only: the weekly schedule, and today's ticks
(date-stamped, so yesterday's never carry over).

## Analytics

Aptabase (EU), app key `A-EU-8415609974`, wired in the `analytics` section of
`app.js`. Anything not served from `*.github.io` is sent as `isDebug`, so local
testing stays out of the real numbers. Events fail silently offline — there is
no queue and no retry.

**What is never sent:** the pasted WhatsApp message, the catalog search text,
any item the child owns. Only counts, day numbers, subject names and tab names.

| Event | Props | Question it answers |
|---|---|---|
| `app_open` | `day`, `subjects`, `mode`, `resumed` | is it used daily, and installed or in a tab? |
| `bag_ready` | `items`, `day` | do parents finish packing, or abandon halfway? |
| `subjects_matched` | `chars`, `matched` | **`matched:0` with `chars>0` = the keyword list missed a real message** |
| `chip_toggled` | `action`, `subject` | which subjects the parser keeps getting wrong |
| `day_selected` | `day`, `is_today` | is the day switcher used, or only "today"? |
| `tab_view` | `tab` | does anyone open the schedule / catalog tabs? |
| `week_saved` | `ok`, `days_filled` | did they replace the sample schedule with a real one? |
| `week_reset` | — | did the sample schedule turn out better than theirs? |
| `checks_cleared` | `day` | re-packing, or recovering from a mistake? |
| `catalog_search` | `chars`, `hits` | `hits:0` = equipment missing from `data.json` |
| `update_offered` / `update_applied` | — | does the release lever actually reach people? |
| `pwa_installed` | — | home-screen installs |
| `data_load_failed` | `reason` | `data.json` broken in the wild |

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

## Modelling decisions on record

Confirmed with the school, so they do not need re-litigating:

- **`shared: false` on `binder-2sh` and `nb-10lines` is correct.** Those are a
  separate binder and notebook per subject, not one shared across the five and
  four subjects that list them. A day with two such subjects correctly shows
  two rows and `צריך 2 כאלה`.
- **Item 26 on the main equipment sheet was deleted by the school on purpose.**
  It is intentionally absent from `data.json`.
- **The art lesson does not repeat the pencil case.** The art sheet lists
  עפרון, מחק and סרגל, but all three are already in `pencilCase` and get
  ticked every day, so they are not duplicated into the אומנות subject — a
  note on the subject points at the קלמר instead. `צבעי עיפרון` *is* listed
  separately, because the art sheet distinguishes it from
  `צבעי פנדה או טושים` while the pencil case only says the generic `צבעים`.

## Sources

- `רשימת ציוד נדרש לכיתה א' - לפי מקצועות` — the 25 subjects.
- `רשימת ציוד לשיעור אמנות` — the `supplies` group.
