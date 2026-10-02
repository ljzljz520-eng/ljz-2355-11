import DefaultTheme from 'vitepress/theme'
import VpDemo from './components/VpDemo.vue'
import VpApi from './components/VpApi.vue'
import BaseButton from './components/BaseButton.vue'
import VersionTerm from './components/versioning/VersionTerm.vue'
import VersionLegacy from './components/versioning/VersionLegacy.vue'
import VersionBadge from './components/versioning/VersionBadge.vue'
import ScopeSwitcher from './components/versioning/ScopeSwitcher.vue'
import DocsVersionLayout from './components/versioning/DocsVersionLayout.vue'
import './custom.css'
import './versioning.css'

export default {
  extends: DefaultTheme,
  Layout: DocsVersionLayout,
  enhanceApp({ app }) {
    app.component('VpDemo', VpDemo)
    app.component('VpApi', VpApi)
    app.component('BaseButton', BaseButton)
    // 版本导航相关
    app.component('VersionTerm', VersionTerm)
    app.component('VersionLegacy', VersionLegacy)
    app.component('VersionBadge', VersionBadge)
    app.component('ScopeSwitcher', ScopeSwitcher)

    // Auto register examples
    const examples = import.meta.glob('../../examples/**/*.vue', { eager: true })
    for (const path in examples) {
      const name = path
        .replace('../../examples/', 'demo-')
        .replace(/\//g, '-')
        .replace('.vue', '')
      app.component(name, (examples[path] as any).default)
    }
  }
}
