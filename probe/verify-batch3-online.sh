#!/usr/bin/env bash
# 第三批线上（生产）验收。
#
# 为什么是 bash + curl 而不是 Node 脚本：
#   本会话里从 Node 里 spawn curl 会 EBUSY（PTY 环境限制），而 Node 的 fetch 又不认代理 ——
#   而访问 vercel.app 必须走本机代理。所以直接在 shell 里跑 curl（走 7897 代理），
#   JSON 断言交给 node -e 读文件做（node 只负责解析，不负责联网）。
#
# 用法: bash probe/verify-batch3-online.sh [base-url]
# 退出码 0 = 全部通过；非 0 = 有失败项（会逐条列出）。

set -u
BASE="${1:-https://navigator-v2-two.vercel.app}"
PROXY="http://127.0.0.1:7897"
TMP="$(dirname "$0")/_online"
mkdir -p "$TMP"

PASS=0
FAIL=0
faillist=()

check() { # check <cond-exit-code> <label> [detail]
  if [ "$1" -eq 0 ]; then
    PASS=$((PASS + 1)); printf '  ✅ %s%s\n' "$2" "${3:+ — $3}"
  else
    FAIL=$((FAIL + 1)); faillist+=("$2${3:+ — $3}"); printf '  ❌ %s%s\n' "$2" "${3:+ — $3}"
  fi
}

# req <name> <method> <url> [curl args...] → 写 $TMP/<name>.body 与 .hdr，回显状态码
req() {
  local name="$1" method="$2" url="$3"; shift 3
  curl -s --max-time 30 -x "$PROXY" -X "$method" "$url" \
    -D "$TMP/$name.hdr" -o "$TMP/$name.body" -w '%{http_code}' "$@" 2>/dev/null
}

# jbody <file> <expression-over-j> —— 显式 JSON.parse：.body 扩展名会让 require() 把它
# 当成 JS 模块解析，而不是 JSON。解析失败时保留 stderr，不要静默成空串。
jbody() {
  node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));console.log(eval(process.argv[2]))' "$1" "$2"
}

echo
echo "=== 第三批线上验收：$BASE ==="
echo

# ─────────────── A. 数据一条未动（最重要，放最前）───────────────
echo "[A] 数据未受影响"
S=$(req sites GET "$BASE/api/sites")
check $([ "$S" = "200" ] && echo 0 || echo 1) "GET /api/sites 200" "实得 $S"
V=$(jbody "./$TMP/sites.body" "j.version")
N=$(jbody "./$TMP/sites.body" "j.sites.length")
DG=$(jbody "./$TMP/sites.body" "!!j.degraded")
check $([ "$V" = "122" ] && echo 0 || echo 1) "站点表 version 未因本次发布变化" "version=$V（期望 122）"
check $([ "$N" = "300" ] && echo 0 || echo 1) "站点数仍为 300" "count=$N"
check $([ "$DG" = "false" ] && echo 0 || echo 1) "无 degraded 标记" "degraded=$DG"
check $(grep -qi 'cache-control:.*must-revalidate' "$TMP/sites.hdr" && echo 0 || echo 1) \
  "站点表仍走可重验证缓存（第二批改动未被破坏）"

# ─────────────── B. 序 18/19 会话凭据 ───────────────
echo
echo "[B] 序 18/19 会话凭据与体量门禁"
S=$(req sess_q GET "$BASE/api/session?key=probe-should-not-work")
R=$(jbody "./$TMP/sess_q.body" "j.reason")
check $([ "$S" = "400" ] && [ "$R" = "key-in-query-removed" ] && echo 0 || echo 1) \
  "旧写法 ?key= 已被停用" "status=$S reason=$R"

S=$(req sess_anon GET "$BASE/api/session")
D=$(jbody "./$TMP/sess_anon.body" "JSON.stringify(j.data)")
check $([ "$S" = "200" ] && [ "$D" = "null" ] && echo 0 || echo 1) \
  "无凭据 GET 返回空快照（首次访问是正常路径）" "status=$S data=$D"

S=$(req sess_noauth POST "$BASE/api/session" -H 'Content-Type: application/json' -d '{"data":{"a":1}}')
R=$(jbody "./$TMP/sess_noauth.body" "j.reason")
check $([ "$S" = "400" ] && [ "$R" = "key-header-required" ] && echo 0 || echo 1) \
  "POST 无 Authorization → 400" "status=$S reason=$R"

S=$(req sess_bodykey POST "$BASE/api/session" -H 'Content-Type: application/json' -d '{"key":"x","data":{"a":1}}')
R=$(jbody "./$TMP/sess_bodykey.body" "j.reason")
check $([ "$S" = "400" ] && [ "$R" = "key-header-required" ] && echo 0 || echo 1) \
  "POST 把 key 放请求体 → 仍 400（不保留兼容路径）" "status=$S reason=$R"

