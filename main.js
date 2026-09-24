/* ================================================
   healthy-phd-student-emulator - main.js
   ================================================ */

// ★★ デプロイ後に GAS の ウェブアプリURL をここに貼り付けてください ★★
const GAS_URL = 'https://script.google.com/macros/s/AKfycbws9y-CrIdkmlk8GL4tsZG0q6DqMY3Qk9lyPvkQ0vnFI_p4WPtpGqu8YzM-8yyiGLP2bA/exec';

// ──────────────────────────────────────────────
// API 関数（リトライ付き）
// ──────────────────────────────────────────────

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

function buildPostCard(post, rankNum) {
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
<div class="post-card${rankCardClass}" id="card-${post.id}" onclick="toggleCard('${post.id}')">
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
    <div class="comments-section" id="comments-${post.id}" style="display:none">
      <div class="section-label">💬 コメント</div>
      <div class="comment-list" id="comment-list-${post.id}">
        <div class="loading" style="padding:16px 0"><div class="loading-spinner" style="width:20px;height:20px;border-width:2px"></div></div>
      </div>
      <div class="comment-form">
        <input class="comment-author-input" id="comment-author-${post.id}" placeholder="名前（任意）" onclick="event.stopPropagation()">
        <input class="comment-body-input" id="comment-body-${post.id}" placeholder="コメントを入力…" onclick="event.stopPropagation()">
        <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();submitComment('${post.id}')">送信</button>
      </div>
    </div>
  </div>

  <div class="card-footer" onclick="event.stopPropagation()">
    <div class="card-actions">
      <button class="like-btn${liked ? ' liked' : ''}" id="like-btn-${post.id}" onclick="likePost('${post.id}')" title="${liked ? 'いいねを取り消す' : 'いいねする'}">
        ❤️ <span id="like-count-${post.id}">${post.likes}</span>
      </button>
      <button class="comment-toggle-btn" onclick="toggleComments('${post.id}')">
        💬 コメント
      </button>
    </div>
    <div>
      <a href="edit.html?id=${post.id}" class="btn btn-outline btn-sm" onclick="event.stopPropagation()">✏️ 編集</a>
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

function toggleCard(id) {
  const card = document.getElementById('card-' + id);
  if (!card) return;
  card.classList.toggle('expanded');
}

// ──────────────────────────────────────────────
// コメントトグル
// ──────────────────────────────────────────────

function toggleComments(postId) {
  const section = document.getElementById('comments-' + postId);
  if (!section) return;
  const isHidden = section.style.display === 'none';
  section.style.display = isHidden ? 'block' : 'none';
  if (isHidden) loadComments(postId);
}

async function loadComments(postId) {
  const list = document.getElementById('comment-list-' + postId);
  if (!list) return;
  try {
    const comments = await apiGet({ action: 'getComments', postId });
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

async function submitComment(postId) {
  const authorEl = document.getElementById('comment-author-' + postId);
  const bodyEl = document.getElementById('comment-body-' + postId);
  const body = bodyEl.value.trim();

  if (!body) { showToast('コメントを入力してください', 'error'); return; }

  try {
    await apiPost({ action: 'addComment', postId, author: authorEl.value.trim() || '匿名', body });
    authorEl.value = '';
    bodyEl.value = '';
    loadComments(postId);
    showToast('コメントを投稿しました 💬');
  } catch (e) {
    showToast('送信に失敗しました', 'error');
  }
}

// ──────────────────────────────────────────────
// いいね
// ──────────────────────────────────────────────

async function likePost(id) {
  const btn = document.getElementById('like-btn-' + id);
  const alreadyLiked = isLiked(id);

  // APIコール中は重複送信を防ぐためボタンを無効化
  if (btn) btn.disabled = true;

  try {
    if (alreadyLiked) {
      // ── いいね取り消し ──
      const res = await apiPost({ action: 'unlikePost', id });
      if (res.success) {
        unsetLikedPost(id);
        const count = document.getElementById('like-count-' + id);
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
        const count = document.getElementById('like-count-' + id);
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

async function loadLatestPosts() {
  const container = document.getElementById('latest-posts');
  if (!container) return;

  container.innerHTML = '<div class="loading"><div class="loading-spinner"></div>読み込み中…</div>';
  try {
    const posts = await apiGet({ action: 'getPosts' });
    if (!posts.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div>まだ投稿がありません。最初の投稿をしてみましょう！</div>';
      return;
    }
    container.innerHTML = '<div class="posts-grid">' + posts.map(p => buildPostCard(p)).join('') + '</div>';
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><p>データの読み込みに失敗しました。</p><p style="font-size:12px;margin-top:8px">GAS_URLが正しく設定されているか確認してください。</p></div>`;
  }
}

// ──────────────────────────────────────────────
// タグ検索
// ──────────────────────────────────────────────

async function doSearch() {
  const input = document.getElementById('search-input');
  const container = document.getElementById('search-results');
  if (!input || !container) return;

  const tag = input.value.trim();
  container.innerHTML = '<div class="loading"><div class="loading-spinner"></div>検索中…</div>';

  try {
    const posts = await apiGet({ action: 'searchByTag', tag });
    if (!posts.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔍</div>「${escHtml(tag)}」に一致する投稿がありません</div>`;
      return;
    }
    container.innerHTML = '<div class="posts-grid">' + posts.map(p => buildPostCard(p)).join('') + '</div>';
  } catch (e) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚠️</div>検索に失敗しました</div>';
  }
}

// ──────────────────────────────────────────────
// いいねランキング
// ──────────────────────────────────────────────

async function loadRanking() {
  const container = document.getElementById('ranking-posts');
  if (!container) return;

  container.innerHTML = '<div class="loading"><div class="loading-spinner"></div>読み込み中…</div>';
  try {
    const posts = await apiGet({ action: 'getRanking' });
    if (!posts.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🏆</div>まだ投稿がありません</div>';
      return;
    }
    container.innerHTML = '<div class="posts-grid">' + posts.map((p, i) => buildPostCard(p, i + 1)).join('') + '</div>';
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
    const posts = await apiGet({ action: 'getPosts' });
    const post = posts.find(p => p.id === id);
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
    // タブボタン
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.tab;
        switchTab(name);
        if (name === 'latest') loadLatestPosts();
        if (name === 'ranking') loadRanking();
      });
    });

    // Enterキーで検索
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    }

    // URLパラメータでタブ指定
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab') || 'latest';
    switchTab(tab);

    if (tab === 'search') {
      const tag = params.get('tag');
      if (tag && searchInput) {
        searchInput.value = tag;
        doSearch();
      } else {
        loadLatestPosts(); // fallback
      }
    } else if (tab === 'ranking') {
      loadRanking();
    } else {
      loadLatestPosts();
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

