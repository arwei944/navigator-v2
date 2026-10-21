/**
 * 数据管理面板共用的「计划 → 落库」写入器。
 *
 * ## 为什么抽出来
 *
 * 修复、导入、合并三条路径最终都做同一件事：校验版本 → 调 `POST /api/sites`。
 * 之前这段逻辑在面板里写了一遍，导入又复制一遍 —— 版本闸门这种安全逻辑有两份实现，
 * 迟早会出现「一处改了、另一处忘了」。抽成一个函数后，三条路径共用同一道闸。
 *
 * ## 为什么必须校验版本
 *
 * 计划是基于「读到的那个版本」算出来的。这期间若有人发布过一次，直接写回会把那次
 * 改动整份覆盖掉 —— 正是 CAS 要防的丢更新。版本不一致就抛错，由调用方提示重新生成。
 */
import { dataManagerApi } from '@/services/dataManagerApi'
import { opsApi } from '@/services/opsApi'

/**
 * @param {() => string} getKey 读取当前管理凭据（登录状态可能在面板打开后变化）
 */
export function useDataWrite(getKey) {
  async function writePayload(payload, baseVersion) {
    const key = getKey()
    if (!payload || !Array.isArray(payload.sites)) throw new Error('计划数据缺失，无法写入')

    const cur = await dataManagerApi.summary(key)
    if (!cur.ok) throw new Error('应用前校验失败：' + (cur.error || '无法读取当前版本'))
    if (Number(cur.version) !== Number(baseVersion)) {
      throw new Error(
        `数据已被其他写入更新（计划基于 v${baseVersion}，当前 v${cur.version}），已拒绝应用。请重新生成计划。`,
      )
    }

    const res = await opsApi.publish(key, payload.sites, payload.categories)
    if (!res || res.ok === false) throw new Error('写入失败：' + ((res && res.error) || '未知错误'))
    return res.version
  }

  return { writePayload }
}
