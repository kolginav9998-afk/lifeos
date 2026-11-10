import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const md = fs.readFileSync(new URL('../docs/COUNCIL.md', import.meta.url), 'utf8');

test('совет: 50 специалистов по 15 предложений, всего 750, у каждого метка', () => {
  const sections = md.split(/^### /m).slice(1);
  assert.equal(sections.length, 50);
  const titles = new Set();
  let total = 0;
  sections.forEach((sec, i) => {
    const [head, ...rest] = sec.split('\n');
    assert.match(head, new RegExp(`^${i + 1}\\. `), `номер специалиста ${i + 1}`);
    const items = rest.filter(l => /^\d+\. \*\*/.test(l));
    assert.equal(items.length, 15, `у специалиста «${head}» 15 предложений`);
    items.forEach((l, j) => {
      assert.match(l, new RegExp(`^${j + 1}\\. `), `нумерация ${head}`);
      assert.match(l, /[✅🔜📌💡⚠️]\s*$/u, `метка в конце: ${l.slice(0, 50)}`);
      const t = l.match(/\*\*(.+?)\*\*/)[1];
      assert.ok(!titles.has(t), `повтор названия: ${t}`);
      titles.add(t);
    });
    total += items.length;
  });
  assert.equal(total, 750);
});
test('совет: честные метки — «сейчас» только то, что реально берём, и нет медицинских обещаний', () => {
  const soon = md.split('\n').filter(l => /^\d+\. \*\*/.test(l) && /🔜\s*$/u.test(l));
  assert.ok(soon.length >= 15 && soon.length <= 30, `в работу сейчас: ${soon.length}`);
  assert.ok(!/излечит|гарантирует/i.test(md));
  assert.match(md, /Чего не делаем/);
});
