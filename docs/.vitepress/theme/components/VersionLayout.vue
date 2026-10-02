<script setup>
import DefaultTheme from 'vitepress/theme'
import VersionSwitcher from './VersionSwitcher.vue'
import VersionChapters from './VersionChapters.vue'
import VersionStateRestorer from './VersionStateRestorer.vue'

const { Layout } = DefaultTheme
</script>

<template>
  <Layout>
    <template #nav-bar-content-before>
      <VersionSwitcher />
    </template>
    <template #sidebar-nav-before>
      <VersionChapters />
    </template>
  </Layout>
  <VersionStateRestorer />
</template>
