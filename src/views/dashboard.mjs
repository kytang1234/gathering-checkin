import { html } from '../lib/html.mjs';
import { todayInZone } from '../lib/time.mjs';
import { page, csrf, statusBadge, dateBlock, whenText, empty, money } from './ui.mjs';

function eventCard(event) {
  const rate = event.roster_count ? Math.round((event.present_count / event.roster_count) * 100) : 0;
  return html`<article class="event-card">
    <a class="event-main" href="/events/${event.id}">
      ${dateBlock(event)}
      <div class="event-body">
        <div class="event-title-row">
          <h2 class="event-title">${event.name}</h2>
          ${statusBadge(event.status)}
        </div>
        <p class="event-meta">${whenText(event)}${event.location ? ` · ${event.location}` : ''}</p>
        <div class="event-stats">
          <span><strong>${event.present_count}</strong> / ${event.roster_count} 人已簽到</span>
          <span class="dot">·</span>
          <span>${rate}%</span>
          ${Number(event.fee_amount) > 0
            ? html`<span class="dot">·</span><span>${money(event.fee_amount)}/人</span>`
            : ''}
        </div>
      </div>
    </a>
    <div class="event-actions">
      <a class="btn btn-sm" href="/events/${event.id}/checkin">現場簽到</a>
      <a class="btn btn-sm btn-ghost" href="/events/${event.id}/summary">總結</a>
    </div>
  </article>`;
}

export function dashboardPage({ user, events, flash, csrfToken = '', tz = 'Asia/Hong_Kong' }) {
  const today = todayInZone(tz);
  const upcoming = events
    .filter((e) => e.event_date >= today)
    .sort((a, b) => (a.event_date + a.start_time).localeCompare(b.event_date + b.start_time));
  const past = events.filter((e) => e.event_date < today);

  return page({
    title: '聚會',
    user,
    active: '/',
    flash,
    csrfToken,
    body: html`
      <div class="page-head">
        <div>
          <h1 class="h1">聚會</h1>
          <p class="muted">建立聚會、貼出 QR code、即時看誰到了。</p>
        </div>
        <a class="btn btn-primary" href="/events/new">＋ 新增聚會</a>
      </div>

      ${events.length === 0
        ? empty(
            '還沒有任何聚會。先建立一個，之後就可以印 QR code 給大家掃。',
            html`<a class="btn btn-primary" href="/events/new">建立第一個聚會</a>`,
          )
        : html`
            ${upcoming.length > 0 ? html`<h2 class="section-title">即將舉行</h2>${upcoming.map(eventCard)}` : ''}
            ${past.length > 0 ? html`<h2 class="section-title">已過去</h2>${past.map(eventCard)}` : ''}
          `}

      <section class="card tips">
        <h2 class="h2">現場流程建議</h2>
        <ol class="steps">
          <li>出門前把聚會的 QR code 頁面投影或印出來，貼在入口。</li>
          <li>安排一位同事用平板開「現場簽到」，用鏡頭掃大家的個人 QR 卡。</li>
          <li>沒帶卡的人，在名單搜尋名字按一下就可以。</li>
          <li>散場後開「總結」，按一下匯出 Excel。</li>
        </ol>
      </section>
    `,
  });
}

