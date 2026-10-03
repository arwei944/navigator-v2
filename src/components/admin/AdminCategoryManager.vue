<template>
  <div class="admin-section">
    <div class="admin-section-header">
      <h2>分类体系管理</h2>
      <div class="cat-head-actions">
        <span v-if="categoriesStore.dirty" class="cat-dirty">本地草稿未发布</span>
        <button class="admin-btn ghost" @click="askReset">恢复默认表</button>
      </div>
    </div>

    <p class="cat-desc">
      分类改动先落在本地，点上方「发布到云端」后才会同步到所有设备。
      <b>分类 id 是站点的归属键，创建后不可修改</b>；删除分类前请先用批量操作把站点迁走。
    </p>

    <div v-if="msg" class="cat-msg" :class="{ bad: msgBad }">{{ msg }}</div>

    <div class="cat-groups">
      <div v-for="group in categoriesStore.groups" :key="group.id" class="cat-group">
        <div class="cat-group-head">
          <span class="cat-group-id">{{ group.id }}</span>
          <input
            class="cat-group-label"
            :value="group.label"
            aria-label="域名称"
            @change="commitGroupLabel(group, $event)"
          >
          <span class="cat-group-count">{{ group.categories.length }} 个分类</span>
          <button class="mini-btn" @click="openAdd(group.id)">+ 新增分类</button>
        </div>

        <div class="cat-rows">
          <div v-for="(cat, i) in group.categories" :key="cat.id" class="cat-row">
            <input
              type="color"
              class="cat-color"
              :value="cat.dotColor"
              :aria-label="cat.label + ' 配色'"
              @change="commitColor(cat, $event)"
            >
            <input
              class="cat-label"
              :value="cat.label"
              aria-label="分类名称"
              @change="commitLabel(cat, $event)"
            >
            <code class="cat-id">{{ cat.id }}</code>
            <span class="cat-sites" :class="{ zero: !countOf(cat.id) }">{{ countOf(cat.id) }} 站</span>
            <div class="cat-row-actions">
              <button class="action-btn" :disabled="i === 0" title="上移" @click="move(cat, -1)">↑</button>
              <button class="action-btn" :disabled="i === group.categories.length - 1" title="下移" @click="move(cat, 1)">↓</button>
              <button class="action-btn danger" title="删除分类" @click="askRemove(cat)">✕</button>
            </div>
          </div>
        </div>

        <div v-if="adding === group.id" class="cat-add">
          <input v-model="draft.label" class="mini-input" placeholder="分类名称，如：模型评测" @input="onDraftLabel">
          <input v-model="draft.id" class="mini-input mono" placeholder="id（小写字母/数字/-_）">
          <input v-model="draft.dotColor" type="color" class="cat-color" aria-label="新分类配色">
          <button class="mini-btn primary" @click="confirmAdd(group.id)">确认新增</button>
          <button class="mini-btn" @click="adding = null">取消</button>
        </div>
      </div>
    </div>

    <ConfirmDialog
      v-if="resetting"
      title="恢复默认分类表"
      message="将把本地分类表还原为内置默认表（放弃当前所有本地分类改动）。云端数据不受影响，确认继续？"
      confirm-text="恢复默认"
      @confirm="doReset"
      @cancel="resetting = false"
    />
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { pinyin } from 'pinyin-pro'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'
import { recordAudit } from '@/services/auditLog'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

const sitesStore = useSitesStore()
const categoriesStore = useCategoriesStore()

const adding = ref(null)
const resetting = ref(false)
const msg = ref('')
const msgBad = ref(false)
const draft = reactive({ id: '', label: '', dotColor: '#64748b' })

/** 每个分类下的站点数：一次遍历建表，避免在模板里对每个分类重扫全量站点 */
const countMap = computed(() => {
  const m = {}
  for (const s of sitesStore.sites) m[s.categoryId] = (m[s.categoryId] || 0) + 1
  return m
})
function countOf(id) {
  return countMap.value[id] || 0
}

function say(text, bad = false) {
  msg.value = text
  msgBad.value = bad
}

function commitGroupLabel(group, event) {
  const r = categoriesStore.updateGroupLabel(group.id, event.target.value)
  if (!r.ok) { say(r.error, true); event.target.value = group.label; return }
  say(`域「${group.label}」已重命名`)
  recordAudit('category.update', { target: group.id, detail: `域重命名为「${group.label}」（本地草稿）` })
}

function commitLabel(cat, event) {
  const next = event.target.value
  const r = categoriesStore.updateCategory(cat.id, { label: next })
  if (!r.ok) { say(r.error, true); event.target.value = cat.label; return }
  say(`分类「${cat.label}」已重命名`)
  recordAudit('category.update', { target: cat.id, detail: `重命名为「${cat.label}」（本地草稿）` })
}

function commitColor(cat, event) {
  const r = categoriesStore.updateCategory(cat.id, { dotColor: event.target.value })
  if (!r.ok) { say(r.error, true); return }
  say(`分类「${cat.label}」配色已更新`)
  recordAudit('category.update', { target: cat.id, detail: `配色改为 ${event.target.value}（本地草稿）` })
}

function move(cat, delta) {
  const r = categoriesStore.moveCategory(cat.id, delta)
  if (!r.ok) { say(r.error, true); return }
  say(`分类「${cat.label}」已${delta < 0 ? '上移' : '下移'}`)
  recordAudit('category.reorder', { target: cat.id, detail: `域内${delta < 0 ? '上移' : '下移'}（本地草稿）` })
}

