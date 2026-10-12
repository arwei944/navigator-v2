<template>
  <div class="modal-overlay" @click.self="requestClose">
    <div ref="panelRef" class="modal" role="dialog" aria-modal="true" aria-labelledby="add-site-title">
      <div class="modal-header">
        <h3 id="add-site-title">添加站点</h3>
        <button class="modal-close" @click="requestClose" aria-label="关闭">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <form @submit.prevent="submit" class="modal-body">
        <div v-if="notice" class="status-line warn">
          <span class="status-dot"></span>
          <span>{{ notice }}</span>
        </div>
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
          <div v-if="meta && !touched.name && translatedNote('name')" class="field-note translated">{{ translatedNote('name') }}</div>
        </div>

        <div class="form-group">
          <label>
            描述
            <span v-if="meta && !touched.desc" class="field-tag" :class="confClass('desc')">自动 · {{ confText('desc') }}</span>
          </label>
          <textarea v-model="form.desc" required placeholder="一句话描述这个站点..." class="form-input form-textarea" rows="3"
                    @input="touched.desc = true"></textarea>
          <div v-if="meta && !touched.desc" class="field-note">{{ sourceText('desc') }}</div>
          <div v-if="aiReady && (form.name || form.desc)" class="ai-row">
            <button type="button" class="ai-btn" :disabled="aiBusy" @click="aiPolish">
              {{ aiBusy ? '润色中…' : 'AI 润色文案' }}
            </button>
            <span class="ai-hint">只改措辞不改事实，改完由你确认</span>
          </div>
          <div v-if="meta && !touched.desc && translatedNote('desc')" class="field-note translated">{{ translatedNote('desc') }}</div>
        </div>

        <div class="form-group">
          <label>别名 <span class="hint">（俗称 / 曾用名 / 缩写，逗号分隔，可选）</span></label>
          <input type="text" v-model="form.aliases" placeholder="例如: 币安、Binance" class="form-input">
          <div class="field-note">补充常用叫法，搜索时也能命中这个站点</div>
        </div>

        <div class="form-group">
          <label>
            用途
            <span class="hint">（最多 {{ MAX_PURPOSES }} 个，可多选）</span>
            <span v-if="meta && !touched.purposes && form.purposes.length" class="field-tag ok">自动推断</span>
          </label>
          <PurposePicker :model-value="form.purposes" @update:model-value="onPurposes" />
          <div class="field-note">用途回答「用它来干什么」，与分类（归属）是两回事，可跨分类筛选</div>
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
          <button type="button" class="btn btn-cancel" @click="requestClose">取消</button>
          <button type="submit" class="btn btn-primary">添加</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'
import PurposePicker from '@/components/PurposePicker.vue'
import { normalizeUrl, hostOf } from '@/utils/url'
import { normalizePurposes, MAX_PURPOSES } from '../../shared/purposes.mjs'
import { findDuplicate, buildSiteFromDraft } from '@/utils/siteDraft'
import { fetchSiteMeta, metaFailureText } from '@/services/meta'
import { localSiteMeta, localMetaNotice } from '@/services/localMeta'
import { loadSuggestCategory } from '@/services/autoAdd'
import { aiApi } from '@/services/aiApi'
import { useFocusTrap } from '@/composables/useFocusTrap'

// 从搜索框「添加站点」入口带过来的网址；直接打开弹窗时为空
const props = defineProps({
  prefillUrl: { type: String, default: '' },
  // 自动添加被护栏拦下时带过来的原因，讲清楚为什么又退回弹窗
  notice: { type: String, default: '' }
})

const emit = defineEmits(['close', 'saved'])
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
const touched = reactive({ name: false, desc: false, categoryId: false, color: false, purposes: false })

