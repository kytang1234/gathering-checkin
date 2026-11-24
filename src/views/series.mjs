// 系列聚會：列表、表單、詳情（KPI／場次／成員／矩陣）、個人頁。

import { html, raw } from '../lib/html.mjs';
import { page, csrf, stat, empty, money } from './ui.mjs';
import { formatDateTime, humanDuration, weekdayLabel } from '../lib/time.mjs';
import { eventLabel } from '../lib/series.mjs';

const pct = (value) => (value === null || value === undefined ? '—' : `${value}%`);

function sortMembers(members, sort) {
  const list = [...members];
  if (sort === 'rate') list.sort((a, b) => (b.seriesRate ?? -1) - (a.seriesRate ?? -1) || a.name.localeCompare(b.name, 'zh-Hant'));
  else if (sort === 'streak') list.sort((a, b) => b.streak - a.streak || a.name.localeCompare(b.name, 'zh-Hant'));
  else if (sort === 'absent') list.sort((a, b) => b.absent.length - a.absent.length || a.name.localeCompare(b.name, 'zh-Hant'));
  else list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  return list;
}

export function seriesListPage({ user, series, flash }) {
  return page({
    title: '系列',
    user,
    active: '/series',
    flash,
    body: html`
      <div class="page-head">
        <div>
          <h1 class="h1">系列聚會</h1>
          <p class="muted">把連續舉辦的聚會歸為一個系列，就可以看個人與整體的出席率。</p>
        </div>
        ${user.role === 'admin' ? html`<a class="btn btn-primary" href="/series/new">＋ 新增系列</a>` : ''}
      </div>

      ${series.length === 0
        ? empty(
            '還沒有任何系列。建立一個，然後把聚會歸入它。',
            user.role === 'admin' ? html`<a class="btn btn-primary" href="/series/new">建立第一個系列</a>` : '',
          )
        : html`<div class="series-grid">
            ${series.map(
              (item) => html`<a class="series-card" href="/series/${item.id}">
                <h2>${item.name}</h2>
                ${item.notes ? html`<p class="muted small">${item.notes}</p>` : ''}
                <p class="series-meta">
                  <span>${item.event_count} 場</span>
                  <span class="dot">·</span>
                  <span>${item.member_count} 人</span>
                  ${item.last_date ? html`<span class="dot">·</span><span>最近 ${item.last_date}</span>` : ''}
                </p>
              </a>`,
            )}
          </div>`}
    `,
  });
}

export function seriesFormPage({ user, series = null, error = '', csrfToken = '' }) {
  const isEdit = Boolean(series);
  return page({
    title: isEdit ? '編輯系列' : '新增系列',
    user,
    active: '/series',
    csrfToken,
    flash: error ? { type: 'err', text: error } : null,
    body: html`
      <div class="page-head">
        <div>
          <h1 class="h1">${isEdit ? '編輯系列' : '新增系列'}</h1>
          <p class="muted">系列只是一個標籤；聚會本身的資料不變。</p>
        </div>
        <a class="btn btn-ghost" href="${isEdit ? `/series/${series.id}` : '/series'}">返回</a>
      </div>

      <form data-id="${series?.id || ''}" class="card stack">
        ${csrf(csrfToken)}
        <label class="field">
          <span>系列名稱 <em>必填</em></span>
          <input name="name" value="${series?.name || ''}" maxlength="80" required
                 placeholder="例：2026 春季主日崇拜" autofocus>
        </label>
        <label class="field">
          <span>備註</span>
          <textarea name="notes" rows="3" maxlength="500" placeholder="例：逢星期日 11:00，共 12 場">${series?.notes || ''}</textarea>
        </label>
        <div class="form-actions">
          <button class="btn btn-primary" type="submit">${isEdit ? '儲存' : '建立系列'}</button>
          <a class="btn btn-ghost" href="${isEdit ? `/series/${series.id}` : '/series'}">取消</a>
        </div>
      </form>
    `,
  });
}

function kpi(stats) {
  const t = stats.totals;
  return html`<div class="stat-grid">
    ${stat('統計場次', `${t.baseCount} 場`, `系列共 ${t.eventCount} 場`)}
    ${stat('成員', `${t.memberCount} 人`)}
    ${stat('總出席人次', `${t.attendedSeats}`)}
    ${stat('平均每場', `${t.avgPerEvent ?? '—'} 人`)}
    ${stat('系列出席率', pct(t.overallRate), 'Σ出席 ÷（成員 × 場次）')}
    ${stat('平均每場出席率', pct(t.avgEventRate), '逐場平均')}
    ${stat('活躍成員', `${t.activeMembers} 人`, '出席率 ≥ 50%')}
    ${stat('新成員', `${t.newMembers} 人`, '首場之後才出現')}
  </div>`;
}

