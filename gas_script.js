// ========================================================
// healthy-phd-student-emulator - Google Apps Script
// ========================================================
// 【使い方】
// 1. Google スプレッドシートを新規作成
// 2. 拡張機能 → Apps Script を開く
// 3. このコードを貼り付けて保存
// 4. デプロイ → 新しいデプロイ → ウェブアプリ
//    - 実行するユーザー: 自分
//    - アクセスできるユーザー: 全員
// 5. デプロイURLをコピーして、main.js の GAS_URL に貼り付ける
// ========================================================

const SHEET_NAME_POSTS = 'posts';
const SHEET_NAME_COMMENTS = 'comments';

// ──────────────────────────────────────────────
// スプレッドシートの初期化（initSheets を手動実行してください）
// ──────────────────────────────────────────────
function initSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // posts シート
  let postsSheet = ss.getSheetByName(SHEET_NAME_POSTS);
  if (!postsSheet) {
    postsSheet = ss.insertSheet(SHEET_NAME_POSTS);
    postsSheet.appendRow([
      'id', 'createdAt', 'updatedAt',
      'title',
      'tags',
      'when', 'who', 'where', 'what', 'why', 'how', 'then',
      'prerequisites', 'whatToDo', 'notes',
      'likes'
    ]);
    postsSheet.setFrozenRows(1);
  }

  // comments シート
  let commentsSheet = ss.getSheetByName(SHEET_NAME_COMMENTS);
  if (!commentsSheet) {
    commentsSheet = ss.insertSheet(SHEET_NAME_COMMENTS);
    commentsSheet.appendRow(['id', 'postId', 'createdAt', 'author', 'body']);
    commentsSheet.setFrozenRows(1);
  }
}