head -c 300000 /dev/zero | tr '\0' 'x' > "$TMP/big.bin"
printf '{"data":{"blob":"' > "$TMP/big.json"; cat "$TMP/big.bin" >> "$TMP/big.json"; printf '"}}' >> "$TMP/big.json"
S=$(req sess_big POST "$BASE/api/session" -H 'Authorization: Bearer probe-not-a-real-key' \
      -H 'Content-Type: application/json' --data-binary "@$TMP/big.json")
check $([ "$S" = "413" ] && echo 0 || echo 1) "超过 256KB 的写入被硬拒（413）" "status=$S"

# ─────────────── C. 序 17 抓取代理的 SSRF / 滥用防护 ───────────────
echo
echo "[C] 序 17 /api/metadata 防护"
for t in "127.0.0.1" "169.254.169.254" "10.0.0.1"; do
  N=$(echo "$t" | tr '.' '_')
  S=$(req "meta_$N" GET "$BASE/api/metadata?url=http%3A%2F%2F$t%2F")
  check $([ "$S" = "400" ] && echo 0 || echo 1) "字面内网地址被拒：$t" "status=$S"
done

S=$(req meta_cross GET "$BASE/api/metadata?url=https%3A%2F%2Fexample.com%2F" -H 'Sec-Fetch-Site: cross-site')
check $([ "$S" = "403" ] && echo 0 || echo 1) "跨站调用被拒（Sec-Fetch-Site: cross-site）" "status=$S"

S=$(req meta_nourl GET "$BASE/api/metadata")
check $([ "$S" = "400" ] && echo 0 || echo 1) "缺少 url 参数 → 400" "status=$S"

S=$(req sites_post POST "$BASE/api/sites" -H 'Content-Type: application/json' -d '{"sites":[]}')
check $([ "$S" = "401" ] && echo 0 || echo 1) "站点表写入仍需鉴权" "status=$S"

# ─────────────── D. 序 23 产物已上线（且首屏不含拼音引擎）───────────────
echo
echo "[D] 序 23 首屏分包（产物层面）"
S=$(req home GET "$BASE/")
check $([ "$S" = "200" ] && echo 0 || echo 1) "首页 200" "status=$S"
check $(grep -q 'vendor-vue-' "$TMP/home.body" && echo 0 || echo 1) "首页引用了独立 vendor-vue chunk"
check $(grep -q 'assets/pinyin-' "$TMP/home.body" && echo 1 || echo 0) \
  "首页**没有**为拼音 chunk 注入 modulepreload"

# 拼音 chunk 本身必须真的部署上去了（只是不在首屏加载清单里）。
# 首页已不再直接引用它，所以要从**入口 chunk**里把它挖出来 —— 这也顺带验证了
# 「入口确实按需引用它」而非把它随手丢掉。
ENTRY=$(grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' "$TMP/home.body" | head -1)
S=$(req entry GET "$BASE$ENTRY")
PYF=$(grep -oE 'pinyin-[A-Za-z0-9_-]+\.js' "$TMP/entry.body" | head -1)
check $([ -n "$PYF" ] && echo 0 || echo 1) "入口 chunk 里有对拼音 chunk 的引用" "${PYF:-未找到}"
if [ -n "$PYF" ]; then
  S=$(req pychunk GET "$BASE/assets/$PYF")
  check $([ "$S" = "200" ] && echo 0 || echo 1) "拼音 chunk 已部署（按需加载时可取到）" "status=$S /assets/$PYF"
  check $(grep -q "import(\"[^\"]*$PYF\"" "$TMP/entry.body" && echo 0 || echo 1) \
    "引用形态是**动态** import（不是静态 from）"
fi

# ─────────────── E. PWA 与静态资源回归（改了构建配置，必须回看）───────────────
echo
echo "[E] PWA / 静态资源回归"
S=$(req sw GET "$BASE/sw.js")
CT=$(grep -i '^content-type:' "$TMP/sw.hdr" | tr -d '\r')
check $([ "$S" = "200" ] && echo "$CT" | grep -qi 'javascript' && echo 0 || echo 1) \
  "Service Worker 未被重写成 HTML" "status=$S $CT"
S=$(req mf GET "$BASE/manifest.webmanifest")
CT=$(grep -i '^content-type:' "$TMP/mf.hdr" | tr -d '\r')
check $([ "$S" = "200" ] && echo "$CT" | grep -qi 'json' && echo 0 || echo 1) \
  "PWA manifest 正常" "status=$S $CT"
S=$(req icon GET "$BASE/pwa-192x192.png")
CT=$(grep -i '^content-type:' "$TMP/icon.hdr" | tr -d '\r')
check $([ "$S" = "200" ] && echo "$CT" | grep -qi 'image/png' && echo 0 || echo 1) \
  "PWA 图标真实存在" "status=$S $CT"

# ─────────────── 汇总 ───────────────
echo
echo "──────────────────────────────"
if [ "$FAIL" -eq 0 ]; then
  echo "✅ 第三批线上验收全部通过：$PASS 项"
  exit 0
fi
echo "❌ 第三批线上验收：$PASS 通过 / $FAIL 失败"
for f in "${faillist[@]}"; do echo "   - $f"; done
exit 1
