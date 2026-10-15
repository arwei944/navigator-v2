<template>
  <div class="plugins">
    <header class="pl-head">
      <div>
        <h2 class="pl-title">插件</h2>
        <p class="pl-sub">
          站点的九个引擎模块（抓取 / 翻译 / LLM / 图标 / 封面 / 探针 / 分类表 / 存储 / 发布）
          在这里统一查看与切换。改配置**立即生效**，并写入站点库持久化 —— 重启后依然有效。
        </p>
      </div>
      <button type="button" class="pl-btn" :disabled="loading" @click="load">
        {{ loading ? '读取中…' : '刷新' }}
      </button>
    </header>

    <p v-if="error" class="pl-error">{{ error }}</p>
    <p v-if="notice" class="pl-notice">{{ notice }}</p>

    <section v-for="g in groups" :key="g.id" class="pl-card">
      <div class="pl-card-head">
        <h3>{{ g.label }}</h3>
        <span class="pl-badge" :class="g.strategy">{{ strategyLabel(g.strategy) }}</span>
      </div>
      <p class="pl-role">{{ g.role }}</p>
      <p class="pl-current">
        <span class="pl-k">当前</span>{{ g.current.label }}
        <code class="pl-env">{{ g.env }}</code>
      </p>

      <!-- 可写：链式 = 勾选；单选 = 单选钮 -->
      <div v-if="g.writable" class="pl-editor">
        <template v-if="g.strategy === 'chain'">
          <label v-for="p in g.providers" :key="p.id" class="pl-opt" :class="{ dim: !p.available }">
            <input
              type="checkbox"
              :checked="chainOn(g, p)"
              :disabled="!p.available"
              @change="setChain(g, p, $event.target.checked)"
            />
            <span class="pl-opt-label">{{ p.label }}</span>
            <code class="pl-opt-id">{{ p.id }}</code>
            <span v-if="!p.available" class="pl-tag off">不可用</span>
            <span v-else-if="p.active" class="pl-tag on">生效中</span>
          </label>
          <div class="pl-quick">
            <button type="button" class="pl-link" @click="draft[g.env] = ''">全部启用（默认）</button>
            <button type="button" class="pl-link" @click="draft[g.env] = 'none'">全部关闭</button>
          </div>
        </template>

        <template v-else>
          <label class="pl-opt">
            <input type="radio" :checked="draft[g.env] === ''" @change="draft[g.env] = ''" />
            <span class="pl-opt-label">自动（按可用性挑一个）</span>
          </label>
          <label v-for="p in g.providers" :key="p.id" class="pl-opt" :class="{ dim: !p.available }">
            <input type="radio" :checked="draft[g.env] === p.id" @change="draft[g.env] = p.id" />
            <span class="pl-opt-label">{{ p.label }}</span>
            <code class="pl-opt-id">{{ p.id }}</code>
            <span v-if="!p.available" class="pl-tag off">{{ p.note || '不可用' }}</span>
            <span v-else-if="p.active" class="pl-tag on">生效中</span>
          </label>
        </template>
      </div>

      <!-- 不可写：说明为什么 -->
      <p v-else class="pl-locked"><span class="pl-lock" aria-hidden="true">🔒</span>{{ g.note }}</p>

      <p v-if="g.writable && g.note" class="pl-note">{{ g.note }}</p>
    </section>

    <footer v-if="dirty" class="pl-foot">
      <span class="pl-dirty">有 {{ dirtyCount }} 项改动未保存</span>
      <button type="button" class="pl-btn primary" :disabled="saving" @click="save">
        {{ saving ? '保存中…' : '保存更改' }}
      </button>
      <button type="button" class="pl-btn" :disabled="saving" @click="reset">放弃</button>
    </footer>
  </div>
</template>

