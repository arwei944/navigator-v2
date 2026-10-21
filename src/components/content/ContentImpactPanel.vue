<script setup>
/**
 * 事件影响与跨事件扩散。
 *
 * 分数不是“真理”，面板同时展示评分依据（reasons）与建议动作，
 * 让读者自己判断是否值得跟进。
 */
defineProps({
  impact: { type: Object, default: null },
})
defineEmits(['select'])

function levelText(level) {
  return level === 'high' ? '高' : level === 'medium' ? '中' : '低'
}
</script>

<template>
  <template v-if="impact">
    <section class="cv-panel">
      <div class="cv-panel-head">
        <h3>事件影响（24h）</h3>
        <span class="cv-hint">多源 × 报道量 × 来源权重 × 实体 × 新鲜度</span>
      </div>
      <div class="cv-impact-list">
        <article v-for="item in impact.items.slice(0, 6)" :key="item.id" class="cv-impact-card">
          <header>
            <span class="cv-impact" :class="item.impact.level">
              影响 {{ item.impact.score }} · {{ levelText(item.impact.level) }}
            </span>
            <span class="cv-hint">{{ item.sourceCount }} 源 · {{ item.entryCount }} 条</span>
          </header>
          <b>{{ item.title }}</b>
          <p v-if="item.entities?.length" class="cv-impact-entities">
            实体：{{ item.entities.map(x => x.name).join('、') }}
          </p>
          <p class="cv-hint">{{ (item.impact.reasons || []).join(' · ') }}</p>
          <p v-if="item.actions?.length" class="cv-impact-action">建议：{{ item.actions[0] }}</p>
        </article>
        <p v-if="!impact.items.length" class="cv-empty">最近 24 小时没有形成事件</p>
      </div>
    </section>

    <section v-if="impact.cross?.length" class="cv-panel">
      <div class="cv-panel-head">
        <h3>跨事件扩散</h3>
        <span class="cv-hint">同一实体出现在多个中/高影响事件</span>
      </div>
      <ul class="cv-cross">
        <li v-for="item in impact.cross" :key="item.id">
          <b>{{ item.name }}</b>
          <span>{{ item.events.length }} 个事件</span>
          <button class="cv-mini" type="button" @click="$emit('select', item)">查看报道</button>
        </li>
      </ul>
    </section>
  </template>
</template>

<style scoped>
.cv-panel { margin-top: 16px; border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
.cv-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.cv-panel-head h3 { margin: 0; font-size: 15px; }
.cv-hint { color: var(--text-secondary); font-size: 11.5px; }
.cv-impact {
  padding: 1px 7px; border: 1px solid var(--border); border-radius: 999px;
  font-size: 10.5px; color: var(--text-secondary); white-space: nowrap;
}
.cv-impact.high { color: var(--danger, #b91c1c); border-color: currentColor; }
.cv-impact.medium { color: var(--warning, #b45309); border-color: currentColor; }
.cv-impact-list { display: flex; flex-direction: column; gap: 8px; }
.cv-impact-card { border: 1px solid var(--border); border-radius: 8px; padding: 10px; }
.cv-impact-card header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 5px; }
.cv-impact-card b { font-size: 13.5px; }
.cv-impact-card p { margin: 4px 0 0; font-size: 12px; line-height: 1.5; }
.cv-impact-entities { color: var(--text-secondary); }
.cv-impact-action { color: var(--accent); }
.cv-cross { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.cv-cross li { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.cv-cross li span { color: var(--text-secondary); font-size: 12px; }
.cv-mini {
  margin-left: auto; padding: 2px 8px; border: 1px solid var(--border); border-radius: 6px;
  background: transparent; color: var(--text-secondary); cursor: pointer; font-size: 11px;
}
.cv-mini:hover { border-color: var(--accent); color: var(--accent); }
.cv-empty { padding: 24px 0; text-align: center; color: var(--text-secondary); font-size: 13px; }
</style>