// ──────────────────────────────────────────────
// GET リクエスト処理
// ──────────────────────────────────────────────
function doGet(e) {
  try {
    const action = e.parameter.action || 'getPosts';

    if (action === 'getPosts') {
      const offset = parseInt(e.parameter.offset || '0', 10);
      const limit  = parseInt(e.parameter.limit  || '20', 10);
      return jsonResponse(getPosts(offset, limit));
    }
    if (action === 'getRanking') {
      const offset = parseInt(e.parameter.offset || '0', 10);
      const limit  = parseInt(e.parameter.limit  || '20', 10);
      return jsonResponse(getRanking(offset, limit));
    }
    if (action === 'getCommentRanking') {
      const offset = parseInt(e.parameter.offset || '0', 10);
      const limit  = parseInt(e.parameter.limit  || '20', 10);
      return jsonResponse(getCommentRanking(offset, limit));
    }
    if (action === 'searchByTag') {
      const offset = parseInt(e.parameter.offset || '0', 10);
      const limit  = parseInt(e.parameter.limit  || '20', 10);
      const sort   = e.parameter.sort || 'newest';
      return jsonResponse(searchByTag(e.parameter.tag || '', offset, limit, sort));
    }
    if (action === 'getPostById') return jsonResponse(getPostById(e.parameter.id || ''));
    if (action === 'getComments') return jsonResponse(getComments(e.parameter.postId));
    if (action === 'getCommentCounts') return jsonResponse(getCommentCounts());

    return jsonResponse({ error: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ──────────────────────────────────────────────
// POST リクエスト処理
// ──────────────────────────────────────────────
function doPost(e) {
  try {
    // main.js は URLSearchParams で payload=<JSON文字列> として送信する
    // e.postData.contents は "payload=%7B%22action%22%3A...%7D" の形になる
    let rawContents = e.postData.contents || '';
    let data;
    if (rawContents.startsWith('payload=')) {
      // フォームエンコード形式: payload=<URLエンコードされたJSON>
      // URLSearchParams では スペースが + にエンコードされるため、
      // decodeURIComponent の前に + → スペース に置換する必要がある
      const encoded = rawContents.slice('payload='.length).replace(/\+/g, ' ');
      const jsonStr = decodeURIComponent(encoded);
      data = JSON.parse(jsonStr);
    } else {
      // 念のため生JSONもサポート
      data = JSON.parse(rawContents);
    }
    const action = data.action;

    if (action === 'createPost') return jsonResponse(createPost(data));
    if (action === 'updatePost') return jsonResponse(updatePost(data));
    if (action === 'deletePost') return jsonResponse(deletePost(data.id));
    if (action === 'likePost') return jsonResponse(likePost(data.id));
    if (action === 'unlikePost') return jsonResponse(unlikePost(data.id));
    if (action === 'addComment') return jsonResponse(addComment(data));

    return jsonResponse({ error: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ──────────────────────────────────────────────
// 投稿一覧を取得（最新順、offset/limit でページネーション対応）
// ──────────────────────────────────────────────
function getPosts(offset, limit) {
  offset = offset || 0;
  limit  = limit  || 20;
  const sorted = getPostRows().reverse();
  const total  = sorted.length;
  const items  = sorted.slice(offset, offset + limit);
  return { items, total, hasMore: offset + limit < total, offset };
}

// ──────────────────────────────────────────────
// いいねランキング（offset/limit でページネーション対応）
// ──────────────────────────────────────────────
function getRanking(offset, limit) {
  offset = offset || 0;
  limit  = limit  || 20;
  const sorted = getPostRows().sort((a, b) => b.likes - a.likes);
  const total  = sorted.length;
  const items  = sorted.slice(offset, offset + limit);
  return { items, total, hasMore: offset + limit < total, offset };
}

// ──────────────────────────────────────────────
// コメント数ランキング（offset/limit でページネーション対応）
// ──────────────────────────────────────────────
function getCommentRanking(offset, limit) {
  offset = offset || 0;
  limit  = limit  || 20;
  const counts = getCommentCounts();
  const sorted = getPostRows().sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0));
  const total  = sorted.length;
  const items  = sorted.slice(offset, offset + limit).map(p => ({
    ...p,
    commentCount: counts[p.id] || 0
  }));
  return { items, total, hasMore: offset + limit < total, offset };
}

// ──────────────────────────────────────────────
// タグ検索（複数タグOR検索対応、offset/limit、sort でページネーション・ソート対応）
// sort: 'newest'（新着順）| 'likes'（いいね順）| 'comments'（コメント数順）
// ──────────────────────────────────────────────
function searchByTag(tag, offset, limit, sort) {
  offset = offset || 0;
  limit  = limit  || 20;
  sort   = sort   || 'newest';
  const rows = getPostRows();
  let filtered;
  if (!tag) {
    filtered = rows.slice(); // コピー
  } else {
    // 入力を空白・カンマ・+ で分割して複数タグに対応（例: "#発表 #B4 #卒業研究" や "#発表+#B4+#卒業研究"）
    const queryTags = tag.toLowerCase().split(/[\s,+]+/).filter(Boolean).map(t => t.replace(/^#/, ''));
    filtered = rows.filter(r => {
      // 投稿のタグ一覧（空白・カンマ・+ のいずれでも分割）
      const postTags = r.tags.toLowerCase().split(/[\s,+]+/).filter(Boolean).map(t => t.replace(/^#/, ''));
      // 検索タグのうち1つでもマッチすれば表示（OR検索）
      return queryTags.some(q => postTags.includes(q));
    });
  }

  // ── ソート ──
  if (sort === 'likes') {
    filtered.sort((a, b) => b.likes - a.likes);
  } else if (sort === 'comments') {
    const counts = getCommentCounts();
    filtered.sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0));
  } else {
    // newest: 新着順（createdAt 降順）
    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  const total = filtered.length;
  const items = filtered.slice(offset, offset + limit);
  // コメント数順の場合はコメント数も付加
  if (sort === 'comments') {
    const counts = getCommentCounts();
    return { items: items.map(p => ({ ...p, commentCount: counts[p.id] || 0 })), total, hasMore: offset + limit < total, offset };
  }
  return { items, total, hasMore: offset + limit < total, offset };
}

// ──────────────────────────────────────────────
// 次の連番 ID を返す（既存の数値IDの最大値+1）
// ──────────────────────────────────────────────
function getNextPostId() {
  const rows = getPostRows();
  if (!rows.length) return '1';
  let maxNum = 0;
  rows.forEach(r => {
    const n = parseInt(r.id, 10);
    if (!isNaN(n) && n > maxNum) maxNum = n;
  });
  return String(maxNum + 1);
}

// ──────────────────────────────────────────────
// IDで1件の投稿を取得（文字列・数値どちらでも一致）
// ──────────────────────────────────────────────
function getPostById(id) {
  if (!id) return { error: 'id is required' };
  const rows = getPostRows();
  // 文字列として完全一致、または数値として一致（'3' と 3 を同一視）
  const post = rows.find(r => String(r.id) === String(id));
  if (!post) return { error: 'Post not found' };
  return { item: post };
}

// ──────────────────────────────────────────────
// 投稿を作成
// ──────────────────────────────────────────────
function createPost(data) {
  const sheet = getSheet(SHEET_NAME_POSTS);
  const id = getNextPostId(); // 連番ID（1, 2, 3, ...）
  const now = new Date().toISOString();

  sheet.appendRow([
    id, now, now,
    data.title || '',
    data.tags || '',
    data.when || '',
    data.who || '',
    data.where || '',
    data.what || '',
    data.why || '',
    data.how || '',
    data.then || '',
    data.prerequisites || '',
    data.whatToDo || '',
    data.notes || '',
    0
  ]);
  invalidateCache();
  return { success: true, id };
}

// ──────────────────────────────────────────────
// 投稿を編集
// ──────────────────────────────────────────────
function updatePost(data) {
  const sheet = getSheet(SHEET_NAME_POSTS);
  const rows = sheet.getDataRange().getValues();
  const now = new Date().toISOString();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.id)) {
      const rowNum = i + 1;
      // 一括で書き込み（setValues）で高速化
      sheet.getRange(rowNum, 3, 1, 13).setValues([[
        now,
        data.title || '',
        data.tags || '',
        data.when || '',
        data.who || '',
        data.where || '',
        data.what || '',
        data.why || '',
        data.how || '',
        data.then || '',
        data.prerequisites || '',
        data.whatToDo || '',
        data.notes || ''
      ]]);
      invalidateCache();
      return { success: true };
    }
  }
  return { error: 'Post not found' };
}

// ──────────────────────────────────────────────
// 投稿を削除（関連コメントも削除）
// ──────────────────────────────────────────────
function deletePost(id) {
  // 投稿を削除
  const postsSheet = getSheet(SHEET_NAME_POSTS);
  const postRows = postsSheet.getDataRange().getValues();
  let deleted = false;

  for (let i = 1; i < postRows.length; i++) {
    if (String(postRows[i][0]) === String(id)) {
      postsSheet.deleteRow(i + 1);
      deleted = true;
      break;
    }
  }

  if (!deleted) return { error: 'Post not found' };

  // 関連コメントを削除（後ろから削除して行ずれを防ぐ）
  const commentsSheet = getSheet(SHEET_NAME_COMMENTS);
  const commentRows = commentsSheet.getDataRange().getValues();
  const toDelete = [];

  for (let i = 1; i < commentRows.length; i++) {
    if (String(commentRows[i][1]) === String(id)) toDelete.push(i + 1);
  }

  // 行番号の大きい方から削除
  for (let j = toDelete.length - 1; j >= 0; j--) {
    commentsSheet.deleteRow(toDelete[j]);
  }

  invalidateCache();
  return { success: true };
}

// ──────────────────────────────────────────────
// いいねを追加
// ──────────────────────────────────────────────
function likePost(id) {
  const sheet = getSheet(SHEET_NAME_POSTS);
  const rows = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      const current = Number(rows[i][15]) || 0;
      sheet.getRange(i + 1, 16).setValue(current + 1);
      invalidateCache();
      return { success: true, likes: current + 1 };
    }
  }
  return { error: 'Post not found' };
}

// ──────────────────────────────────────────────
// いいねを取り消す
// ──────────────────────────────────────────────
function unlikePost(id) {
  const sheet = getSheet(SHEET_NAME_POSTS);
  const rows = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      const current = Number(rows[i][15]) || 0;
      // 0未満にはしない
      const newVal = Math.max(0, current - 1);
      sheet.getRange(i + 1, 16).setValue(newVal);
      invalidateCache();
      return { success: true, likes: newVal };
    }
  }
  return { error: 'Post not found' };
}

// ──────────────────────────────────────────────
// コメントを取得
// ──────────────────────────────────────────────
function getComments(postId) {
  const sheet = getSheet(SHEET_NAME_COMMENTS);
  const rows = sheet.getDataRange().getValues();
  const result = [];

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) === String(postId)) {
      result.push({
        id: rows[i][0],
        postId: rows[i][1],
        createdAt: rows[i][2],
        author: rows[i][3],
        body: rows[i][4]
      });
    }
  }
  return result;
}

