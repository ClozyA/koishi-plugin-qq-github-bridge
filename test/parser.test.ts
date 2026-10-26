import { describe, expect, it } from 'vitest'
import { MessageParser } from '../src/utils/parser'
import { Config, validateConfig } from '../src/config'
import { configuration, GROUP, SECRET } from './helpers'

describe('configuration and parser', () => {
  it('preserves Markdown, Chinese, English, CRLF and trailing spaces', () => {
    const body = '中文 **Markdown** <tag> & English\r\n```js\n1 + 2\n```  '
    expect(new MessageParser(configuration()).parse(`re1003 ${body}`)).toEqual({ type: 'comment', number: 1003, body })
  })
  it('supports prefix changes and full custom multiline expressions', () => {
    expect(new MessageParser(configuration({ replyPrefix: 'reply' })).parse('reply42 hi')).toMatchObject({ number: 42, body: 'hi' })
    const parser = new MessageParser(configuration({ replyPattern: '^回复 #(?<number>\u005cd+):(?<body>[\u005cs\u005cS]+)$' }))
    expect(parser.parse('回复 #42:  正文\n第二行')).toEqual({ type: 'comment', number: 42, body: '  正文\n第二行' })
  })
  it.each(['[', '(?<number>\\d+)(?<body>.*)', '^(?<number>\\d+)(?<body>.*)(?=x)$', '^(?<number>\\d+)(?<body>.*)\\1$'])('rejects invalid / unsafe regex %s', replyPattern => {
    expect(() => new MessageParser(configuration({ replyPattern }))).toThrow()
  })
  it('executes nested quantifiers in linear time using RE2', () => {
    const parser = new MessageParser(configuration({ maxCommentLength: 30000, replyPattern: '^(?<number>1)(?<body>(a+)+)b$' }))
    const start = performance.now()
    expect(parser.parse('1' + 'a'.repeat(25000) + '!')).toBeNull()
    expect(performance.now() - start).toBeLessThan(1000)
  })
  it('protects admin and state namespaces even under a broad custom regex', () => {
    const parser = new MessageParser(configuration({ replyPattern: '^(?<body>.*)(?<number>\\d+)$' }))
    expect(parser.parse('close1003')).toEqual({ type: 'close', number: 1003 })
    expect(parser.parse('ghadmin\tadd 123456789')).toEqual({ type: 'admin-add', qq: '123456789' })
    expect(parser.parse('close1003 junk')).toMatchObject({ type: 'invalid' })
  })
  it.each(['normal chat', 'please re1 hello', 're-1 x', 're1https://evil.invalid x', 'close1/../../merge', 'openAI', 're1 hi\nclose2'])('does not escalate malformed or ordinary text %s', text => {
    const command = new MessageParser(configuration()).parse(text)
    expect(command?.type).not.toBe('close')
    expect(command?.type).not.toBe('open')
  })
  it.each(['re0 text', 're9007199254740992 text', 're1 ', 're1'])('rejects empty content / invalid issue numbers %s', text => {
    expect(new MessageParser(configuration()).parse(text)?.type).toBe('invalid')
  })
  it('rejects length excess, nul and disabled multiline', () => {
    const parser = new MessageParser(configuration({ maxCommentLength: 4, allowMultiline: false }))
    for (const text of ['re1 12345', 're1 a\nb', 're1 a\0']) expect(parser.parse(text)?.type).toBe('invalid')
  })
  it.each([
    { token: '' }, { token: 'invalid token' }, { superAdmins: [] },
    { apiBaseUrl: 'http://example.com' }, { apiBaseUrl: 'https://user:pass@api.github.com' },
    { apiBaseUrl: 'https://api.github.com?token=secret' }, { openPrefix: 'reopen' },
    { commentTemplate: '{body} {body}' }, { commentTemplate: '{body} {nickname}' },
    { commentTemplate: SECRET + '{body}' },
    { bindings: [{ groupId: GROUP, owner: 'owner', repo: '..', enabled: true }] },
    { bindings: [{ groupId: GROUP, owner: 'https://github.com', repo: 'a', enabled: true }] },
  ])('validates security constraints without reflecting secret values %#', overrides => {
    expect(() => configuration(overrides)).toThrow()
    try { configuration(overrides) } catch (error) { expect(String(error)).not.toContain(SECRET) }
  })
  it('rejects duplicate bindings and invalid defaults at enable time', () => {
    const config = configuration()
    config.bindings.push(config.bindings[0])
    expect(() => validateConfig(config)).toThrow('同一 QQ 群')
    expect(() => Config({ token: SECRET, superAdmins: ['bad'] })).toThrow()
  })
})
