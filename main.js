/* ================================================
   healthy-phd-student-emulator - main.js
   ================================================ */

// ★★ デプロイ後に GAS の ウェブアプリURL をここに貼り付けてください ★★
const GAS_URL = 'https://script.google.com/macros/s/AKfycbws9y-CrIdkmlk8GL4tsZG0q6DqMY3Qk9lyPvkQ0vnFI_p4WPtpGqu8YzM-8yyiGLP2bA/exec';

// ──────────────────────────────────────────────
// ページネーション グローバル状態
// ──────────────────────────────────────────────

let pageSize = 20; // ページあたりの表示件数

// 各タブの現在ページ（ゼロ始まり）
const tabPage = { latest: 0, search: 0, ranking: 0, commentRanking: 0 };

// 検索タブの現在ソート順
let searchSort = 'newest'; // 'newest' | 'likes' | 'comments'


// 指数バックオフでリトライ (最大 MAX_RETRIES 回)
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 800; // 最初の待機時間 (ms)

async function fetchWithRetry(fetchFn) {
  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetchFn();
      // GAS がリダイレクト後に 200 以外を返す場合もリトライ
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      // GAS が { error: '...' } を返した場合もエラー扱い
      if (json && json.error) throw new Error(json.error);
      return json;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES - 1) {
        // 指数バックオフ: 800ms → 1600ms → 3200ms
        await new Promise(r => setTimeout(r, RETRY_BASE_MS * Math.pow(2, attempt)));
      }
    }
  }
  throw lastErr;
}

async function apiGet(params) {
  const url = new URL(GAS_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return fetchWithRetry(() => fetch(url.toString(), { redirect: 'follow' }));
}

async function apiPost(data) {
  // GAS は Content-Type: application/json への preflight (OPTIONS) に対応していないため
  // URLSearchParams でフォーム送信する（simple request = preflight なし）
  const params = new URLSearchParams();
  params.append('payload', JSON.stringify(data));
  return fetchWithRetry(() => fetch(GAS_URL, {
    method: 'POST',
    body: params,
    redirect: 'follow'
  }));
}

// ──────────────────────────────────────────────
// トースト通知
// ──────────────────────────────────────────────

function showToast(msg, type = 'success') {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  void toast.offsetWidth; // reflow
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 3000);
}

// ──────────────────────────────────────────────
// セッションストレージ: いいね済み管理
// （タブを閉じるとリセット → 開くたびに1回いいね可能、再度押すと取り消し可能）
// ──────────────────────────────────────────────

function getLikedPosts() {
  return JSON.parse(sessionStorage.getItem('liked_posts') || '[]');
}

function setLikedPost(id) {
  const liked = getLikedPosts();
  if (!liked.includes(id)) {
    liked.push(id);
    sessionStorage.setItem('liked_posts', JSON.stringify(liked));
  }
}

function unsetLikedPost(id) {
  const liked = getLikedPosts().filter(x => x !== id);
  sessionStorage.setItem('liked_posts', JSON.stringify(liked));
}

function isLiked(id) {
  return getLikedPosts().includes(id);
}

// ──────────────────────────────────────────────
// 日付フォーマット
// ──────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ──────────────────────────────────────────────
// タグ文字列をバッジ配列に変換
// ──────────────────────────────────────────────

function parseTags(tagStr) {
  if (!tagStr) return [];
  // 空白・カンマ・+ のいずれでも分割（例: "#発表+#B4+#卒業研究" にも対応）
  return tagStr.split(/[\s,+]+/).filter(Boolean).map(t => t.startsWith('#') ? t : '#' + t);
}

// ──────────────────────────────────────────────
// 投稿カードのHTMLを生成
// ──────────────────────────────────────────────