export function seriesPage({ user, series, stats, includeOpen, sort, flash, csrfToken = '' }) {
  const members = sortMembers(stats.members, sort);

  return page({
    title: series.name,
    user,
    active: '/series',
    csrfToken,
    flash,
    wide: true,
    body: html`
      <div class="page-head">
        <div>
          <p class="crumb"><a href="/series">系列</a> / ${series.name}</p>
          <h1 class="h1">${series.name}</h1>
          ${series.notes ? html`<p class="muted">${series.notes}</p>` : ''}
        </div>
        <div class="head-actions">
          <a class="btn btn-sm btn-ghost" href="/series/${series.id}/events.csv">匯出場次 CSV</a>
          <a class="btn btn-sm btn-ghost" href="/series/${series.id}/members.csv">匯出成員 CSV</a>
          <a class="btn btn-sm" href="/series/${series.id}/matrix.csv">匯出矩陣 CSV</a>
          ${user.role === 'admin' ? html`<a class="btn btn-sm btn-ghost" href="/series/${series.id}/edit">編輯</a>` : ''}
        </div>
      </div>

      ${kpi(stats)}

      <div class="series-toolbar print-hide">
        <span class="muted small">統計基準：</span>
        <a class="chip ${includeOpen ? '' : 'chip-ok'}" href="/series/${series.id}">只計已結束</a>
        <a class="chip ${includeOpen ? 'chip-ok' : ''}" href="/series/${series.id}?include=open">包括已開放</a>
        <span class="muted small">未舉行的場次永不計入分母。</span>
      </div>

      <section class="card">
        <h2 class="h2">每場出席</h2>
        ${stats.perEvent.length === 0
          ? html`<p class="muted">還沒有可用於統計的場次（需要把聚會設為「已結束」）。</p>`
          : html`<table class="table compact">
              <thead>
                <tr><th>日期</th><th>聚會</th><th>名單</th><th>出席</th><th>出席率</th><th>準時／遲到</th><th>平均停留</th></tr>
              </thead>
              <tbody>
                ${stats.perEvent.map(
                  (item) => html`<tr>
                    <td data-label="日期">${item.event.event_date}<span class="muted small">${weekdayLabel(item.event.event_date)}</span></td>
                    <td data-label="聚會"><a href="/events/${item.event.id}">${item.event.name}</a></td>
                    <td data-label="名單">${item.rosterCount}</td>
                    <td data-label="出席">${item.presentCount}</td>
                    <td data-label="出席率">${pct(item.rate)}</td>
                    <td data-label="準時／遲到">${item.onTimeCount} / ${item.lateCount}</td>
                    <td data-label="平均停留">${item.avgStay === null ? '—' : humanDuration(item.avgStay)}</td>
                  </tr>`,
                )}
              </tbody>
            </table>`}
      </section>

      <section class="card">
        <div class="series-table-head">
          <h2 class="h2">成員出席（${members.length}）</h2>
          <div class="sort-links print-hide">
            <span class="muted small">排序：</span>
            <a class="chip ${sort === 'name' ? 'chip-ok' : ''}" href="/series/${series.id}?sort=name${includeOpen ? '&include=open' : ''}">姓名</a>
            <a class="chip ${sort === 'rate' ? 'chip-ok' : ''}" href="/series/${series.id}?sort=rate${includeOpen ? '&include=open' : ''}">出席率</a>
            <a class="chip ${sort === 'streak' ? 'chip-ok' : ''}" href="/series/${series.id}?sort=streak${includeOpen ? '&include=open' : ''}">連續</a>
            <a class="chip ${sort === 'absent' ? 'chip-ok' : ''}" href="/series/${series.id}?sort=absent${includeOpen ? '&include=open' : ''}">缺席</a>
          </div>
        </div>
        ${members.length === 0
          ? html`<p class="muted">系列內還沒有任何名單。</p>`
          : html`<table class="table">
              <thead>
                <tr><th>姓名</th><th>組別</th><th>出席</th><th>系列出席率</th><th>報名出席率</th><th>連續</th><th>最近出席</th><th>缺席</th></tr>
              </thead>
              <tbody>
                ${members.map(
                  (member) => html`<tr>
                    <td data-label="姓名"><a href="/series/${series.id}/member/${member.attendee_id}">${member.name}</a></td>
                    <td data-label="組別">${member.group_name || '—'}</td>
                    <td data-label="出席">${member.attended} / ${stats.baseEvents.length}</td>
                    <td data-label="系列出席率">${pct(member.seriesRate)}</td>
                    <td data-label="報名出席率">${pct(member.registeredRate)}</td>
                    <td data-label="連續">${member.streak}</td>
                    <td data-label="最近出席">${member.lastAttended || '—'}</td>
                    <td data-label="缺席">${member.absent.length}</td>
                  </tr>`,
                )}
              </tbody>
            </table>`}
      </section>

      <details class="card matrix-card">
        <summary>出席矩陣（點名總表）</summary>
        ${stats.baseEvents.length === 0
          ? html`<p class="muted">未有基準場次。</p>`
          : html`<div class="matrix-wrap">
              <table class="matrix">
                <thead>
                  <tr>
                    <th class="sticky-col">姓名</th>
                    ${stats.baseEvents.map((event) => html`<th title="${event.name}">${eventLabel(event)}</th>`)}
                    <th>出席</th>
                    <th>率</th>
                  </tr>
                </thead>
                <tbody>
                  ${members.map(
                    (member) => html`<tr>
                      <td class="sticky-col">${member.name}</td>
                      ${member.cells.map(
                        (cell) => html`<td class="cell-${cell}">${cell === 'present' ? '✓' : cell === 'late' ? '遲' : cell === 'absent' ? '✗' : '·'}</td>`,
                      )}
                      <td>${member.attended}</td>
                      <td>${pct(member.seriesRate)}</td>
                    </tr>`,
                  )}
                </tbody>
              </table>
            </div>`}
        <p class="hint">✓ 準時　遲 遲到　✗ 缺席　· 未報名（未在該場名單內，不應視為缺席）</p>
      </details>

      ${user.role === 'admin'
        ? html`<section class="card">
            <h2 class="h2">刪除系列</h2>
            <p class="muted">可選擇只刪標籤（聚會保留），或連聚會一併刪除。</p>
            <form data-id="${series.id}" class="inline-form">
              ${csrf(csrfToken)}
              <label class="check"><input type="radio" name="mode" value="tag" checked><span>只刪系列，聚會保留</span></label>
              <label class="check"><input type="radio" name="mode" value="all"><span>連 ${stats.totals.eventCount} 場聚會一併刪除</span></label>
              <div class="form-actions">
                <button class="btn btn-danger btn-ghost" type="submit">刪除系列</button>
              </div>
            </form>
          </section>`
        : ''}
    `,
  });
}

