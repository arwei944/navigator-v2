<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h3>添加站点</h3>
        <button class="modal-close" @click="$emit('close')" aria-label="关闭">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <form @submit.prevent="submit" class="modal-body">
        <div class="form-group">
          <label>网址 <span class="hint">（粘贴后自动补全下方全部信息）</span></label>
          <div class="url-row">
            <input type="url" v-model="form.url" required placeholder="chat.openai.com" class="form-input"
                   @input="onUrlInput" @blur="onUrlBlur" @keyup.enter.prevent="fetchMeta">
            <button type="button" class="btn btn-small" :disabled="fetching || !form.url.trim()" @click="fetchMeta">
              {{ fetching ? '补全中…' : meta ? '重新补全' : '自动补全' }}
            </button>
          </div>
          <div v-if="status" class="status-line" :class="statusKind">
            <span class="status-dot"></span>
            <span>{{ status }}</span>
          </div>
        </div>

        <div class="form-group">
          <label>
            站点名称
            <span v-if="meta && !touched.name" class="field-tag" :class="confClass('name')">自动 · {{ confText('name') }}</span>
          </label>
          <input type="text" v-model="form.name" required placeholder="例如: ChatGPT" class="form-input"
                 @input="touched.name = true">
          <div v-if="meta && !touched.name" class="field-note">{{ sourceText('name') }}</div>
        </div>

        <div class="form-group">
          <label>
            描述
            <span v-if="meta && !touched.desc" class="field-tag" :class="confClass('desc')">自动 · {{ confText('desc') }}</span>
          </label>
          <textarea v-model="form.desc" required placeholder="一句话描述这个站点..." class="form-input form-textarea" rows="3"
                    @input="touched.desc = true"></textarea>
          <div v-if="meta && !touched.desc" class="field-note">{{ sourceText('desc') }}</div>
        </div>

        <div class="form-group">
          <label>
            分类
            <span v-if="meta && !touched.categoryId && meta.categoryId" class="field-tag" :class="confClass('category')">自动 · {{ confText('category') }}</span>
            <span v-else-if="meta && !meta.categoryId" class="hint">（未识别，请手动选择）</span>
          </label>
          <select v-model="form.categoryId" required class="form-input" @change="touched.categoryId = true">
            <option value="" disabled>请选择分类</option>
            <option v-for="cat in categoriesStore.categories" :key="cat.id" :value="cat.id">{{ cat.label }}</option>
          </select>
          <div v-if="meta && !touched.categoryId && meta.sources?.category?.length" class="field-note">
            依据：{{ meta.sources.category.join('、') }}
          </div>
        </div>

        <div class="form-group">
          <label>
            配色
            <span v-if="meta && !touched.color" class="field-tag" :class="confClass('color')">自动 · {{ confText('color') }}</span>
          </label>
          <div class="color-picker-row">
            <input type="color" v-model="form.color" class="color-input" @input="touched.color = true">
            <span class="color-hex">{{ form.color }}</span>
            <span v-if="meta && !touched.color" class="hint">{{ sourceText('color') }}</span>
          </div>
        </div>

        <div class="form-group" v-if="faviconUrl">
          <label>图标预览</label>
          <div class="favicon-preview-row">
            <img :src="faviconUrl" alt="favicon" class="favicon-preview"
                 @error="$event.target.src = 'https://favicon.im/' + form.url.replace(/^https?:\/\//, '').split('/')[0] + '?format=png&size=128'">
            <span class="favicon-domain">{{ form.url.replace(/^https?:\/\//, '').split('/')[0] }}</span>
            <span class="hint">（本地新增，图标按此地址直接加载）</span>
          </div>
        </div>

        <div v-if="submitError" class="status-line err">
          <span class="status-dot"></span>
          <span>{{ submitError }}</span>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-cancel" @click="$emit('close')">取消</button>
          <button type="submit" class="btn btn-primary">添加</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'

const emit = defineEmits(['close'])
const sitesStore = useSitesStore()
const categoriesStore = useCategoriesStore()

const faviconUrl = ref('')
// 图标是「哪个域名抓来的」：中途换网址时不能把上一站的图标存给新站
const faviconHost = ref('')
const fetching = ref(false)
const meta = ref(null)
const status = ref('')
const statusKind = ref('')
const submitError = ref('')

// 用户手动改过的字段不再被自动补全覆盖；换到另一个域名时整体重置，避免换了站还留着上一站的手改值
const touched = reactive({ name: false, desc: false, categoryId: false, color: false })

const form = reactive({
  name: '',
  url: '',
  desc: '',
  // 留空而不是预选 starter：未识别分类时要和「未识别，请手动选择」的提示一致，
  // 否则下拉框显示着「入门对话」、旁边却写着未识别，用户会直接提交错分类
  categoryId: '',
  color: '#3b82f6',
})

const CONF_TEXT = { high: '高置信', medium: '中置信', low: '低置信，请复核' }
const NAME_SRC = { 'og:site_name': '来自 og:site_name', title: '来自页面标题', domain: '无可用标题，按域名推断', known: '沿用已收录站点的名称' }
const DESC_SRC = {
  meta: '来自站点官方描述', 'json-ld': '来自页面结构化数据', keywords: '来自页面关键词',
  paragraph: '来自正文首段', generated: '无官方描述，已按站点生成',
}
const COLOR_SRC = { meta: '来自站点主题色', manifest: '来自站点 manifest 主题色', category: '取自所属分类配色', hash: '无主题色，按域名生成' }

function confText(field) { return CONF_TEXT[meta.value?.confidence?.[field]] || '' }
function confClass(field) { return meta.value?.confidence?.[field] === 'low' ? 'warn' : 'ok' }
function sourceText(field) {
  const m = meta.value
  if (!m) return ''
  const base = field === 'name' ? NAME_SRC[m.sources?.name]
    : field === 'desc' ? DESC_SRC[m.sources?.desc]
      : field === 'color' ? COLOR_SRC[m.sources?.color] : ''
  if (!base) return ''
  // 贴的是子页时名称/描述可能取自主域名（收录的也永远是主域名），必须说明，
  // 否则用户会以为补全错了 —— 描述对不上当前页面，其实是对的
  return m.scope?.[field] === 'root' ? `${base}（取自主域名，非当前子页）` : base
}

function normalizeUrl(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  return /^https?:\/\//i.test(s) ? s : 'https://' + s
}

function hostOf(raw) {
  try { return new URL(normalizeUrl(raw)).hostname.replace(/^www\./, '').toLowerCase() } catch { return '' }
}

function hasCategory(id) {
  return Boolean(id) && categoriesStore.categories.some(c => c.id === id)
}

/** 只覆盖「用户没改过」的字段；用户改过的保留，避免自动补全把人的输入冲掉 */
function applyMeta(data) {
  if (!touched.name && data.name) form.name = data.name
  if (!touched.desc && data.desc) form.desc = data.desc
  if (!touched.color && data.color) form.color = data.color
  if (!touched.categoryId && hasCategory(data.categoryId)) form.categoryId = data.categoryId
  if (data.faviconUrl || data.favicon) {
    faviconUrl.value = data.faviconUrl || data.favicon
    // 记在响应自带的域名上（而非当前输入框），响应晚到时也不会张冠李戴
    faviconHost.value = String(data.domain || '').toLowerCase()
  }
}

let lastHost = ''
// 连续改网址时先发的请求可能后返回，用序号丢弃过期响应，避免把新结果覆盖成旧的
let reqSeq = 0

function resetTouched() {
  touched.name = false
  touched.desc = false
  touched.categoryId = false
  touched.color = false
}

/**
 * 换了域名就等于换了另一个站点：清掉上一站的自动填充。
 * 否则新站抓取失败时（meta 为 null，不会覆盖任何字段），上一站的名称/描述/分类/图标
 * 会原样留在表单里被提交，落库成一条张冠李戴的记录。
 */
function resetForNewHost() {
  resetTouched()
  form.name = ''
  form.desc = ''
  form.categoryId = ''
  form.color = '#3b82f6'
  faviconUrl.value = ''
  faviconHost.value = ''
  meta.value = null
}

function summarize(data) {
  const parts = []
  // 分类必须是本地下拉框里真有的项，否则说「已补全分类 X」而选中项没变，用户会以为补全坏了
  const catLabel = data.categoryLabel || categoriesStore.getCategoryLabel(data.categoryId)
  parts.push(hasCategory(data.categoryId) ? `分类 ${catLabel}` : '分类未识别')
  const low = Object.entries(data.confidence || {}).filter(([, v]) => v === 'low').length
  if (low) parts.push(`${low} 项为推断值`)
  return `已补全：${parts.join(' · ')}`
}

async function fetchMeta() {
  const url = normalizeUrl(form.url)
  if (!url) return
  form.url = url

  const host = hostOf(url)
  if (lastHost && host && host !== lastHost) resetForNewHost()
  lastHost = host

  const seq = ++reqSeq
  fetching.value = true
  status.value = '正在抓取站点信息…'
  statusKind.value = 'loading'
  try {
    const res = await fetch('/api/metadata?url=' + encodeURIComponent(url))
    const data = await res.json()
    if (seq !== reqSeq) return
    if (!res.ok) {
      meta.value = null
      faviconUrl.value = ''
      faviconHost.value = ''
      status.value = data.error || '抓取失败，请手动填写'
      statusKind.value = 'err'
      return
    }
    meta.value = data
    applyMeta(data)
    status.value = data.warning ? `${summarize(data)}；${data.warning}` : summarize(data)
    statusKind.value = data.warning ? 'warn' : 'ok'
  } catch (e) {
    if (seq !== reqSeq) return
    meta.value = null
    faviconUrl.value = ''
    faviconHost.value = ''
    status.value = '抓取失败：' + e.message + '（可手动填写）'
    statusKind.value = 'err'
  } finally {
    if (seq === reqSeq) fetching.value = false
  }
}

// 粘贴/输入网址后自动补全：停顿 600ms 再抓，避免边打边请求
let inputTimer = null
function onUrlInput() {
  submitError.value = ''
  clearTimeout(inputTimer)
  const host = hostOf(form.url)
  if (!host || host === lastHost) return
  inputTimer = setTimeout(() => { if (form.url.trim()) fetchMeta() }, 600)
}

function onUrlBlur() {
  clearTimeout(inputTimer)
  if (form.url.trim() && hostOf(form.url) !== lastHost) fetchMeta()
}

function submit() {
  const rawDomain = form.url.replace(/^https?:\/\//, '').split('/')[0]
  const domain = rawDomain.toLowerCase().replace(/^www\./, '')
  // 同域名已在库里就别再插一条：卡片与分类会重复，云端同步时还会被当作两个站点
  const dup = sitesStore.sites.find(s => hostOf(s.url) === domain)
  if (dup) {
    submitError.value = `该域名已收录：${dup.name}（${dup.url}）。如需变更请编辑该站点，避免重复条目。`
    return
  }
  submitError.value = ''

  const site = {
    name: form.name,
    url: rawDomain,
    desc: form.desc,
    categoryId: form.categoryId,
    color: form.color,
    initial: form.name.charAt(0).toUpperCase(),
  }
  // 本地新增的站点不会有脚本去抓图标，把远程图标地址一并存下，卡片据此直接加载。
  // 只认「图标确实抓自这个域名」的情况：换过网址又抓取失败时，宁可让卡片回落字母块，也不挂错图
  if (/^https?:\/\//i.test(faviconUrl.value) && faviconHost.value === domain) site.iconUrl = faviconUrl.value

  sitesStore.addSite(site)
  emit('close')
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 300;
}
.modal {
  background: var(--bg-white);
  border-radius: 12px;
  width: 460px;
  max-width: 90vw;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0,0,0,.2);
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 0;
}
.modal-header h3 { font-size: 16px; font-weight: 600; }
.modal-close {
  width: 32px; height: 32px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
}
.modal-close:hover { background: var(--border-light); }
.modal-close svg { width: 18px; height: 18px; }
.modal-body { padding: 20px 24px 24px; }
.form-group { margin-bottom: 16px; }
.form-group label { display: block; font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: 6px; }
.hint { font-weight: 400; font-size: 11.5px; color: var(--text-secondary); }
.field-tag { margin-left: 6px; font-weight: 500; font-size: 10.5px; padding: 1px 6px; border-radius: 999px; }
.field-tag.ok { color: #047857; background: #d1fae5; }
.field-tag.warn { color: #b45309; background: #fef3c7; }
.field-note { margin-top: 4px; font-size: 11.5px; color: var(--text-secondary); }
.url-row { display: flex; gap: 8px; }
.url-row .form-input { flex: 1; }
.status-line { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 12px; }
.status-line.ok { color: #047857; }
.status-line.warn { color: #b45309; }
.status-line.err { color: #dc2626; }
.status-line.loading { color: var(--text-secondary); }
.status-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
.form-input {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-family: var(--font);
  color: var(--text-primary);
  background: var(--bg-white);
  outline: none;
  transition: border-color .15s ease;
}
.form-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-light); }
.form-textarea { resize: vertical; min-height: 60px; }
.color-picker-row { display: flex; align-items: center; gap: 10px; }
.color-input { width: 36px; height: 36px; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; padding: 2px; }
.color-hex { font-size: 13px; color: var(--text-secondary); font-family: monospace; }
.form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.btn {
  padding: 8px 20px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all .15s ease;
}
.btn-cancel { background: var(--border-light); color: var(--text-secondary); }
.btn-cancel:hover { background: var(--border); }
.btn-primary { background: var(--accent); color: #fff; }
.btn-primary:hover { filter: brightness(1.1); }
.btn-small { padding: 4px 12px; font-size: 11px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg-white); color: var(--text-secondary); cursor: pointer; white-space: nowrap; }
.btn-small:hover { border-color: var(--accent); color: var(--accent); }
.btn-small:disabled { opacity: .5; cursor: not-allowed; }
.favicon-preview-row { display: flex; align-items: center; gap: 10px; }
.favicon-preview { width: 28px; height: 28px; border-radius: 6px; border: 1px solid var(--border); }
.favicon-domain { font-size: 12px; color: var(--text-secondary); }
</style>