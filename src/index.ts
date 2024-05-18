import { Command, Context, deepEqual, Schema, Session } from 'koishi'

declare module 'koishi' {
  namespace Command {
    interface Config {
      aliases: AliasService.Alias[]
    }
  }
}

export class AliasService {
  _store: AliasService.Alias[] = []

  constructor(public ctx: Context, public config: AliasService.Config) {
    ctx.schema.extend('command', Schema.object({
      aliases: Schema.array(Schema.object({
        name: Schema.string().description('别名'),
        source: Schema.string().description('参数'),
        // perms: Schema.array(String).role('perms'),
        filter: Schema.computed(Boolean).description('过滤器'),
      })).default([]),
    }), 900)

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
            if (alias.source) {
              const argv = command.parse(alias.source)
              return { command: command.name, args: argv.args, options: argv.options, ...alias }
            } else {
              return { command: command.name, ...alias }
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

  get(name: string, session?: Session) {
    return this._store.find((alias) => {
      return alias.name === name && (session?.resolve(alias.filter) ?? true)
    })
  }
}

export namespace AliasService {
  export interface Config {}

  export const Config: Schema<Config> = Schema.object({})

  export interface Alias extends Command.Alias {
    name: string
    source?: string
    // perms?: string[]
    command?: string
  }

}

export default AliasService