// tabId: カードが属するタブを識別するプレフィックス（'latest' | 'search' | 'ranking'）
// 同じ投稿が複数タブに表示されても要素IDが重複しないようにするため
function buildPostCard(post, rankNum, tabId) {
  const uid = tabId ? `${tabId}-${post.id}` : post.id; // 要素ID用ユニークキー
  const tags = parseTags(post.tags);
  const liked = isLiked(post.id);
  const tagBadges = tags.map(t =>
    `<span class="tag" onclick="event.stopPropagation();searchTag('${t}')">${t}</span>`
  ).join('');

  let rankBadgeHtml = '';
  if (rankNum !== undefined) {
    const cls = rankNum <= 3 ? `rank-${rankNum}` : 'rank-other';
    rankBadgeHtml = `<span class="rank-badge ${cls}">${rankNum}</span>`;
  }

  const rankCardClass = rankNum !== undefined && rankNum <= 3 ? ` rank-${rankNum}` : '';

  // プレビュー：whatToDo を要約として表示
  const preview = post.whatToDo
    ? `💡 ${post.whatToDo.slice(0, 120)}${post.whatToDo.length > 120 ? '…' : ''}`
    : (post.what || '').slice(0, 100);

  return `
<div class="post-card${rankCardClass}" id="card-${uid}" onclick="toggleCard('${uid}')">
  <div class="card-header">
    ${rankBadgeHtml}
    <div class="card-header-text">
      <div class="card-title">${escHtml(post.title || '（タイトルなし）')}</div>
      <div class="card-tags">${tagBadges || '<span style="color:var(--text-sub);font-size:12px">タグなし</span>'}</div>
      <div class="card-meta">投稿日: ${formatDate(post.createdAt)}${post.updatedAt !== post.createdAt ? ' （編集済み）' : ''}</div>
    </div>
  </div>

  <div class="post-preview">${escHtml(preview)}</div>

  <div class="post-detail">
    <div class="detail-section">
      <div class="section-label">📋 5W1H + Then</div>
      <div class="w5h1-grid">
        ${buildW5H1Item('When（いつ）', post.when)}
        ${buildW5H1Item('Who（誰が）', post.who)}
        ${buildW5H1Item('Where（どこで）', post.where)}
        ${buildW5H1Item('What（何を）', post.what)}
        ${buildW5H1Item('Why（なぜ）', post.why)}
        ${buildW5H1Item('How（どうやって）', post.how)}
        ${buildW5H1Item('Then（その結果）', post.then)}
      </div>
    </div>

    ${post.prerequisites ? `
    <div class="detail-section">
      <div class="section-label">📌 前提条件</div>
      <div class="prerequisites-box">${escHtml(post.prerequisites)}</div>
    </div>` : ''}

    <div class="detail-section">
      <div class="section-label">✅ どうすればよかったか</div>
      <div class="what-to-do-box">${escHtml(post.whatToDo)}</div>
    </div>

    ${post.notes ? `
    <div class="detail-section">
      <div class="section-label">📝 備考</div>
      <div class="notes-box">${escHtml(post.notes)}</div>
    </div>` : ''}

    <!-- コメントセクション -->
    <div class="comments-section" id="comments-${uid}" style="display:none">
      <div class="section-label">💬 コメント</div>
      <div class="comment-list" id="comment-list-${uid}">
        <div class="loading" style="padding:16px 0"><div class="loading-spinner" style="width:20px;height:20px;border-width:2px"></div></div>
      </div>
      <div class="comment-form">
        <input class="comment-author-input" id="comment-author-${uid}" placeholder="名前（任意）" onclick="event.stopPropagation()">
        <input class="comment-body-input" id="comment-body-${uid}" placeholder="コメントを入力…" onclick="event.stopPropagation()">
        <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();submitComment('${post.id}','${uid}')">送信</button>
      </div>
    </div>
  </div>

  <div class="card-footer" onclick="event.stopPropagation()">
    <div class="card-actions">
      <button class="like-btn${liked ? ' liked' : ''}" id="like-btn-${uid}" onclick="likePost('${post.id}','${uid}')" title="${liked ? 'いいねを取り消す' : 'いいねする'}">
        ❤️ <span id="like-count-${uid}">${post.likes}</span>
      </button>
      <button class="comment-toggle-btn" id="comment-toggle-${uid}" onclick="toggleComments('${post.id}','${uid}')">
        💬 <span id="comment-count-${uid}">…</span>
      </button>
    </div>
    <div class="card-edit-actions">
      <a href="edit.html?id=${post.id}" class="btn btn-outline btn-sm" onclick="event.stopPropagation()">✏️ 編集</a>
      <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deletePost('${post.id}','${uid}')">🗑️ 削除</button>
    </div>
  </div>
</div>`;
}