export function memberPage({ user, series, member, stats }) {
  const base = stats.baseEvents.length;
  return page({
    title: `${member.name} · ${series.name}`,
    user,
    body: html`
      <p class="crumb"><a href="/series">系列</a> / <a href="/series/${series.id}">${series.name}</a> / ${member.name}</p>
      <div class="page-head">
        <div>
          <h1 class="h1">${member.name}</h1>
          <p class="muted">${member.group_name || '未分組'}${member.phone ? ` · ${member.phone}` : ''}</p>
        </div>
        <a class="btn btn-ghost" href="/series/${series.id}">返回系列</a>
      </div>

      <div class="stat-grid">
        ${stat('系列出席率', pct(member.seriesRate), `${member.attended} / ${base} 場`)}
        ${stat('報名出席率', pct(member.registeredRate), `報名 ${member.registered} 場`)}
        ${stat('連續出席', `${member.streak} 場`)}
        ${stat('準時／遲到', `${member.onTime} / ${member.late}`, member.late ? `平均遲 ${member.avgLate} 分` : '')}
        ${stat('平均停留', member.avgStay === null ? '—' : humanDuration(member.avgStay))}
        ${stat('費用', `${money(member.paid)}／${money(member.owed)}`, member.owed ? `未繳 ${money(member.owed - member.paid)}` : '')}
      </div>

      <div class="split">
        <section class="card">
          <h2 class="h2">出席紀錄</h2>
          ${stats.perEvent.length === 0
            ? html`<p class="muted">未有基準場次。</p>`
            : html`<ul class="plain-list">
                ${stats.perEvent.map((item, index) => {
                  const cell = member.cells[index];
                  return html`<li>
                    <span class="muted small">${item.event.event_date}</span>
                    <a href="/events/${item.event.id}">${item.event.name}</a>
                    ${cell === 'present'
                      ? html`<span class="badge badge-ok">準時</span>`
                      : cell === 'late'
                        ? html`<span class="badge badge-warn">遲到</span>`
                        : cell === 'absent'
                          ? html`<span class="badge badge-quiet">缺席</span>`
                          : html`<span class="muted small">未報名</span>`}
                  </li>`;
                })}
              </ul>`}
        </section>

        <section class="card">
          <h2 class="h2">缺席場次（${member.absent.length}）</h2>
          ${member.absent.length === 0
            ? html`<p class="muted">沒有缺席。</p>`
            : html`<ul class="plain-list">
                ${member.absent.map(
                  (event) => html`<li><span class="muted small">${event.event_date}</span> ${event.name}</li>`,
                )}
              </ul>`}
          <p class="hint">首次出席：${member.firstAttended || '—'}　最近出席：${member.lastAttended || '—'}</p>
        </section>
      </div>
    `,
  });
}
