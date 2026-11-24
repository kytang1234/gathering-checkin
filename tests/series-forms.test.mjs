import test from 'node:test';
import assert from 'node:assert/strict';
import { seriesFormPage, seriesPage } from '../src/views/series.mjs';
import { buildSeriesStats } from '../src/lib/series.mjs';

const USER = { name: '管理員', role: 'admin' };

function formsOf(html) {
  return html.match(/<form[^>]*>/g) || [];
}

test('新增系列表單：有 method=post 與 action=/series', () => {
  const html = seriesFormPage({ user: USER, csrfToken: 'tok' }).toString();
  const create = formsOf(html).filter((tag) => tag.includes('action="/series"'));
  assert.equal(create.length, 1, '找不到建立系列的表單');
  assert.ok(create[0].includes('method="post"'), create[0]);
});

test('編輯系列表單：action 指向 /series/:id/edit', () => {
  const html = seriesFormPage({
    user: USER,
    series: { id: 'ser_1', name: '示範', notes: null },
    csrfToken: 'tok',
  }).toString();
  const edit = formsOf(html).filter((tag) => tag.includes('action="/series/ser_1/edit"'));
  assert.equal(edit.length, 1);
  assert.ok(edit[0].includes('method="post"'), edit[0]);
});

test('系列頁的刪除表單：method 與 action 齊全', () => {
  const stats = buildSeriesStats({
    series: { id: 'ser_1', name: '示範' },
    events: [],
    rosterByEvent: new Map(),
  });
  const html = seriesPage({
    user: USER,
    series: { id: 'ser_1', name: '示範', notes: null },
    stats,
    includeOpen: false,
    sort: 'name',
    flash: null,
    csrfToken: 'tok',
  }).toString();

  const del = formsOf(html).filter((tag) => tag.includes('action="/series/ser_1/delete"'));
  assert.equal(del.length, 1, '找不到刪除系列的表單');
  assert.ok(del[0].includes('method="post"'), del[0]);
});

test('頁面上所有表單都有 method 與 action（防止再漏）', () => {
  const stats = buildSeriesStats({
    series: { id: 'ser_1', name: '示範' },
    events: [],
    rosterByEvent: new Map(),
  });
  const pages = [
    seriesFormPage({ user: USER, csrfToken: 'tok' }).toString(),
    seriesPage({
      user: USER,
      series: { id: 'ser_1', name: '示範', notes: null },
      stats,
      includeOpen: false,
      sort: 'name',
      flash: null,
      csrfToken: 'tok',
    }).toString(),
  ];

  for (const html of pages) {
    for (const tag of formsOf(html)) {
      assert.ok(tag.includes('method="post"') || tag.includes('method="get"'), `表單缺 method：${tag}`);
      assert.ok(/action="[^"]+"/.test(tag), `表單缺 action：${tag}`);
    }
  }
});