function buildW5H1Item(label, value) {
  if (!value) return '';
  return `<div class="w5h1-item"><div class="w5h1-label">${label}</div><div class="w5h1-value">${escHtml(value)}</div></div>`;
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}

// ──────────────────────────────────────────────
// カード展開/折りたたみ
// ──────────────────────────────────────────────

// uid = tabId-postId（または後方互換のために postId のみ）
function toggleCard(uid) {
  const card = document.getElementById('card-' + uid);
  if (!card) return;
  card.classList.toggle('expanded');
}

// ──────────────────────────────────────────────
// コメントトグル
// ──────────────────────────────────────────────

// uid = tabId-postId。コメントの実データ取得には postId を使う
function toggleComments(postId, uid) {
  const key = uid || postId;
  const section = document.getElementById('comments-' + key);
  if (!section) return;
  const isHidden = section.style.display === 'none';
  section.style.display = isHidden ? 'block' : 'none';
  if (isHidden) loadComments(postId, key);
}

// uid = tabId-postId（要素ID特定用）
async function loadComments(postId, uid) {
  const key = uid || postId;
  const list = document.getElementById('comment-list-' + key);
  if (!list) return;
  try {
    const comments = await apiGet({ action: 'getComments', postId });
    updateCommentCount(key, comments.length);
    if (!comments.length) {
      list.innerHTML = '<div style="color:var(--text-sub);font-size:13px;padding:8px 0">まだコメントはありません</div>';
      return;
    }
    list.innerHTML = comments.map(c => `
      <div class="comment-item">
        <div class="comment-author">${escHtml(c.author)}<span class="comment-date">${formatDate(c.createdAt)}</span></div>
        <div class="comment-body">${escHtml(c.body)}</div>
      </div>
    `).join('');
  } catch (e) {
    list.innerHTML = '<div style="color:var(--danger);font-size:13px">コメントの読み込みに失敗しました</div>';
  }
}

function updateCommentCount(uid, count) {
  const el = document.getElementById('comment-count-' + uid);
  if (!el) return;
  el.textContent = `${count} 件`;
}

// ──────────────────────────────────────────────
// 全カードのコメント数を一括取得して表示
// ──────────────────────────────────────────────

async function loadCommentCountsForPosts() {
  // 現在表示されているすべての comment-count 要素を収集
  // id形式: comment-count-{tabId}-{postId} または comment-count-{postId}
  const allUids = Array.from(document.querySelectorAll('[id^="comment-count-"]'))
    .map(el => el.id.replace('comment-count-', ''));

  try {
    const counts = await apiGet({ action: 'getCommentCounts' });
    // counts のキーは postId。uid から postId を抽出して件数を反映
    allUids.forEach(uid => {
      // uid = 'latest-abc123' or 'search-abc123' or 'ranking-abc123' or 'abc123'
      const postId = uid.replace(/^(latest|search|ranking)-/, '');
      updateCommentCount(uid, counts[postId] || 0);
    });
  } catch (e) {
    // コメント数取得失敗時は「?」を表示
    allUids.forEach(uid => {
      const el = document.getElementById('comment-count-' + uid);
      if (el) el.textContent = '?';
    });
  }
}

// uid = tabId-postId（要素ID特定用）
async function submitComment(postId, uid) {
  const key = uid || postId;
  const authorEl = document.getElementById('comment-author-' + key);
  const bodyEl = document.getElementById('comment-body-' + key);
  const body = bodyEl.value.trim();

  if (!body) { showToast('コメントを入力してください', 'error'); return; }

  try {
    await apiPost({ action: 'addComment', postId, author: authorEl.value.trim() || '匿名', body });
    authorEl.value = '';
    bodyEl.value = '';
    await loadComments(postId, key);
    showToast('コメントを投稿しました 💬');
  } catch (e) {
    showToast('送信に失敗しました', 'error');
  }
}

// ──────────────────────────────────────────────
// 投稿削除
// ──────────────────────────────────────────────

