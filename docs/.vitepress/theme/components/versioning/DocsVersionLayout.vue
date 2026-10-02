<script setup>
import DefaultTheme from 'vitepress/theme'
import VersionSwitcher from './VersionSwitcher.vue'
import VersionBanner from './VersionBanner.vue'
import VersionStateRestore from './VersionStateRestore.vue'
import LegacyLinkResolver from './LegacyLinkResolver.vue'

const { Layout } = DefaultTheme
</script>

<template>
  <Layout>
    <template #nav-bar-content-after>
      <VersionSwitcher />
    </template>
    <template #doc-before>
      <VersionBanner />
    </template>
    <template #doc-after>
      <VersionStateRestore />
    </template>
    <template #not-found>
      <LegacyLinkResolver />
    </template>
  </Layout>
</template>
