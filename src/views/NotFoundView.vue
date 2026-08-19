<template>
  <div class="not-found">
    <h1>404</h1>
    <p>页面未找到</p>
    <router-link to="/">返回首页</router-link>
  </div>
</template>

<script setup>
</script>

<style scoped>
.not-found { text-align: center; padding: 100px 20px; }
.not-found h1 { font-size: 64px; color: var(--text-secondary); margin-bottom: 8px; }
.not-found p { color: var(--text-secondary); margin-bottom: 20px; }
</style>