// uid = tabId-postId（要素ID特定用）
async function deletePost(id, uid) {
  if (!confirm('この投稿を削除しますか？\nこの操作は取り消せません。')) return;

  const key = uid || id;
  const card = document.getElementById('card-' + key);
  if (card) {
    card.style.opacity = '0.5';
    card.style.pointerEvents = 'none';
  }

  try {
    const res = await apiPost({ action: 'deletePost', id });
    if (res.success) {
      showToast('投稿を削除しました 🗑️');
      if (card) {
        card.style.transition = 'all 0.4s ease';
        card.style.transform = 'scale(0.95)';
        card.style.opacity = '0';
        setTimeout(() => card.remove(), 400);
      }
    } else {
      throw new Error(res.error || '削除に失敗しました');
    }
  } catch (e) {
    showToast('削除に失敗しました: ' + e.message, 'error');
    if (card) {
      card.style.opacity = '1';
      card.style.pointerEvents = '';
    }
  }
}

// ──────────────────────────────────────────────
// いいね
// ──────────────────────────────────────────────

// uid = tabId-postId（要素ID特定用）
async function likePost(id, uid) {
  const key = uid || id;
  const btn = document.getElementById('like-btn-' + key);
  const alreadyLiked = isLiked(id);

  // APIコール中は重複送信を防ぐためボタンを無効化
  if (btn) btn.disabled = true;

  try {
    if (alreadyLiked) {
      // ── いいね取り消し ──
      const res = await apiPost({ action: 'unlikePost', id });
      if (res.success) {
        unsetLikedPost(id);
        const count = document.getElementById('like-count-' + key);
        if (btn) {
          btn.classList.remove('liked');
          btn.title = 'いいねする';
        }
        if (count) count.textContent = res.likes;
        showToast('いいねを取り消しました');
      }
    } else {
      // ── いいね追加 ──
      const res = await apiPost({ action: 'likePost', id });
      if (res.success) {
        setLikedPost(id);
        const count = document.getElementById('like-count-' + key);
        if (btn) {
          btn.classList.add('liked');
          btn.title = 'いいねを取り消す';
        }
        if (count) count.textContent = res.likes;
        showToast('いいねしました ❤️');
      }
    }
  } catch (e) {
    showToast(alreadyLiked ? '取り消しに失敗しました' : 'いいねに失敗しました', 'error');
  } finally {
    // 成功・失敗いずれもボタンを再度有効化
    if (btn) btn.disabled = false;
  }
}

// ──────────────────────────────────────────────
// タグクリックで検索タブに移動して検索
// ──────────────────────────────────────────────

function searchTag(tag) {
  // index.html の検索タブに切り替えて検索
  const searchTab = document.getElementById('tab-search');
  if (searchTab) {
    switchTab('search');
    const input = document.getElementById('search-input');
    if (input) {
      input.value = tag;
      doSearch();
    }
  } else {
    // 別ページから呼ばれた場合: index.html に遷移
    window.location.href = `index.html?tab=search&tag=${encodeURIComponent(tag)}`;
  }
}

// ──────────────────────────────────────────────
// タブ切り替え（index.html）
// ──────────────────────────────────────────────

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const btn = document.getElementById('tab-' + name);
  const panel = document.getElementById('panel-' + name);
  if (btn) btn.classList.add('active');
  if (panel) panel.classList.add('active');
}

// ──────────────────────────────────────────────
// 投稿一覧を表示 (index.html)
// ──────────────────────────────────────────────

// ──────────────────────────────────────────────
// ページネーション UI 生成
// total: 全件数, page: 現在ページ(0始まり), size: ページあたり件数
// onPageChange(newPage): ページ変更コールバック
// ──────────────────────────────────────────────

