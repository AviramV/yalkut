/* One runnable check for the two pieces of real logic: keyword matching and
   the item-instance expansion. Run: node test.js */
const assert = require('assert');
const data = require('./data.json');
const app = require('./app.js');

app.load(data);

const idsOf = (text) => app.matchSubjects(text);
const name = (id) => data.subjects.find((s) => s.id === id).name;
const namesOf = (text) => idsOf(text).map(name);

// A longer subject name must swallow the shorter one inside it.
assert.deepStrictEqual(namesOf('אנגלית אומנותית'), ['אנגלית אומנותית']);
assert.deepStrictEqual(namesOf('אתגרי הלוגיקה'), ['אתגרי הלוגיקה']);
assert.deepStrictEqual(namesOf('מפתח הלב וכישורי חיים'), ['מפתח הלב וכישורי חיים']);

// Both still match when they genuinely both appear.
assert.deepStrictEqual(namesOf('אנגלית, אנגלית אומנותית').sort(),
  ['אנגלית', 'אנגלית אומנותית'].sort());

// A Hebrew letter glued to the keyword is not a match.
assert.deepStrictEqual(namesOf('בחשבונות'), []);

// Order follows the order of the lessons in the text.
assert.deepStrictEqual(namesOf('שיעור ראשון מוזיקה, אחר כך חשבון, ואז שפה'),
  ['מוזיקה', 'חשבון', 'שפה']);

// Real-world paste: noise around the subject names is fine.
assert.deepStrictEqual(namesOf('בוקר טוב! מחר: 1. שפה 2. חשבון 3. חנ"ג'),
  ['שפה', 'חשבון', 'חינוך גופני']);

assert.deepStrictEqual(namesOf(''), []);
assert.deepStrictEqual(namesOf('   '), []);

// ---- item expansion ----
const instancesFor = (subjectNames) => {
  app.setActive(subjectNames.map((n) => data.subjects.find((s) => s.name === n).id));
  return app.buildInstances();
};

// shared=true: one physical workbook, one row, both subjects named on it.
let inst = instancesFor(['חשבון', 'הנדסה']).filter((i) => i.item.id === 'wb-shvilim1');
assert.strictEqual(inst.length, 1, 'shared workbook must not be duplicated');
assert.deepStrictEqual(inst[0].subjects, ['חשבון', 'הנדסה']);

// shared=false: separate binders, one row and one checkbox each.
inst = instancesFor(['אנגלית', 'קסם התיאטרון', 'אוריגמטריה'])
  .filter((i) => i.item.id === 'binder-2sh');
assert.strictEqual(inst.length, 3);
assert.strictEqual(new Set(inst.map((i) => i.key)).size, 3, 'keys must be distinct');

// Every instance key is unique, or ticking one would tick another.
const all = instancesFor(data.subjects.map((s) => s.name));
assert.strictEqual(new Set(all.map((i) => i.key)).size, all.length);

// Subjects with no equipment contribute no rows.
assert.strictEqual(instancesFor(['אקולוגיה', 'חוקרים צעירים']).length, 0);

// ---- data.json integrity ----
// This is the file that gets edited most, and buildInstances skips ids it
// cannot resolve — so a typo would silently drop equipment from a packing
// list with no error anywhere. Fail loudly here instead.
const itemIds = new Set(data.items.map((i) => i.id));
const groupIds = new Set(data.groups.map((g) => g.id));

assert.strictEqual(itemIds.size, data.items.length, 'duplicate item id');
assert.strictEqual(new Set(data.subjects.map((s) => s.id)).size, data.subjects.length,
  'duplicate subject id');

for (const s of data.subjects) {
  for (const id of s.items) {
    assert.ok(itemIds.has(id), `subject "${s.name}" references unknown item "${id}"`);
  }
}
for (const i of data.items) {
  assert.ok(groupIds.has(i.group), `item "${i.id}" has unknown group "${i.group}"`);
  assert.ok(typeof i.shared === 'boolean', `item "${i.id}" is missing the shared flag`);
  if (i.cover) assert.ok(data.covers[i.cover], `item "${i.id}" has unknown cover "${i.cover}"`);
}
// Every group must be reachable, or it renders as an empty heading.
for (const g of data.groups) {
  assert.ok(data.items.some((i) => i.group === g.id), `group "${g.id}" has no items`);
}

// ---- art lesson (added from the art equipment sheet) ----
const art = instancesFor(['אומנות']);
assert.deepStrictEqual(art.map((i) => i.item.name),
  ['בלוק ציור', 'צבעי פנדה או טושים', 'צבעי גואש ומכחול', 'צבעי עיפרון']);

// עפרון / מחק / סרגל come from the permanent pencil case, so the art lesson
// must not add a second checkbox for any of them.
// Matched on a stem, not equality: the pencil case writes "עפרונות" where the
// art sheet writes "עפרון" — different nun, so substring matching would miss.
const pencilText = data.pencilCase.map((p) => p.text).join(' ');
for (const [artName, stem] of [['עפרון', 'עפרונ'], ['מחק', 'מחק'], ['סרגל', 'סרגל']]) {
  assert.ok(pencilText.includes(stem), `pencil case should already carry ${artName}`);
  assert.ok(!art.some((i) => i.item.name === artName), `${artName} duplicated into art lesson`);
}

// ---- release hygiene ----
// The footer version and the cache key must agree, or a release ships with
// stale assets under a name that says otherwise.
const fs = require('fs');
const swVersion = fs.readFileSync('./sw.js', 'utf8').match(/^const VERSION = '([^']+)';/m)[1];
assert.strictEqual(swVersion, data.version,
  `version mismatch: sw.js=${swVersion} data.json=${data.version} — bump both`);

// Every precached path must exist, or install() rejects and offline breaks.
for (const rel of fs.readFileSync('./sw.js', 'utf8')
  .match(/const ASSETS = \[([\s\S]*?)\];/)[1]
  .match(/'([^']+)'/g).map((q) => q.slice(1, -1))) {
  if (rel === './') continue;
  assert.ok(fs.existsSync(rel), `sw.js precaches a missing file: ${rel}`);
}

console.log('all checks passed');
