// Cocos Creator 2.x 资源 bundle 映射:paths -> uuid -> native/import 文件
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || '/tmp/ylyy/extract/assets/assets/resources';
const cfg = JSON.parse(fs.readFileSync(path.join(BASE, 'config.json'), 'utf8'));

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VALUES = {};
for (let i = 0; i < CHARS.length; i++) VALUES[CHARS[i]] = BigInt(i);

// Cocos compressUuid: 保留前2位,其余20字符每2个base64字符解3位hex
function decompressUuid(u) {
  if (u.length !== 22) return u; // 已是标准uuid
  let out = u.slice(0, 2).toLowerCase();
  for (let i = 2; i < 22; i += 2) {
    const v = Number(VALUES[u[i]]) * 64 + Number(VALUES[u[i + 1]]);
    out += v.toString(16).padStart(3, '0');
  }
  return out.slice(0, 8) + '-' + out.slice(8, 12) + '-' + out.slice(12, 16) + '-' + out.slice(16, 20) + '-' + out.slice(20);
}

const uuids = cfg.uuids.map(decompressUuid);
const fileOf = (u, ext) => path.join(BASE, 'native', u.slice(0, 2), u + '.' + ext);

// 收集映射
const map = {};
for (const [idx, entry] of Object.entries(cfg.paths)) {
  const p = entry[0];
  const u = uuids[+idx];
  if (!u) continue;
  // 找 native 文件(png/jpg/mp3/atlas/bin/ttf)
  for (const ext of ['png', 'jpg', 'jpeg', 'mp3', 'atlas', 'bin', 'plist', 'ttf', 'wasm']) {
    const f = fileOf(u, ext);
    if (fs.existsSync(f)) { map[p] = { uuid: u, file: f, ext }; break; }
  }
  if (!map[p]) map[p] = { uuid: u, file: null, ext: null };
}

const query = process.argv[3];
if (query) {
  for (const [p, v] of Object.entries(map)) if (p.includes(query)) console.log(p, '->', v.file);
} else {
  console.log(JSON.stringify(map, null, 0));
}