function buildPagination(total, page, size, onPageChange) {
  const totalPages = Math.ceil(total / size);
  if (totalPages <= 1) return '';

  const from = page * size + 1;
  const to   = Math.min((page + 1) * size, total);

  // 表示するページ番号の範囲（現在ページを中心に最大10個）
  const windowSize = 5;
  let startPage = Math.max(0, page - Math.floor(windowSize / 2));
  let endPage   = Math.min(totalPages - 1, startPage + windowSize - 1);
  if (endPage - startPage < windowSize - 1) startPage = Math.max(0, endPage - windowSize + 1);

  const buttons = [];

  // 前ページ
  buttons.push(
    `<button class="page-btn page-nav" ${page === 0 ? 'disabled' : ''} onclick="(${onPageChange})(${page - 1})">❮</button>`
  );

  // 先頭に飛ぶ
  if (startPage > 0) {
    buttons.push(`<button class="page-btn" onclick="(${onPageChange})(0)">1</button>`);
    if (startPage > 1) buttons.push('<span class="page-ellipsis">⋯</span>');
  }

  // ページ番号ボタン
  for (let i = startPage; i <= endPage; i++) {
    buttons.push(
      `<button class="page-btn${i === page ? ' active' : ''}" onclick="(${onPageChange})(${i})">${i + 1}</button>`
    );
  }

  // 末尾に飛ぶ
  if (endPage < totalPages - 1) {
    if (endPage < totalPages - 2) buttons.push('<span class="page-ellipsis">⋯</span>');
    buttons.push(`<button class="page-btn" onclick="(${onPageChange})(${totalPages - 1})">${totalPages}</button>`);
  }

  // 次ページ
  buttons.push(
    `<button class="page-btn page-nav" ${page === totalPages - 1 ? 'disabled' : ''} onclick="(${onPageChange})(${page + 1})">❯</button>`
  );

  return `
<div class="pagination">
  <div class="pagination-info">${from}–${to} / 全${total}件</div>
  <div class="pagination-btns">${buttons.join('')}</div>
</div>`;
}

// ──────────────────────────────────────────────
// 投稿一覧を表示 (index.html)
// ──────────────────────────────────────────────

async function loadLatestPosts(page) {
  if (page === undefined) page = tabPage.latest;
  tabPage.latest = page;
  const container = document.getElementById('latest-posts');
  if (!container) return;

  container.innerHTML = '<div class="loading"><div class="loading-spinner"></div>読み込み中…</div>';
  try {
    const res = await apiGet({ action: 'getPosts', offset: page * pageSize, limit: pageSize });
    if (!res.items || !res.items.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div>まだ投稿がありません。最初の投稿をしてみましょう！</div>';
      return;
    }
    const cards = res.items.map(p => buildPostCard(p, undefined, 'latest')).join('');
    const pager = buildPagination(res.total, page, pageSize, 'loadLatestPosts');
    container.innerHTML = '<div class="posts-grid">' + cards + '</div>' + pager;
    loadCommentCountsForPosts();
    // ページ切り替え時にスクロールを先頭に戻す
    if (page > 0) container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><p>データの読み込みに失敗しました。</p><p style="font-size:12px;margin-top:8px">GAS_URLが正しく設定されているか確認してください。</p></div>`;
  }
}

// ──────────────────────────────────────────────
// タグ検索
// ──────────────────────────────────────────────

// ──────────────────────────────────────────────
// タグ検索
// ──────────────────────────────────────────────

async function doSearch(page) {
  if (page === undefined) { tabPage.search = 0; page = 0; }
  tabPage.search = page;
  const input = document.getElementById('search-input');
  const container = document.getElementById('search-results');
  if (!input || !container) return;

  const tag = input.value.trim();
  container.innerHTML = '<div class="loading"><div class="loading-spinner"></div>検索中…</div>';

  try {
    const res = await apiGet({ action: 'searchByTag', tag, offset: page * pageSize, limit: pageSize, sort: searchSort });
    if (!res.items || !res.items.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔍</div>「${escHtml(tag)}」に一致する投稿がありません</div>`;
      return;
    }
    const cards = res.items.map(p => buildPostCard(p, undefined, 'search')).join('');
    const pager = buildPagination(res.total, page, pageSize, 'doSearch');
    container.innerHTML = '<div class="posts-grid">' + cards + '</div>' + pager;
    loadCommentCountsForPosts();
    if (page > 0) container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚠️</div>検索に失敗しました</div>';
  }
}

// ──────────────────────────────────────────────
// 検索ソート切り替え
// ──────────────────────────────────────────────

function setSearchSort(sort) {
  searchSort = sort;
  // ソートボタンの見た目を更新
  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sort === sort);
  });
  // ページリセットして再検索
  tabPage.search = 0;
  doSearch(0);
}

// ──────────────────────────────────────────────
// いいねランキング
// ──────────────────────────────────────────────

