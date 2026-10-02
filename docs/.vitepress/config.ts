import { defineConfig } from 'vitepress'
import mdContainer from 'markdown-it-container'
import fs from 'fs'
import path from 'path'

function withStableHeadingIds(md: Parameters<Parameters<typeof defineConfig>[0]['markdown']['config']>[0]) {
  md.core.ruler.after('inline', 'stable-heading-ids', (state) => {
    for (const token of state.tokens) {
      if (token.type !== 'heading_open') continue
      const inline = state.tokens[state.tokens.indexOf(token) + 1]
      const match = inline.content.match(/^(.*?)\s+\{#([\w-]+)\}\s*$/)
      if (!match) continue
      inline.content = match[1]
      if (inline.children?.length) {
        const lastText = inline.children[inline.children.length - 1]
        lastText.content = lastText.content.replace(/\s+\{#[\w-]+\}\s*$/, '')
      }
      token.attrSet('id', match[2])
    }
  })
}

function sidebar(versionBase = '', localeBase = '') {
  const prefix = `${localeBase}${versionBase}`
  const zh = localeBase === ''
  return {
    [`${prefix}/guide/`]: [
      {
        text: zh ? '指南' : 'Guide',
        items: versionBase === '/v1'
          ? [{ text: zh ? '快速上手' : 'Getting Started', link: `${prefix}/guide/start` }]
          : versionBase === '/v3'
            ? [{ text: zh ? '快速上手（合并版）' : 'Getting Started (merged)', link: `${prefix}/guide/start` }]
            : [
                { text: zh ? '安装' : 'Installation', link: `${prefix}/guide/installation` },
                { text: zh ? '快速开始' : 'Quick Start', link: `${prefix}/guide/quickstart` }
              ]
      }
    ],
    [`${prefix}/components/`]: [
      {
        text: zh ? '组件' : 'Components',
        items: [{ text: zh ? 'Button 按钮' : 'Button', link: `${prefix}/components/button` }]
      }
    ]
  }
}

export default defineConfig({
  title: 'My Component Lib',
  description: 'A UI Component Library based on Vue 3',
  lastUpdated: true,
  cleanUrls: true,
  appearance: true,

  markdown: {
    config: (md) => {
      withStableHeadingIds(md)
      md.use(mdContainer, 'demo', {
        validate(params) {
          return !!params.trim().match(/^demo\s*(.*)$/)
        },
        render(tokens, idx) {
          if (tokens[idx].nesting === 1) {
            const m = tokens[idx].info.trim().match(/^demo\s*(.*)$/)
            const description = m && m.length > 1 ? m[1] : ''

            let i = idx + 1
            let sourceFile = ''
            while (tokens[i] && tokens[i].nesting !== -1) {
              if (tokens[i].type === 'inline' || tokens[i].type === 'text') {
                sourceFile = tokens[i].content.trim()
                break
              }
              i++
            }

            let source = ''
            if (sourceFile) {
              const filePath = path.resolve('docs', sourceFile)
              if (fs.existsSync(filePath)) {
                source = fs.readFileSync(filePath, 'utf-8')
              } else {
                return `<div class="danger custom-block"><p class="custom-block-title">Demo Error</p><p>File not found: <code>${sourceFile}</code></p></div>`
              }
            }

            const name = sourceFile?.replace(/\//g, '-').replace('.vue', '')

            return `<VpDemo>
              ${description ? `<template #description>${md.render(description)}</template>` : ''}
              <template #source>
                ${md.render(`\`\`\`vue\n${source}\n\`\`\``)}
              </template>
              <demo-${name} />
            </VpDemo>\n`
          }
          return ''
        }
      })
    }
  },

  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-CN',
      themeConfig: {
        nav: [
          { text: '指南', link: '/guide/installation', activeMatch: '/guide/' },
          { text: '组件', link: '/components/button', activeMatch: '/components/' }
        ],
        sidebar: {
          ...sidebar(''),
          ...sidebar('/v1'),
          ...sidebar('/v3')
        },
        footer: {
          message: '基于 MIT 许可发布',
          copyright: '版权所有 © 2024-至今'
        }
      }
    },
    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      themeConfig: {
        nav: [
          { text: 'Guide', link: '/en/guide/installation', activeMatch: '/en/guide/' },
          { text: 'Components', link: '/en/components/button', activeMatch: '/en/components/' }
        ],
        sidebar: {
          ...sidebar('', '/en'),
          ...sidebar('/v1', '/en'),
          ...sidebar('/v3', '/en')
        },
        footer: {
          message: 'Released under the MIT License.',
          copyright: 'Copyright © 2024-present'
        }
      }
    }
  },

  themeConfig: {
    search: {
      provider: 'local'
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/vuejs/vitepress' }
    ]
  }
})
