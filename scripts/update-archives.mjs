// 終わった Vimeo ライブ配信の URL を、録画（アーカイブ）動画の URL に差し替えるスクリプト。
// GitHub Actions から毎日実行される。環境変数 VIMEO_TOKEN が必要。
// 使い方: node scripts/update-archives.mjs [--dry-run]
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../index.html', import.meta.url);
const DRY = process.argv.includes('--dry-run');
const TOKEN = process.env.VIMEO_TOKEN;
const WAIT_MIN = 120; // 配信開始から何分たったら差し替えを試すか

let html = readFileSync(FILE, 'utf8');

// カレンダーの年月を index.html の new Date(YYYY,M,1) から読む
const ym = html.match(/first\s*=\s*new Date\((\d{4}),\s*(\d{1,2}),\s*1\)/);
if (!ym) { console.error('カレンダーの年月が見つかりません'); process.exit(1); }
const year = Number(ym[1]), month = Number(ym[2]); // month は 0 始まり

// 日本時間で「配信開始時刻」を作る
const jst = (d, hh, mm) => new Date(Date.UTC(year, month, d, hh - 9, mm));

const re = /\{d:(\d+),time:"(\d{1,2}):(\d{2})",name:"([^"]*)"[^\n]*?url:"(https:\/\/vimeo\.com\/event\/(\d+)\/embed\/[0-9a-f]+)"/g;
const targets = [];
for (const m of html.matchAll(re)) {
  const [line, d, hh, mm, name, url, eventId] = m;
  if (/off:true/.test(line)) continue; // 休講は対象外
  const start = jst(Number(d), Number(hh), Number(mm));
  if (Date.now() < start.getTime() + WAIT_MIN * 60000) continue; // まだ終わっていない
  targets.push({ d, name, url, eventId });
}

if (!targets.length) { console.log('差し替える回はありません'); process.exit(0); }
console.log('対象:', targets.map(t => `${month + 1}/${t.d} ${t.name}`).join(', '));
if (!TOKEN) {
  console.error('VIMEO_TOKEN が設定されていないため、確認だけで終了します');
  process.exit(DRY ? 0 : 1);
}

async function api(path) {
  const r = await fetch('https://api.vimeo.com' + path, {
    headers: { Authorization: `bearer ${TOKEN}`, Accept: 'application/vnd.vimeo.*+json;version=3.4' },
  });
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

let changed = 0;
for (const t of targets) {
  try {
    const res = await api(`/me/live_events/${t.eventId}/videos?per_page=10&fields=link,uri,created_time,status,duration`);
    const vids = (res.data || [])
      .filter(v => v.link && (v.status === 'available' || !v.status) && (v.duration ?? 1) > 0)
      .sort((a, b) => new Date(b.created_time) - new Date(a.created_time));
    if (!vids.length) { console.log(`${month + 1}/${t.d} ${t.name}: 録画がまだありません`); continue; }
    const link = vids[0].link; // 限定公開なら https://vimeo.com/ID/ハッシュ の形
    console.log(`${month + 1}/${t.d} ${t.name}: ${t.url} -> ${link}`);
    html = html.replace(t.url, link);
    changed++;
  } catch (e) {
    console.error(`${month + 1}/${t.d} ${t.name}: 取得に失敗しました: ${e.message}`);
  }
}

if (changed && !DRY) {
  const now = new Date(Date.now() + 9 * 3600000);
  html = html.replace(/アーカイブ（\d+\/\d+ 時点）/, `アーカイブ（${now.getUTCMonth() + 1}/${now.getUTCDate()} 時点）`);
  writeFileSync(FILE, html);
}
console.log(`${changed} 件を差し替えました${DRY ? '（確認のみ）' : ''}`);