async function loadRanking(page) {
  if (page === undefined) page = tabPage.ranking;
  tabPage.ranking = page;
  const container = document.getElementById('ranking-posts');
  if (!container) return;

  container.innerHTML = '<div class="loading"><div class="loading-spinner"></div>読み込み中…</div>';
  try {
    const res = await apiGet({ action: 'getRanking', offset: page * pageSize, limit: pageSize });
    if (!res.items || !res.items.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🏆</div>まだ投稿がありません</div>';
      return;
    }
    // ランキング番号は全件数中の順位（offset を考慮）
    const globalOffset = page * pageSize;
    const cards = res.items.map((p, i) => buildPostCard(p, globalOffset + i + 1, 'ranking')).join('');
    const pager = buildPagination(res.total, page, pageSize, 'loadRanking');
    container.innerHTML = '<div class="posts-grid">' + cards + '</div>' + pager;
    loadCommentCountsForPosts();
    if (page > 0) container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚠️</div>読み込みに失敗しました</div>';
  }
}

// ──────────────────────────────────────────────
// コメント数ランキング
// ──────────────────────────────────────────────

async function loadCommentRanking(page) {
  if (page === undefined) page = tabPage.commentRanking;
  tabPage.commentRanking = page;
  const container = document.getElementById('comment-ranking-posts');
  if (!container) return;

  container.innerHTML = '<div class="loading"><div class="loading-spinner"></div>読み込み中…</div>';
  try {
    const res = await apiGet({ action: 'getCommentRanking', offset: page * pageSize, limit: pageSize });
    if (!res.items || !res.items.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💬</div>まだ投稿がありません</div>';
      return;
    }
    const globalOffset = page * pageSize;
    const cards = res.items.map((p, i) => {
      const rankNum = globalOffset + i + 1;
      const uid = `commentranking-${p.id}`;
      const cardHtml = buildPostCard(p, rankNum, 'commentranking');
      return cardHtml;
    }).join('');
    const pager = buildPagination(res.total, page, pageSize, 'loadCommentRanking');
    container.innerHTML = '<div class="posts-grid">' + cards + '</div>' + pager;
    loadCommentCountsForPosts();
    if (page > 0) container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚠️</div>読み込みに失敗しました</div>';
  }
}

// ──────────────────────────────────────────────
// 投稿フォーム送信 (post.html)
// ──────────────────────────────────────────────

async function submitPost(event) {
  event.preventDefault();
  const form = event.target;
  const btn = form.querySelector('[type=submit]');
  btn.disabled = true;
  btn.textContent = '送信中…';

  const data = {
    action: 'createPost',
    title: form.title.value.trim(),
    tags: form.tags.value.trim(),
    when: form.when.value.trim(),
    who: form.who.value.trim(),
    where: form.where.value.trim(),
    what: form.what.value.trim(),
    why: form.why.value.trim(),
    how: form.how.value.trim(),
    then: form.then.value.trim(),
    prerequisites: form.prerequisites.value.trim(),
    whatToDo: form.whatToDo.value.trim(),
    notes: form.notes.value.trim()
  };

  // バリデーション
  if (!data.title || !data.tags || !data.whatToDo) {
    showToast('タイトル・ハッシュタグ・どうすればよかったかは必須です', 'error');
    btn.disabled = false;
    btn.textContent = '投稿する';
    return;
  }

  try {
    const res = await apiPost(data);
    if (res.success) {
      showToast('投稿しました！✨');
      setTimeout(() => { window.location.href = 'index.html'; }, 1200);
    } else {
      throw new Error(res.error);
    }
  } catch (e) {
    showToast('投稿に失敗しました: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = '投稿する';
  }
}

// ──────────────────────────────────────────────
// 編集フォーム初期化 + 送信 (edit.html)
// ──────────────────────────────────────────────

async function initEditForm() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (!id) { window.location.href = 'index.html'; return; }

  document.getElementById('edit-id').value = id;

  try {
    // getPosts はページネーション対応で { items: [...], total: N } を返す。
    // 編集対象は1件だけなので limit=1000 で全件取得して id で絞り込む
    const res = await apiGet({ action: 'getPosts', offset: 0, limit: 1000 });
    const post = (res.items || []).find(p => p.id === id);
    if (!post) { showToast('投稿が見つかりません', 'error'); return; }

    const form = document.getElementById('edit-form');
    form.title.value = post.title || '';
    form.tags.value = post.tags || '';
    form.when.value = post.when || '';
    form.who.value = post.who || '';
    form.where.value = post.where || '';
    form.what.value = post.what || '';
    form.why.value = post.why || '';
    form.how.value = post.how || '';
    form.then.value = post.then || '';
    form.prerequisites.value = post.prerequisites || '';
    form.whatToDo.value = post.whatToDo || '';
    form.notes.value = post.notes || '';
  } catch (e) {
    showToast('データの読み込みに失敗しました', 'error');
  }
}

