<script setup>
import { ref, onMounted } from 'vue'
import { getGrantedScopes, setGrantedScopes } from '../../versioning/runtime.js'
const scopes = ref([])
onMounted(() => { scopes.value = getGrantedScopes() })
function toggle(s) {
  const set = new Set(scopes.value)
  set.has(s) ? set.delete(s) : set.add(s)
  scopes.value = [...set]
  setGrantedScopes(scopes.value)
}
</script>
<template>
  <div class="vp-scope-switcher">
    <span class="vp-scope-title">演示：读者权限范围</span>
    <label>
      <input type="checkbox" :checked="scopes.includes('beta-preview')"
             @change="toggle('beta-preview')" />
      持有 <code>beta-preview</code>（v3.0 私有预览）
    </label>
    <p class="vp-scope-hint">取消勾选即模拟“私有版撤权”：版本与章节立即对读者不可见。</p>
  </div>
</template>
<style scoped>
.vp-scope-switcher {
  border: 1px dashed var(--vp-c-divider); border-radius: 10px;
  padding: 12px 14px; font-size: 13px; display: flex; flex-direction: column; gap: 6px;
  background: var(--vp-c-bg-soft);
}
.vp-scope-title { font-weight: 700; }
.vp-scope-hint { color: var(--vp-c-text-2); font-size: 12px; margin: 0; }
</style>