<script setup>
/**
 * 后台「插件」面板：九个引擎模块的统一管理面。
 *
 * 与「部署」面板的关键区别：这里**可以改**。切换只写运行期配置（白名单内的 NAV_* 变量），
 * 立即生效并持久化 —— 不需要重新构建，也不碰源码。
 *
 * 但有一个刻意的例外：**站点存储（site-store）只读**。存储是数据安全单点，
 * 一次误设（比如指到空目录）就会让种子覆盖线上真实数据，所以它不给开关。
 * 服务端的白名单（shared/plugin-registry.mjs#WRITABLE_ENVS）才是最终裁决 ——
 * 这里不显示控件只是第一道，绕过界面直接打接口同样会被拒。
 *
 * 「默认值」的表达：链式组全部勾上 = 清空该变量（回到默认全量），
 * 单选组选「自动」= 清空。这样「回到默认」不需要猜默认值到底是什么。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { pluginApi } from '@/services/pluginApi'

const groups = ref([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const notice = ref('')
/** 编辑器里的值：'' = 未配置（默认）／'none' = 显式关闭／'a,b' = 指定链 ／单选组则是 id */
const draft = reactive({})
const original = reactive({})

function strategyLabel(s) {
  return s === 'chain' ? '链式' : s === 'pick' ? '单选' : '锁定'
}

/** 服务端数据 → 编辑器的初始值 */
function initValue(g) {
  if (!g.writable) return ''
  if (g.strategy === 'chain') {
    const c = g.current.configured
    if (c === null) return '' /* 默认全量 */
    if (c.length === 0) return 'none'
    return c.join(',')
  }
  return g.current.mode === 'auto' ? '' : (g.current.requested || '')
}

/** 链式组「实际能用」的 id（不可用的勾不上，也就不该参与「是否全选」的判断） */
function usableIds(g) {
  return g.providers.filter(p => p.available).map(p => p.id)
}

/** 当前编辑器里这一组的 id 列表 */
function chainIds(g) {
  const v = draft[g.env]
  if (v === '' || v === undefined) return g.providers.map(p => p.id)
  if (v === 'none') return []
  return String(v).split(',').map(s => s.trim()).filter(Boolean)
}

function chainOn(g, p) {
  if (!p.available) return chainIds(g).includes(p.id)
  return chainIds(g).includes(p.id)
}

function setChain(g, p, on) {
  const ids = new Set(chainIds(g))
  if (on) ids.add(p.id); else ids.delete(p.id)
  const usable = usableIds(g)
  const next = [...ids]
  if (next.length === 0) { draft[g.env] = 'none'; return }
  // 全选「可用的那些」= 回到默认（清空变量），而不是记一串冗余的 id
  if (usable.length && usable.every(id => ids.has(id)) && usable.length === ids.size) { draft[g.env] = ''; return }
  // 输出按注册顺序排列，链的语义就是有序的
  draft[g.env] = g.providers.filter(x => ids.has(x.id)).map(x => x.id).join(',')
}

const dirtyKeys = computed(() => Object.keys(draft).filter(k => draft[k] !== original[k]))
const dirty = computed(() => dirtyKeys.value.length > 0)
const dirtyCount = computed(() => dirtyKeys.value.length)

function seed() {
  for (const k of Object.keys(draft)) delete draft[k]
  for (const k of Object.keys(original)) delete original[k]
  for (const g of groups.value) {
    const v = initValue(g)
    draft[g.env] = v
    original[g.env] = v
  }
}

async function load() {
  loading.value = true
  error.value = ''
  notice.value = ''
  const r = await pluginApi.list()
  if (r.ok) {
    groups.value = r.groups || []
    seed()
  } else {
    error.value = r.error
    groups.value = []
  }
  loading.value = false
}

function reset() {
  for (const k of Object.keys(original)) draft[k] = original[k]
  notice.value = ''
}

async function save() {
  const overrides = {}
  for (const k of dirtyKeys.value) overrides[k] = draft[k]
  if (!Object.keys(overrides).length) return

  saving.value = true
  error.value = ''
  notice.value = ''
  const r = await pluginApi.save(null, overrides)
  saving.value = false

  if (!r.ok) {
    error.value = r.error
    return
  }
  groups.value = r.groups || groups.value
  seed()
  const rejected = (r.rejected || []).filter(x => x.reason)
  notice.value = rejected.length
    ? `已应用 ${r.applied.length} 项，${rejected.length} 项被拒：${rejected.map(x => `${x.name}（${x.reason}）`).join('；')}`
    : `已应用 ${r.applied.length} 项配置，立即生效`
}