// ──────────────────────────────────────────────
// 全投稿のコメント数を { postId: count } の形で返す
// ──────────────────────────────────────────────
function getCommentCounts() {
  const sheet = getSheet(SHEET_NAME_COMMENTS);
  const rows = sheet.getDataRange().getValues();
  const counts = {};

  for (let i = 1; i < rows.length; i++) {
    const postId = rows[i][1];
    if (!postId) continue;
    counts[postId] = (counts[postId] || 0) + 1;
  }
  return counts;
}

// ──────────────────────────────────────────────
// 次のコメント連番 ID を返す（既存の数値IDの最大値+1）
// ──────────────────────────────────────────────
function getNextCommentId() {
  const sheet = getSheet(SHEET_NAME_COMMENTS);
  const rows = sheet.getDataRange().getValues();
  let maxNum = 0;
  for (let i = 1; i < rows.length; i++) {
    const n = parseInt(rows[i][0], 10);
    if (!isNaN(n) && n > maxNum) maxNum = n;
  }
  return String(maxNum + 1);
}

// ──────────────────────────────────────────────
// コメントを追加
// ──────────────────────────────────────────────
function addComment(data) {
  const sheet = getSheet(SHEET_NAME_COMMENTS);
  const id = getNextCommentId(); // 連番ID（1, 2, 3, ...）
  const now = new Date().toISOString();

  sheet.appendRow([id, data.postId, now, data.author || '匿名', data.body || '']);
  return { success: true, id };
}

