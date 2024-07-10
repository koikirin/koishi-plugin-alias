import { Command, Context, deepEqual, Dict, remove, Schema, Session } from 'koishi'
import { } from '@koishijs/plugin-admin'

declare module 'koishi' {
  namespace Command {
    interface Config {
      aliases?: AliasService.Alias[]
      defaultAliasGroup?: string
    }
  }

  interface Channel {
    aliasGroups?: string[]
  }
}

export const GLOBAL_ALIAS_GROUP = 'N/A'

export class AliasService {
  _store: AliasService.Alias[] = []

  constructor(public ctx: Context, public config: AliasService.Config) {
    ctx.schema.extend('command', Schema.object({
      aliases: Schema.array(Schema.object({
        name: Schema.string().description('别名'),
        source: Schema.string().description('参数'),
        // perms: Schema.array(String).role('perms'),
        aliasGroup: Schema.union(['', GLOBAL_ALIAS_GROUP, ...config.aliasGroups.flatMap(x => Object.keys(x))]).default('').description('别名组'),
        filter: Schema.computed(Boolean).description('过滤器').hidden(),
      })).default([]).role('table'),
      defaultAliasGroup: Schema.union(['', GLOBAL_ALIAS_GROUP, ...config.aliasGroups.flatMap(x => Object.keys(x))]).default('').description('默认别名组'),
    }), 900)

    ctx.model.extend('channel', {
      aliasGroups: 'array',
    })

    ctx.command('alias.switch <group>', { authority: 3, admin: { channel: true } })
      .channelFields(['aliasGroups'])
      .action(async ({ session }, group: string) => {
        const groups = this.config.aliasGroups.find(x => group in x)
        if (!groups) return '未找到对应的别名组'
        if (group in session.channel.aliasGroups) return '未改动'
        Object.keys(groups).forEach(x => remove(session.channel.aliasGroups, x))
        session.channel.aliasGroups.push(group)
        await session.channel.$update()
        return '成功'
      })

    ctx.before('attach-channel', (session, fields) => {
      if (!session.argv) return
      fields.add('aliasGroups')
    })

    ctx.on('attach', (session) => {
      const { argv } = session
      if (!argv || argv.command || argv.name) return

      const { stripped, isDirect } = argv.session
      // guild message should have prefix or appel to be interpreted as a command call
      const isStrict = this.ctx.root.config.prefixMode === 'strict' || !isDirect && !stripped.appel
      if (argv.root && stripped.prefix === null && isStrict) return
      const segments: string[] = []
      while (argv.tokens.length) {
        const { content } = argv.tokens[0]
        segments.push(content)
        const { alias } = this._resolve(segments.join('.'), session)
        if (!alias) break
        argv.tokens.shift()
        argv.command = ctx.$commander.get(alias.command)
        argv.args = alias.args
        argv.options = alias.options
      }
    }, true)

    const applyCommand = async (command: Command) => {
      if (!command) return
      ctx.setTimeout(() => {
        if (command.config.aliases?.length) {
          this._store = this._store.filter((alias) => alias.command !== command.name)
          this._store.push(...command.config.aliases.map(alias => {
            let parent = command.parent, aliasGroup = alias.aliasGroup || command.config.defaultAliasGroup
            while (!aliasGroup && parent) {
              aliasGroup ||= parent.config.defaultAliasGroup
              parent = parent.parent
            }
            if (alias.source) {
              const argv = command.parse(alias.source)
              return { command: command.name, args: argv.args, options: argv.options, ...alias, aliasGroup }
            } else {
              return { command: command.name, ...alias, aliasGroup }
            }
          }))
          command._disposables.push(() => {
            this._store = this._store.filter((alias) => alias.command !== command.name)
          })
        }
      }, 0)
    }

    ctx.$commander._commandList.forEach(applyCommand)
    ctx.on('command-added', applyCommand)
    ctx.on('command-updated', applyCommand)

    ctx.on('internal/before-update', (state, config) => {
      if (state.runtime.name !== 'CommandManager') return
      const modified: Record<string, boolean> = Object.create(null)
      const checkPropertyUpdate = (key: string) => modified[key] ??= !deepEqual(state.config[key], config[key])
      for (const key in { ...state.config, ...config }) {
        if (!(key in modified) && checkPropertyUpdate(key)) {
          ctx.logger.debug(`update command aliases: ${key}`)
          applyCommand(ctx.$commander.get(key))
        }
      }
    })
  }

  _resolve(key: string, session?: Session) {
    if (!key) return {}
    const segments = key.toLowerCase().split('.')
    let i = 1, name = segments[0], alias: AliasService.Alias
    while ((alias = this.get(name, session)) && i < segments.length) {
      name = alias.name + '.' + segments[i++]
    }
    return { alias, name }
  }

  checkAliasGroup(alias: AliasService.Alias, session?: Session<any, 'aliasGroups'>) {
    if (!alias.aliasGroup || alias.aliasGroup === GLOBAL_ALIAS_GROUP) return true
    if (session?.channel?.aliasGroups?.includes(alias.aliasGroup)) return true
    const groups = this.config.aliasGroups.find(x => alias.aliasGroup in x)
    if (!groups) return true
    if (groups[alias.aliasGroup] && !Object.keys(groups).some(x => session?.channel?.aliasGroups?.includes(x))) return true
    return false
  }

  get(name: string, session?: Session<any, 'aliasGroups'>) {
    return this._store.find((alias) =>
      alias.name === name && (session?.resolve(alias.filter) ?? true) && this.checkAliasGroup(alias, session),
    )
  }
}

export namespace AliasService {
  export interface Config {
    aliasGroups: Dict<boolean>[]
  }

  export const Config: Schema<Config> = Schema.object({
    aliasGroups: Schema.array(Schema.dict(Schema.boolean().default(false)).role('table')).default([]).description('Mutually Exclusive AliasGroups'),
  })

  export interface Alias extends Command.Alias {
    name: string
    source?: string
    // perms?: string[]
    command?: string
    aliasGroup?: string
  }
}

export default AliasService