async function submitEdit(event) {
  event.preventDefault();
  const form = event.target;
  const btn = form.querySelector('[type=submit]');
  btn.disabled = true;
  btn.textContent = '保存中…';

  const data = {
    action: 'updatePost',
    id: form.querySelector('#edit-id').value,
    title: form.title.value.trim(),
    tags: form.tags.value.trim(),
    when: form.when.value.trim(),
    who: form.who.value.trim(),
    where: form.where.value.trim(),
    what: form.what.value.trim(),
    why: form.why.value.trim(),
    how: form.how.value.trim(),
    then: form.then.value.trim(),
    prerequisites: form.prerequisites.value.trim(),
    whatToDo: form.whatToDo.value.trim(),
    notes: form.notes.value.trim()
  };

  try {
    const res = await apiPost(data);
    if (res.success) {
      showToast('保存しました ✅');
      setTimeout(() => { window.location.href = 'index.html'; }, 1200);
    } else {
      throw new Error(res.error);
    }
  } catch (e) {
    showToast('保存に失敗しました: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = '保存する';
  }
}

// ──────────────────────────────────────────────
// ページ初期化
// ──────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // アクティブナビ
  const currentPage = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-link').forEach(a => {
    if (a.getAttribute('href') === currentPage) a.classList.add('active');
  });

  // index.html
  if (currentPage === 'index.html' || currentPage === '') {
    // 件数セレクタの変更イベント
    const pageSizeSelect = document.getElementById('page-size-select');
    if (pageSizeSelect) {
      pageSizeSelect.value = String(pageSize);
      pageSizeSelect.addEventListener('change', () => {
        pageSize = parseInt(pageSizeSelect.value, 10);
        // 各タブをページリセットして再読み込み
        tabPage.latest = 0;
        tabPage.search = 0;
        tabPage.ranking = 0;
        const active = document.querySelector('.tab-btn.active');
        if (active) {
          const name = active.dataset.tab;
          if (name === 'latest')  loadLatestPosts(0);
          if (name === 'search')  doSearch(0);
          if (name === 'ranking') loadRanking(0);
        }
      });
    }

    // タブボタン
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.tab;
        switchTab(name);
        tabPage[name] = 0; // タブ切り替え時は先頭ページに戻す
        if (name === 'latest')          loadLatestPosts(0);
        if (name === 'ranking')         loadRanking(0);
        if (name === 'commentRanking')  loadCommentRanking(0);
      });
    });

    // ソートボタン（検索タブ）
    document.querySelectorAll('.sort-btn').forEach(btn => {
      btn.addEventListener('click', () => setSearchSort(btn.dataset.sort));
    });
    // 初期状態でアクティブなソートボタンを反映
    document.querySelectorAll('.sort-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.sort === searchSort);
    });

    // Enterキーで検索（検索ワード変更時はページリセット）
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(0); });
    }

    // URLパラメータでタブ指定
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab') || 'latest';
    switchTab(tab);

    if (tab === 'search') {
      const tag = params.get('tag');
      if (tag && searchInput) {
        searchInput.value = tag;
        doSearch(0);
      } else {
        loadLatestPosts(0); // fallback
      }
    } else if (tab === 'ranking') {
      loadRanking(0);
    } else if (tab === 'commentRanking') {
      loadCommentRanking(0);
    } else {
      loadLatestPosts(0);
    }
  }

  // post.html
  if (currentPage === 'post.html') {
    const form = document.getElementById('post-form');
    if (form) form.addEventListener('submit', submitPost);
  }

  // edit.html
  if (currentPage === 'edit.html') {
    initEditForm();
    const form = document.getElementById('edit-form');
    if (form) form.addEventListener('submit', submitEdit);
  }
});