export function usersPage({ user, users, flash, csrfToken = '' }) {
  return page({
    title: '職員',
    user,
    active: '/users',
    flash,
    csrfToken,
    body: html`
      <div class="page-head">
        <div>
          <h1 class="h1">職員</h1>
          <p class="muted">每位同事一個帳號，簽到記錄會標明是誰按的。</p>
        </div>
      </div>

      <section class="card">
        <h2 class="h2">新增職員</h2>
        <form method="post" action="/users/add" class="form-grid">
          ${csrf(csrfToken)}
          <label class="field">
            <span>名稱 <em>必填</em></span>
            <input name="name" required maxlength="40" placeholder="例：陳師傅">
          </label>
          <label class="field">
            <span>角色</span>
            <select name="role">
              <option value="staff">工作人員（可簽到、管名單、匯出）</option>
              <option value="admin">管理員（可建立／刪除聚會、管理帳號）</option>
            </select>
          </label>
          <label class="field span-2">
            <span>密碼</span>
            <input name="password" type="text" minlength="8" maxlength="128" autocomplete="new-password"
                   placeholder="留空＝自動產生一組">
            <small class="muted">最少 8 個字元。留空的話，下一步會顯示自動產生的密碼，只顯示一次。</small>
          </label>
          <div class="span-2">
            <button class="btn btn-primary" type="submit">新增</button>
          </div>
        </form>
      </section>

      <section class="card">
        <h2 class="h2">現有帳號（${users.length}）</h2>
        <table class="table">
          <thead>
            <tr><th>名稱</th><th>角色</th><th>狀態</th><th>建立</th><th class="col-actions">操作</th></tr>
          </thead>
          <tbody>
            ${users.map(
              (row) => html`<tr>
                <td data-label="名稱">
                  ${row.name}
                  ${row.id === user.id ? html`<span class="badge badge-quiet">你</span>` : ''}
                </td>
                <td data-label="角色">${row.role === 'admin' ? '管理員' : '工作人員'}</td>
                <td data-label="狀態">
                  ${row.is_active
                    ? html`<span class="badge badge-ok">啟用</span>`
                    : html`<span class="badge badge-quiet">停用</span>`}
                </td>
                <td data-label="建立">${row.created_at.slice(0, 10)}</td>
                <td data-label="操作" class="col-actions">
                  <a class="btn btn-sm btn-ghost" href="/users/${row.id}/password">重設密碼</a>
                  <form method="post" action="/users/${row.id}/toggle" class="inline-form">
                    ${csrf(csrfToken)}
                    <button class="btn btn-sm btn-ghost" type="submit">${row.is_active ? '停用' : '啟用'}</button>
                  </form>
                </td>
              </tr>`,
            )}
          </tbody>
        </table>
        <p class="hint">「重設密碼」會產生新密碼並顯示一次；「停用」會即時踢掉該帳號的登入，但保留他的簽到記錄。</p>
      </section>

      <section class="card">
        <h2 class="h2">也可以使用命令列</h2>
        <p class="muted">在同一台電腦的專案資料夾執行（適合批量或忘記管理員密碼時）：</p>
        <pre class="code">npm run user -- add 陳師傅 staff</pre>
        <pre class="code">npm run user -- reset 陳師傅</pre>
        <pre class="code">npm run user</pre>
      </section>

      <section class="card">
        <h2 class="h2">資料庫備份</h2>
        <p class="muted">下載目前完整的資料快照（一個 .db 檔）。建議每次活動結束後下載一次，存到自己的雲端硬碟。</p>
        <a class="btn" href="/admin/backup">下載備份 .db</a>
        <p class="hint">還原：停止程式 → 把備份檔改名為 attendance.db 覆蓋 data/ 內的檔案 → 刪除 .db-wal/.db-shm → 重新啟動。</p>
      </section>
    `,
  });
}

/** 建立／重設密碼後的一次性顯示頁：密碼不放在網址，離開即消失。 */
export function passwordRevealPage({ user, csrfToken = '', name, role, password, mode = 'created' }) {
  return page({
    title: mode === 'created' ? '帳號已建立' : '密碼已重設',
    user,
    csrfToken,
    body: html`
      <section class="card narrow">
        <h1 class="h1">${mode === 'created' ? '帳號已建立' : '密碼已重設'}</h1>
        <p class="muted">把下面資料交給對方。這組密碼只會顯示今次，離開頁面後不會再看到。</p>
        <div class="stack">
          <div>
            <p class="muted small">名稱</p>
            <p class="strong">${name}</p>
          </div>
          <div>
            <p class="muted small">角色</p>
            <p>${role === 'admin' ? '管理員' : '工作人員'}</p>
          </div>
          <div>
            <p class="muted small">登入密碼</p>
            <div class="copybox">
              <input class="copy-target" value="${password}" readonly aria-label="新密碼">
              <button class="btn btn-sm" type="button" data-copy>複製</button>
            </div>
          </div>
          <div class="form-actions">
            <a class="btn btn-primary" href="/users">返回職員列表</a>
            <a class="btn btn-ghost" href="/login" target="_blank" rel="noreferrer">登入頁</a>
          </div>
        </div>
      </section>
    `,
  });
}

/** 重設密碼：可自訂，或由系統自動產生（兩個明確的按鈕，不需要 JS）。 */
export function passwordFormPage({ user, target, csrfToken = '', error = '' }) {
  return page({
    title: `重設密碼 · ${target.name}`,
    user,
    active: '/users',
    csrfToken,
    flash: error ? { type: 'err', text: error } : null,
    body: html`
      <p class="crumb"><a href="/">聚會</a> / <a href="/users">職員</a> / 重設密碼</p>
      <div class="page-head">
        <div>
          <h1 class="h1">重設「${target.name}」的密碼</h1>
          <p class="muted">${target.name} 目前的登入會即時失效；若改的是自己，會保留你現在這個登入。</p>
        </div>
        <a class="btn btn-ghost" href="/users">返回</a>
      </div>

      <form method="post" action="/users/${target.id}/password" class="card narrow stack">
        ${csrf(csrfToken)}
        <label class="field">
          <span>新密碼</span>
          <input name="password" type="text" minlength="8" maxlength="128" autocomplete="new-password"
                 placeholder="自訂密碼，最少 8 個字元">
          <small class="muted">想自己定就填上面；不想煩就按下面的「自動產生」。</small>
        </label>
        <div class="form-actions">
          <button class="btn btn-primary" type="submit" name="mode" value="manual">使用這個密碼</button>
          <button class="btn" type="submit" name="mode" value="auto">自動產生</button>
          <a class="btn btn-ghost" href="/users">取消</a>
        </div>
        <p class="hint">自動產生的密碼是 12 碼，會在下一個畫面顯示一次，請即時抄下或複製給對方。</p>
      </form>
    `,
  });
}
