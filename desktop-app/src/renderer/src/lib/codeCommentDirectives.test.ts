import { describe, expect, it } from 'vitest'

import { parseCodeCommentDirectives } from './codeCommentDirectives'

describe('parseCodeCommentDirectives', () => {
  it('extracts a standalone directive and removes only its line', () => {
    const result = parseCodeCommentDirectives(
      [
        '发现一个问题。',
        '::code-comment{title="空值未处理" body="这里可能抛出异常。" file="src/app.ts" start=12 end=14 priority=1 confidence=0.9}',
        '',
        '其余逻辑正常。'
      ].join('\n')
    )

    expect(result.visibleText).toBe('发现一个问题。\n\n其余逻辑正常。')
    expect(result.comments).toEqual([
      {
        title: '[P1] 空值未处理',
        body: '这里可能抛出异常。',
        file: 'src/app.ts',
        priority: 'P1',
        confidence: 0.9,
        startLine: 12,
        endLine: 14
      }
    ])
  })

  it('trims required fields, accepts a P-prefixed priority, and preserves title priority', () => {
    const result = parseCodeCommentDirectives(
      '::code-comment{title="  [P2] 越界访问  " body="  需要检查长度。  " file="  src/list.ts  " priority="P3"}'
    )

    expect(result).toEqual({
      visibleText: '',
      comments: [
        {
          title: '[P2] 越界访问',
          body: '需要检查长度。',
          file: 'src/list.ts',
          priority: 'P2',
          startLine: 1,
          endLine: 1
        }
      ]
    })
  })

  it('parses escaped quotes and backslashes without interpreting other escapes', () => {
    const result = parseCodeCommentDirectives(
      String.raw`::code-comment{title="处理 \"quoted\" 值" body="保留 \n，并支持 \\ 路径。" file="C:\\repo\\app.ts"}`
    )

    expect(result.comments[0]).toMatchObject({
      title: '处理 "quoted" 值',
      body: String.raw`保留 \n，并支持 \ 路径。`,
      file: String.raw`C:\repo\app.ts`
    })
  })

  it('clamps line ranges and falls back when optional numbers are invalid', () => {
    const result = parseCodeCommentDirectives(
      [
        '::code-comment{title="负数" body="说明" file="a.ts" start=-4 end=-9}',
        '::code-comment{title="反向范围" body="说明" file="b.ts" start=8 end=2}',
        '::code-comment{title="无效数字" body="说明" file="c.ts" start=nope end=3 confidence=unknown}'
      ].join('\n')
    )

    expect(result.comments).toMatchObject([
      { startLine: 1, endLine: 1 },
      { startLine: 8, endLine: 8 },
      { startLine: 1, endLine: 3 }
    ])
    expect(result.comments[2]).not.toHaveProperty('confidence')
  })

  it('deduplicates by file, range, title, and body while preserving first occurrence', () => {
    const first =
      '::code-comment{title="重复" body="同一问题" file="src/a.ts" start=4 priority=1 confidence=0.8}'
    const duplicate =
      '::code-comment{title="[P1] 重复" body="同一问题" file="src/a.ts" start=4 priority=1 confidence=0.2}'
    const result = parseCodeCommentDirectives(`${first}\n${duplicate}`)

    expect(result.comments).toHaveLength(1)
    expect(result.comments[0]?.confidence).toBe(0.8)
  })

  it.each([
    '前缀 ::code-comment{title="标题" body="正文" file="a.ts"}',
    '  ::code-comment{title="标题" body="正文" file="a.ts"}',
    '::code-comment{title="缺少正文" file="a.ts"}',
    '::code-comment{title="" body="正文" file="a.ts"}',
    '::code-comment{title="标题" body="正文" file="a.ts"} trailing',
    '::code-comment{title="未闭合 body="正文" file="a.ts"}'
  ])('preserves invalid or non-standalone text: %s', (text) => {
    expect(parseCodeCommentDirectives(text)).toEqual({ visibleText: text, comments: [] })
  })

  it('preserves original line endings around removed directives', () => {
    const directive = '::code-comment{title="标题" body="正文" file="a.ts"}'

    expect(parseCodeCommentDirectives(`前文\r\n${directive}\r\n后文`).visibleText).toBe(
      '前文\r\n后文'
    )
    expect(parseCodeCommentDirectives(`${directive}\r后文`).visibleText).toBe('后文')
    expect(parseCodeCommentDirectives(`前文\n${directive}`).visibleText).toBe('前文\n')
  })

  it('returns empty input unchanged', () => {
    expect(parseCodeCommentDirectives('')).toEqual({ visibleText: '', comments: [] })
  })
})
