<template>
  <div class="share-view">
    <div class="share-card">
      <h1>收录到导航站</h1>

      <template v-if="state === 'adding'">
        <p class="share-note">正在识别并收录…</p>
      </template>

      <template v-else-if="state === 'done'">
        <p class="share-ok">已添加「{{ site.name }}」{{ categoryLabel ? `到「${categoryLabel}」` : '' }}</p>
        <div class="share-actions">
          <router-link class="share-btn primary" to="/">打开首页</router-link>
        </div>
      </template>

      <template v-else-if="state === 'duplicate'">
        <p class="share-note">「{{ existingName }}」已在你的导航站里。</p>
        <div class="share-actions">
          <router-link class="share-btn primary" to="/">打开首页</router-link>
        </div>
      </template>

      <template v-else>
        <p class="share-note">{{ failMessage || '分享内容里没有识别到网址。' }}</p>
        <div class="share-manual">
          <input v-model="manual" class="share-input" placeholder="粘贴网址后点收录"
                 @keyup.enter="submit(manual)" />
          <button class="share-btn" type="button" :disabled="!manual.trim() || state === 'adding'"
                  @click="submit(manual)">收录</button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
/**
 * 分享接收页（G4 / L0-2）：系统分享面板 → 收录，全程不进后台、不填表单。
 *
 * 收录复用站内既有的秒加链路（services/autoAdd.autoAddSite：识别 → 分类 → 入库 →
 * 后台补全），这里只做「取出网址 → 调用 → 汇报结果」。网址取不出时给手动粘贴兜底 ——
 * 分享源五花八门，不能假装总能猜到。
 */
import { onMounted, ref } from 'vue'
import { autoAddSite } from '@/services/autoAdd'
import { extractSharedUrl } from '@/utils/shareTarget'

const state = ref('adding') // adding | done | duplicate | fail
const site = ref(null)
const categoryLabel = ref('')
const existingName = ref('')
const failMessage = ref('')
const manual = ref('')

async function submit(rawUrl) {
  const url = String(rawUrl || '').trim()
  if (!url) return
  state.value = 'adding'
  const res = await autoAddSite({ url }).catch(() => null)
  if (!res) {
    failMessage.value = '收录失败，请稍后重试。'
    state.value = 'fail'
    return
  }
  if (res.ok) {
    site.value = res.site
    categoryLabel.value = res.category?.label || ''
    state.value = 'done'
    return
  }
  if (res.existing) {
    existingName.value = res.existing.name || ''
    state.value = 'duplicate'
    return
  }
  failMessage.value = res.message || '收录失败。'
  state.value = 'fail'
}

onMounted(() => {
  const q = new URLSearchParams(location.search)
  submit(extractSharedUrl({
    url: q.get('url'), text: q.get('text'), title: q.get('title'),
  }))
})
</script>

<style scoped>
.share-view { display: flex; align-items: center; justify-content: center; min-height: 60vh; padding: 24px 16px; }
.share-card { width: 100%; max-width: 420px; background: var(--bg-white); border: 1px solid var(--border-light); border-radius: var(--radius, 16px); padding: 28px 24px; text-align: center; }
.share-card h1 { font-size: 18px; margin-bottom: 14px; color: var(--text-primary); }
.share-note { color: var(--text-secondary); font-size: 14px; line-height: 1.6; margin-bottom: 16px; }
.share-ok { color: var(--ok-fg, var(--text-primary)); font-size: 14px; margin-bottom: 16px; }
.share-actions { display: flex; justify-content: center; }
.share-btn { padding: 8px 18px; border: 1px solid var(--accent); border-radius: 999px; background: transparent; color: var(--accent); font-size: 13px; font-family: var(--font); cursor: pointer; text-decoration: none; transition: background var(--dur-fast) ease, color var(--dur-fast) ease; }
.share-btn:hover { background: var(--accent); color: var(--color-on-solid); }
.share-btn.primary { background: var(--accent); color: var(--color-on-solid); }
.share-btn:disabled { opacity: .5; cursor: default; }
.share-manual { display: flex; gap: 8px; }
.share-input { flex: 1; min-width: 0; padding: 8px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-white); color: var(--text-primary); font-size: 13px; font-family: var(--font); outline: none; }
.share-input:focus { border-color: var(--accent); }
</style>