const form = reactive({
  name: '',
  url: '',
  desc: '',
  // 留空而不是预选 starter：未识别分类时要和「未识别，请手动选择」的提示一致，
  // 否则下拉框显示着「入门对话」、旁边却写着未识别，用户会直接提交错分类
  categoryId: '',
  color: '#3b82f6',
  aliases: '',
  purposes: [],
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

/**
 * 自动翻译提示：仅在该字段确实被译过、且用户没改过时展示。
 * 原文一并给出，让用户能判断译得准不准，也方便识别品牌名被误译的情况。
 */
function translatedNote(field) {
  const m = meta.value
  if (!m?.translated?.[field]) return ''
  const original = field === 'name' ? m.nameOriginal : m.descOriginal
  if (!original || original === (field === 'name' ? form.name : form.desc)) return ''
  return `已自动译为中文（原文：${original}）`
}

function onPurposes(next) {
  form.purposes = normalizePurposes(next)
  touched.purposes = true
}

function hasCategory(id) {
  return Boolean(id) && categoriesStore.categories.some(c => c.id === id)
}

/** 当前生效的分类表（含用户新建的）→ 推断引擎要的 {label,color} 形状，保证推出来的分类真的在下拉框里 */
function categoryMetaFromStore() {
  const map = {}
  for (const g of categoriesStore.groups) {
    for (const c of g.categories) map[c.id] = { label: c.label, color: c.dotColor, group: g.label }
  }
  return map
}

/**
 * AI 润色（P4）：服务端声明可用才显示入口（沿用 v8「无 key 隐藏入口」的纪律）。
 * 只替换用户**还没手动改过**的字段 —— 润色结果要能一眼看出改了什么，
 * 而且不能把人已经写好的内容冲掉。
 */
// 焦点陷阱：这个弹窗是「v-if 挂载即显示」，所以 onMounted 就开陷阱；
// 卸载时由 composable 的 onBeforeUnmount 自动归还焦点（此前 Tab 会走到弹窗背后的卡片里）
const panelRef = ref(null)
const trap = useFocusTrap(panelRef)
onMounted(() => trap.activate())

const aiReady = ref(false)
const aiBusy = ref(false)
// v11：用 canPolish 而不是 ready —— 服务端必须同时满足「配好了」与「润色免鉴权」。
// 只看 ready 时，没有管理 key 的人会看到一个点了就报「请求失败」的按钮（这正是本次要修的）。
aiApi.probe().then(p => { aiReady.value = p.canPolish })

async function aiPolish() {
  aiBusy.value = true
  try {
    const r = await aiApi.polish(form.name, form.desc)
    if (!r.ok) throw new Error(r.error || '失败')
    if (r.name && !touched.name) form.name = r.name
    if (r.desc && !touched.desc) form.desc = r.desc
  } catch (e) {
    status.value = 'AI 润色失败：' + (e.message || e) + '（已保留原内容）'
    statusKind.value = 'warn'
  } finally {
    aiBusy.value = false
  }
}

/** 本次会话里由引擎自动新建的分类：没被人采纳时要在关闭前回收，避免留下空分类 */
let autoCategoryCreated = null

/** 修剪：自动新建的分类若没被采纳（用户换了分类 / 未提交就关闭）且无站点使用 → 回收 */
function pruneAutoCategory() {
  const ac = autoCategoryCreated
  if (!ac) return
  if (ac.id === form.categoryId) return
  const used = sitesStore.sites.some(s => s.categoryId === ac.id)
  if (!used) categoriesStore.removeCategory(ac.id)
  autoCategoryCreated = null
}

/**
 * 「分类未识别」的智能兜底：按页面内容（名称 / 描述 / 域名 / 用途）给出分类 ——
 * 本地已有同名分类就复用，没有就**自动新建**并归入（引擎永远有解，最后兜底「其他」）。
 *
 * 两段式的差异是刻意的：
 *   - 本地秒填阶段（空 HTML，只有域名信号）**只复用不新建** —— 建类是重动作，
 *     要等真实页面内容回来再定；此时用户看到「分类未识别」属预期。
 *   - 真实抓取阶段（拿到页面 title / 描述，且已译成中文）才允许新建，
 *     关键词匹配（主题表）与用途推断都在这个阶段才有真数据。
 */
async function ensureSmartCategory(data, { allowCreate, isAlive } = {}) {
  if (hasCategory(form.categoryId)) return
  let plan = null
  try {
    const suggestCategory = await loadSuggestCategory()
    plan = suggestCategory({
      categoryId: data.categoryId || '',
      categoryConfidence: data.confidence?.category || '',
      name: data.name || '',
      desc: data.desc || '',
      domain: data.domain || hostOf(form.url),
      purposes: data.purposes || [],
      existing: categoriesStore.categories.map(c => ({
        id: c.id, label: c.label, groupId: categoriesStore.getGroupByCategory(c.id)?.id || '',
      })),
      domainIds: categoriesStore.domains.map(d => d.id),
    })
  } catch { /* 引擎加载失败（pinyin chunk 拉取失败等）：保持未分类，用户手选 */ }
  if (!plan) return
  if (isAlive && !isAlive()) return
  if (plan.kind === 'use') { form.categoryId = plan.categoryId; return }
  if (!allowCreate) return
  const r = categoriesStore.addCategory(plan.groupId, { id: plan.id, label: plan.label, dotColor: plan.dotColor })
  if (!r.ok) return
  autoCategoryCreated = { id: r.id, label: plan.label }
  form.categoryId = r.id
}

/** 只覆盖「用户没改过」的字段；用户改过的保留，避免自动补全把人的输入冲掉 */
function applyMeta(data) {
  if (!touched.name && data.name) form.name = data.name
  if (!touched.desc && data.desc) form.desc = data.desc
  if (!touched.color && data.color) form.color = data.color
  if (!touched.categoryId && hasCategory(data.categoryId)) form.categoryId = data.categoryId
  // 用途是智能推断结果，作为默认值；用户一旦手动勾选就不再被覆盖
  if (!touched.purposes && Array.isArray(data.purposes)) form.purposes = normalizePurposes(data.purposes)
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
  touched.purposes = false
}

/**
 * 换了域名就等于换了另一个站点：清掉上一站的自动填充。
 * 否则新站抓取失败时（meta 为 null，不会覆盖任何字段），上一站的名称/描述/分类/图标
 * 会原样留在表单里被提交，落库成一条张冠李戴的记录。
 */
function resetForNewHost() {
  resetTouched()
  quickDraftHost = ''
  pruneAutoCategory()
  form.name = ''
  form.desc = ''
  form.categoryId = ''
  form.color = '#3b82f6'
  form.aliases = ''
  form.purposes = []
  faviconUrl.value = ''
  faviconHost.value = ''
  meta.value = null
}

function summarize(data) {
  const parts = []
  // 生效分类 = 表单当前选中的（含自动新建的）；推断结果无效时才回落到 data 里的值
  const effCat = hasCategory(form.categoryId) ? form.categoryId : data.categoryId
  const catLabel = data.categoryLabel || categoriesStore.getCategoryLabel(effCat)
  const isNew = autoCategoryCreated && autoCategoryCreated.id === effCat
  parts.push(hasCategory(effCat) ? `分类 ${catLabel}${isNew ? '（自动新建）' : ''}` : '分类未识别')
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

  /**
   * ① **本地推断先秒填，不等网络**：跑的是与服务端同一个 inferSite 引擎（空 HTML），
   * 同域已收录直接沿用真名。第一次会动态加载引擎 chunk（毫秒级、有缓存），
   * 之后就是纯本地计算 —— 表单在粘贴后立刻有内容，而不是盯着「抓取中」等 1~10 秒。
   * 用户改过的字段有 touched 守卫，稍后真实抓取回来也不会覆盖。
   */
  const local = await localSiteMeta(url, {
    existingSites: sitesStore.sites,
    categoryMeta: categoryMetaFromStore(),
  })
  if (seq !== reqSeq) return
  let localApplied = false
  if (local.ok) {
    meta.value = local.data
    applyMeta(local.data)
    localApplied = true
    fetching.value = false
    // 本地阶段**只复用不新建**（空 HTML 信号不足），建类等真实内容
    await ensureSmartCategory(local.data, { allowCreate: false, isAlive: () => seq === reqSeq })
    if (seq !== reqSeq) return
    status.value = '已按域名秒填草稿，正在后台抓取站点真实信息…'
    statusKind.value = 'loading'
  } else {
    // 网址本身不合法：真实抓取也不会有结果，直接给错误态
    status.value = local.message + '（可手动填写）'
    statusKind.value = 'err'
    fetching.value = false
    return
  }

  /**
   * ② 后台真实抓取（读对方页面的 title / 描述 / 图标），回来升级**未被手动改过**的字段。
   * 任何失败都静默保留本地草稿 —— 草稿已经可用了，失败只是「少一次升级」。
   */
  const r = await fetchSiteMeta(url)
  if (seq !== reqSeq) return
  if (!r.ok) {
    // 传输层已经给了具体原因（限流 / 内网地址被拒 / 接口不存在 / 网络不可达…），
    // 用它比我们自己的「后端抓取不可用」准确得多
    status.value = localMetaNotice(local.data, { ok: false, message: r.message })
    statusKind.value = 'warn'
    return
  }
  try {
    const data = r.data
    // 真实抓取没有比本地推断多出任何东西（典型：服务端也抓超时了，于是回退到同一套域名推断）
    const better = (data.name && data.name !== local.data.name) ||
      (data.desc && data.desc !== local.data.desc) ||
      (data.faviconUrl && data.faviconUrl !== local.data.faviconUrl)
    meta.value = data
    applyMeta(data)
    // 真实内容（含已译中文的描述）到齐，此时才允许**智能新建分类**并归入
    await ensureSmartCategory(data, { allowCreate: true, isAlive: () => seq === reqSeq })
    if (seq !== reqSeq) return
    pruneAutoCategory()
    if (better) {
      status.value = data.warning ? `${summarize(data)}；${data.warning}` : summarize(data)
      statusKind.value = data.warning ? 'warn' : 'ok'
    } else {
      // 接口是通的 —— 这里只能说「对方页面没读到」，不能像从前那样说「后端抓取不可用」
      status.value = localMetaNotice(local.data, { ok: true, warning: data.warning })
      statusKind.value = 'warn'
    }
  } catch (e) {
    // 抓取成功但回填失败（字段结构意外）—— 仍然是「可手动填写」，不能把弹窗卡在 loading
    status.value = '抓取结果无法解析：' + e.message + '（已保留域名推断草稿）'
    statusKind.value = 'err'
  }
}

// 粘贴/输入网址后自动补全：停顿 600ms 再抓，避免边打边请求
let inputTimer = null

/**
 * **零延迟**：本地推断不进防抖 —— 粘贴的瞬间表单就有内容（同域已收录沿用真名），
 * 600ms 防抖只留给真实抓取。partial 输入（还构不成网址）会被 localSiteMeta 的
 * URL 校验直接跳过；host 没变就不重算，避免逐字符重复计算。
 */
let quickDraftHost = ''
async function quickLocalDraft(raw) {
  const url = normalizeUrl(raw)
  if (!url) return
  const host = hostOf(url)
  if (!host || host === quickDraftHost) return
  quickDraftHost = host
  const seq = ++reqSeq
  const local = await localSiteMeta(url, {
    existingSites: sitesStore.sites,
    categoryMeta: categoryMetaFromStore(),
  })
  if (seq !== reqSeq || !local.ok) return
  meta.value = local.data
  applyMeta(local.data)
}
function onUrlInput() {
  submitError.value = ''
  clearTimeout(inputTimer)
  const host = hostOf(form.url)
  if (!host || host === lastHost) return
  quickLocalDraft(form.url.trim())
  inputTimer = setTimeout(() => { if (form.url.trim()) fetchMeta() }, 600)
}

function onUrlBlur() {
  clearTimeout(inputTimer)
  if (form.url.trim() && hostOf(form.url) !== lastHost) fetchMeta()
}

function submit() {
  // 同域名已在库里就别再插一条：卡片与分类会重复，云端同步时还会被当作两个站点
  const dup = findDuplicate(sitesStore.sites, form.url)
  if (dup) {
    submitError.value = `该域名已收录：${dup.name}（${dup.url}）。如需变更请编辑该站点，避免重复条目。`
    return
  }
  submitError.value = ''

  const { site } = buildSiteFromDraft({
    form,
    faviconUrl: faviconUrl.value,
    faviconHost: faviconHost.value,
  })

  const created = sitesStore.addSite(site)
  // 带上 id：App 据此把视图切到该分类并滚动定位到新卡片
  emit('saved', { id: created.id, name: site.name, url: site.url })
  requestClose()
}

/** 关闭前回收：自动新建但无人使用的分类一并清掉（用户已选它或站点已用它则保留） */
function requestClose() {
  pruneAutoCategory()
  emit('close')
}

// 从搜索框带网址进来时，挂载即预填并触发自动补全，省去用户再贴一次。
// 放在脚本末尾调用：此时 lastHost / reqSeq 等状态都已初始化完毕。
if (props.prefillUrl) {
  form.url = normalizeUrl(props.prefillUrl)
  fetchMeta()
}

/**
 * 预热：本地推断引擎（site-infer）与智能建类引擎（auto-category → pinyin-pro）都是
 * 动态 import 的 chunk —— 首次使用要等加载（实测 ~1.3s）。弹窗一打开就拉，
 * 用户粘贴网址时 chunk 已就位，「零延迟」对**第一次**添加也成立。
 */
import('../../shared/site-infer.mjs').catch(() => {})
loadSuggestCategory().catch(() => {})
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
.field-note.translated { color: #0d9488; }
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
.ai-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.ai-btn { padding: 4px 10px; font-size: 12px; border-radius: 6px; border: 1px solid var(--color-border); background: transparent; color: var(--text-primary); cursor: pointer; }
.ai-btn:disabled { opacity: .6; cursor: default; }
.ai-hint { font-size: 11px; color: var(--color-muted); }
.btn-primary { background: var(--accent); color: #fff; }
.btn-primary:hover { filter: brightness(1.1); }
.btn-small { padding: 4px 12px; font-size: 11px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg-white); color: var(--text-secondary); cursor: pointer; white-space: nowrap; }
.btn-small:hover { border-color: var(--accent); color: var(--accent); }
.btn-small:disabled { opacity: .5; cursor: not-allowed; }
.favicon-preview-row { display: flex; align-items: center; gap: 10px; }
.favicon-preview { width: 28px; height: 28px; border-radius: 6px; border: 1px solid var(--border); }
.favicon-domain { font-size: 12px; color: var(--text-secondary); }
</style>