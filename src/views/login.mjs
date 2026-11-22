import { html } from '../lib/html.mjs';
import { page, flashFrom } from './ui.mjs';

export function loginPage({ query, next = '/', error = '', name = '' }) {
  return page({
    title: '登入',
    flash: null,
    body: html`<section class="card narrow auth-card">
      <h1 class="h1">工作人員登入</h1>
      <p class="muted">用你的名字與密碼登入。忘記密碼請找管理員重設。</p>
      ${error ? html`<div class="flash flash-err">${error}</div>` : ''}
      <form method="post" action="/login" class="stack">
        <input type="hidden" name="next" value="${next}">
        <label class="field">
          <span>名稱</span>
          <input name="name" value="${name}" autocomplete="username" required autofocus>
        </label>
        <label class="field">
          <span>密碼</span>
          <input name="password" type="password" autocomplete="current-password" required>
        </label>
        <button class="btn btn-primary btn-block" type="submit">登入</button>
      </form>
      <p class="hint">${flashFrom(query)?.text || ''}</p>
    </section>`,
  });
}