// ──────────────────────────────────────────────
// ヘルパー
// ──────────────────────────────────────────────
function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) { initSheets(); sheet = ss.getSheetByName(name); }
  return sheet;
}

// ──────────────────────────────────────────────
// CacheService キャッシュ（読み込み高速化）
// ──────────────────────────────────────────────
const CACHE_KEY = 'posts_cache';
const CACHE_TTL_SEC = 30;   // キャッシュ有効期間（秒）

function getCachedPosts() {
  try {
    const cache = CacheService.getScriptCache();
    const cached = cache.get(CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch (e) { /* キャッシュ失敗時はスルー */ }
  return null;
}

function setCachedPosts(rows) {
  try {
    const cache = CacheService.getScriptCache();
    const json = JSON.stringify(rows);
    // CacheService の 1エントリ最大 100KB 制限対策: 文字数が多すぎる場合はキャッシュしない
    if (json.length < 90000) cache.put(CACHE_KEY, json, CACHE_TTL_SEC);
  } catch (e) { /* キャッシュ失敗時はスルー */ }
}

function invalidateCache() {
  try { CacheService.getScriptCache().remove(CACHE_KEY); } catch (e) { }
}

function getPostRows() {
  // キャッシュヒット時はスプレッドシートへのアクセスをスキップ
  const cached = getCachedPosts();
  if (cached) return cached;

  const sheet = getSheet(SHEET_NAME_POSTS);
  const values = sheet.getDataRange().getValues();
  const result = [];

  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r[0]) continue; // 空行スキップ
    result.push({
      id: r[0],
      createdAt: r[1],
      updatedAt: r[2],
      title: r[3],
      tags: r[4],
      when: r[5],
      who: r[6],
      where: r[7],
      what: r[8],
      why: r[9],
      how: r[10],
      then: r[11],
      prerequisites: r[12],
      whatToDo: r[13],
      notes: r[14],
      likes: Number(r[15]) || 0
    });
  }
  setCachedPosts(result);
  return result;
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