function askRemove(cat) {
  const n = countOf(cat.id)
  if (n > 0) {
    say(`分类「${cat.label}」下还有 ${n} 个站点，请先用「批量操作 → 修改分类」把它们迁走再删除。`, true)
    return
  }
  const r = categoriesStore.removeCategory(cat.id)
  if (!r.ok) { say(r.error, true); return }
  say(`分类「${cat.label}」已删除`)
  recordAudit('category.remove', { target: cat.id, detail: `删除分类「${cat.label}」（本地草稿）` })
}

function openAdd(groupId) {
  adding.value = groupId
  draft.label = ''
  draft.id = ''
  draft.dotColor = '#64748b'
}

/** 按名称拼音首字母预生成 id；同名时自动加序号，用户仍可手改 */
let lastSuggested = ''
function onDraftLabel() {
  // 用户手动改过 id 就不再覆盖
  if (draft.id && draft.id !== lastSuggested) return
  const base = pinyin(String(draft.label || ''), { pattern: 'first', toneType: 'none', separator: '' })
    .toLowerCase().replace(/[^a-z0-9]/g, '') || 'cat'
  let candidate = base
  let n = 2
  while (categoriesStore.categories.some(c => c.id === candidate) || categoriesStore.domains.some(d => d.id === candidate)) {
    candidate = base + n++
  }
  draft.id = candidate
  lastSuggested = candidate
}

function confirmAdd(groupId) {
  const r = categoriesStore.addCategory(groupId, { ...draft })
  if (!r.ok) { say(r.error, true); return }
  say(`分类「${draft.label}」已新增（本地草稿，发布后生效）`)
  recordAudit('category.add', { target: r.id, detail: `在域「${groupId}」新增分类「${draft.label}」（本地草稿）` })
  adding.value = null
}

function askReset() {
  resetting.value = true
}
function doReset() {
  categoriesStore.resetToDefault()
  resetting.value = false
  say('已恢复为内置默认分类表（本地草稿，发布后生效）')
  recordAudit('category.update', { target: 'all', detail: '恢复为内置默认分类表（本地草稿）' })
}
</script>

<style scoped>
.admin-section { padding: 0 32px 32px; }
.admin-section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.admin-section-header h2 { font-size: 16px; font-weight: 600; }
.cat-head-actions { display: flex; align-items: center; gap: 10px; }
.cat-dirty { font-size: 12px; font-weight: 600; color: #b45309; background: #fffbeb; border: 1px solid #fde68a; padding: 2px 10px; border-radius: 10px; }
.admin-btn {
  padding: 7px 16px; border: none; border-radius: var(--radius-sm);
  background: var(--accent); color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;
}
.admin-btn.ghost { background: var(--bg-white); color: var(--text-primary); border: 1px solid var(--border); }
.admin-btn.ghost:hover { border-color: var(--accent); color: var(--accent); }
.cat-desc { font-size: 12.5px; color: var(--text-secondary); line-height: 1.7; margin-bottom: 12px; }
.cat-desc b { color: var(--text-primary); }
.cat-msg {
  margin-bottom: 12px; padding: 8px 12px; border-radius: var(--radius-sm); font-size: 12.5px;
  background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0;
}
.cat-msg.bad { background: #fef2f2; color: #dc2626; border-color: #fecaca; }
.cat-groups { display: flex; flex-direction: column; gap: 14px; }
.cat-group { background: var(--bg-white); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; }
.cat-group-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.cat-group-id { font-family: monospace; font-size: 11px; color: var(--text-secondary); background: var(--border-light); padding: 2px 8px; border-radius: 10px; }
.cat-group-label {
  border: 1px solid transparent; background: transparent; font-size: 14px; font-weight: 700;
  color: var(--text-primary); padding: 4px 8px; border-radius: var(--radius-sm); font-family: var(--font);
  outline: none; min-width: 120px;
}
.cat-group-label:hover { border-color: var(--border); }
.cat-group-label:focus { border-color: var(--accent); background: var(--bg-white); }
.cat-group-count { font-size: 12px; color: var(--text-secondary); margin-left: auto; }
.cat-rows { display: flex; flex-direction: column; }
.cat-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--border-light); }
.cat-row:last-child { border-bottom: none; }
.cat-color { width: 30px; height: 28px; padding: 2px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-white); cursor: pointer; flex-shrink: 0; }
.cat-label {
  flex: 1; min-width: 120px; border: 1px solid transparent; background: transparent; font-size: 13px;
  color: var(--text-primary); padding: 5px 8px; border-radius: var(--radius-sm); font-family: var(--font); outline: none;
}
.cat-label:hover { border-color: var(--border); }
.cat-label:focus { border-color: var(--accent); background: var(--bg-white); }
.cat-id { font-size: 11px; color: var(--text-secondary); min-width: 96px; }
.cat-sites { font-size: 12px; color: var(--text-primary); font-weight: 600; min-width: 56px; text-align: right; }
.cat-sites.zero { color: var(--text-disabled); font-weight: 400; }
.cat-row-actions { display: flex; gap: 4px; }
.action-btn {
  width: 26px; height: 26px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-white);
  cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 12px; color: var(--text-secondary);
}
.action-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.action-btn:disabled { opacity: .4; cursor: not-allowed; }
.action-btn.danger:hover:not(:disabled) { border-color: #ef4444; color: #ef4444; }
.cat-add { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--border); }
.mini-input {
  padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 13px;
  font-family: var(--font); color: var(--text-primary); background: var(--bg-white); outline: none; min-width: 150px;
}
.mini-input.mono { font-family: monospace; min-width: 130px; }
.mini-input:focus { border-color: var(--accent); }
.mini-btn {
  padding: 6px 14px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-white);
  font-size: 13px; color: var(--text-primary); cursor: pointer;
}
.mini-btn:hover { border-color: var(--accent); color: var(--accent); }
.mini-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.mini-btn.primary:hover { filter: brightness(1.1); color: #fff; }
</style>