onMounted(load)
</script>

<style scoped>
.plugins { padding: 0 32px 40px; max-width: 880px; }
.pl-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.pl-title { margin: 0; font-size: 16px; font-weight: 600; color: var(--text-primary); }
.pl-sub { margin: 6px 0 0; font-size: 12px; line-height: 1.7; color: var(--text-secondary); max-width: 68ch; }
.pl-btn {
  padding: 6px 14px; font-size: 12px; border-radius: var(--radius-sm);
  border: 1px solid var(--border); background: var(--bg-white); color: var(--text-secondary); cursor: pointer;
}
.pl-btn:hover { border-color: var(--accent); color: var(--accent); }
.pl-btn:disabled { opacity: .5; cursor: not-allowed; }
.pl-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.pl-btn.primary:hover { opacity: .9; color: #fff; }
.pl-link { border: none; background: none; padding: 0; font-size: 11px; color: var(--accent); cursor: pointer; }

.pl-error { margin: 0 0 12px; font-size: 12px; color: #b91c1c; }
.pl-notice { margin: 0 0 12px; padding: 8px 12px; border-radius: var(--radius-sm);
  background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; font-size: 12px; }

.pl-card {
  border: 1px solid var(--border); border-radius: var(--radius-md);
  background: var(--bg-white); padding: 16px 18px; margin-bottom: 14px;
}
.pl-card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.pl-card-head h3 { margin: 0; font-size: 13px; font-weight: 600; color: var(--text-primary); }
.pl-badge {
  font-size: 10px; padding: 1px 7px; border-radius: 999px;
  border: 1px solid currentColor; color: var(--text-secondary); opacity: .8;
}
.pl-badge.chain { color: #2563eb; opacity: .9; }
.pl-badge.pick { color: #7c3aed; opacity: .9; }
.pl-badge.locked { color: #b45309; opacity: .9; }

.pl-role { margin: 0 0 8px; font-size: 12px; color: var(--text-secondary); }
.pl-current { margin: 0 0 12px; font-size: 12px; color: var(--text-primary); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pl-k { font-size: 10px; color: var(--text-secondary); opacity: .7; }
.pl-env { font-family: ui-monospace, monospace; font-size: 11px; color: var(--text-secondary); opacity: .7; }

.pl-editor { display: flex; flex-direction: column; gap: 2px; }
.pl-opt {
  display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: var(--radius-sm);
  font-size: 12px; color: var(--text-primary); cursor: pointer;
}
.pl-opt:hover { background: var(--border-light); }
.pl-opt.dim { opacity: .55; }
.pl-opt-label { flex: 1; min-width: 0; }
.pl-opt-id { font-family: ui-monospace, monospace; font-size: 10px; color: var(--text-secondary); opacity: .75; }
.pl-tag { font-size: 10px; padding: 0 6px; border-radius: 999px; border: 1px solid currentColor; }
.pl-tag.on { color: #16a34a; }
.pl-tag.off { color: #b45309; }
.pl-quick { display: flex; gap: 14px; margin: 6px 0 0; padding: 0 8px; }

.pl-locked { margin: 0; padding: 10px 12px; border-radius: var(--radius-sm); background: #fffbeb;
  border: 1px solid #fde68a; color: #92400e; font-size: 11px; line-height: 1.7; }
.pl-lock { margin-right: 6px; }
.pl-note { margin: 10px 0 0; font-size: 11px; color: var(--text-secondary); opacity: .75; line-height: 1.7; }

.pl-foot {
  position: sticky; bottom: 0; display: flex; align-items: center; gap: 12px;
  padding: 12px 0; margin-top: 4px; background: var(--bg-white); border-top: 1px solid var(--border);
}
.pl-dirty { flex: 1; font-size: 12px; color: #b45309; }
</style>
