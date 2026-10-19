/**
 * 全能框的「自然语言 → 命令」解析（I3）。
 *
 * ## 一句话直接解析成一条命令
 *
 * 「切换到深色」→ 切换主题。解析不出来就什么都不做，绝不给一条「可能对」的猜测结果。
 *
 * ## 三条约束（缺一条都会变成噪音）
 *
 * 1. **只在无前缀时**：`>` / `@` / `/` 已有明确语义，不让自然语言插手。
 * 2. **只在 root 页**：站点二级页里用户是在挑对某个站的操作，不是下达全局命令。
 * 3. **解析不出就返回 null**：猜错的代价是这条搜索结果整段消失，所以宁可不猜。
 *
 * ## 误命中怎么退
 *
 * phrase 项是结果的第一项（默认选中），按一下 ↓ 就移到搜索结果 ——
 * 不需要记特殊快捷键，也不与 Esc=关闭面板的既有语义冲突。
 *
 * ## 为什么单独成文件
 *
 * 这段是「输入文本 → 一条候选」的纯映射，与分组渲染、键盘导航无关；
 * 抽出来后可以直接对「中文别名 / 拼音 / 精确词」三类输入断言命中与不命中。
 *
 * @param {object} deps
 * @param {import('vue').Ref<string>} deps.trimmed 去空白后的输入
 * @param {import('vue').Ref<string>} deps.prefix 前缀标记
 * @param {import('vue').Ref<object|null>} deps.page 是否在站点二级页
 * @param {import('vue').Ref<any[]>} deps.commands 命令表
 * @param {import('vue').Ref<object>} deps.phraseAliases 中文别名表（惰性加载）
 */
import { computed } from 'vue'
import { matchPhrase, describePhrase, PHRASE_MIN } from '@/utils/commandPhrases'

export function useOmniPhrase({ trimmed, prefix, page, commands, phraseAliases }) {
  const phraseHint = computed(() => {
    if (prefix.value || page.value) return null
    const q = trimmed.value
    if (q.length < PHRASE_MIN) return null
    return matchPhrase(q, commands.value, phraseAliases.value)
  })

  const phraseItem = computed(() => {
    const hit = phraseHint.value
    if (!hit) return null
    return {
      key: `phrase:${hit.cmd.id}`,
      type: 'phrase',
      title: hit.cmd.title,
      // 「理解为：深色 → 切换主题」—— 用户在按回车之前就能看到系统理解成了什么
      subtitle: `理解为：${describePhrase(hit)} · ↓ 看其它结果`,
      icon: hit.cmd.icon,
      danger: false,
      // 徽标用：明说这是系统猜的，不是用户搜出来的
      phrase: true,
      run: hit.cmd.run,
    }
  })

  return { phraseHint, phraseItem }
}
