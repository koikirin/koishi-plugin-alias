import { App } from 'koishi'
import AliasService from '../src'
import admin from '@koishijs/plugin-admin'
import * as help from '@koishijs/plugin-help'
import memory from '@koishijs/plugin-database-memory'
import mock from '@koishijs/plugin-mock'

const app = new App()

app.plugin(memory)
app.plugin(mock)
app.plugin(admin)
app.plugin(help)

const client = app.mock.client('123', '321')

app.plugin(AliasService, {
  aliasGroups: [
    {
      'g1': false,
      'g2': true,
    },
  ],
})
app.command('foo', { authority: 4 })
app.command('bar', { aliases: [{ name: 'zab', aliasGroup: 'g1' }]}).action(() => 'rab')
app.command('baz', { aliases: [{ name: 'zab', aliasGroup: 'g2' }]}).action(() => 'zab')

before(async () => {
  await app.start()
  await app.mock.initUser('123', 3)
  await app.mock.initChannel('321')
})

beforeEach(async () => {
  await app.database.setChannel('mock', '321', {
    enable: [],
    disable: []
  })
})

describe('koishi-plugin-alias', () => {
  it('basic support', async () => {
    await client.shouldReply('baz', 'zab')
    await client.shouldReply('bar', 'rab')
    await client.shouldReply('zab', 'zab')
    await client.shouldReply('alias.switch g1', '成功')
    await client.shouldReply('zab', 'rab')
    await client.shouldReply('alias.switch g2', '成功')
    await client.shouldReply('zab', 'zab')
  })
})
