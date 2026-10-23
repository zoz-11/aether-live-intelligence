import { join } from 'node:path';
import { loadConfig, type Config } from './config.js';
import { openDb } from './db/index.js';
import { EventBus } from './events.js';
import { Vault } from './vault.js';
import { SettingsStore } from './settings.js';
import { ActivityLog } from './activity.js';
import { PluginRegistry } from './plugins/registry.js';
import { Sentinel } from './agent/sentinel.js';
import { MemoryService } from './memory/service.js';
import { ConversationStore } from './agent/conversations.js';
import { AgentRunner } from './agent/loop.js';
import { ModelGateway } from './models/gateway.js';
import { AppsStore } from './plugins/apps-store.js';
import { EmailService } from './email/service.js';
import { PhoneService } from './phone/service.js';
import { ComputerService } from './desktop/computer.js';
import { TaskService } from './tasks/service.js';
import { SkillService } from './skills.js';
import { McpManager } from './mcp.js';
import { Notifier } from './notify.js';
import { TelegramChannel } from './channels/telegram.js';
import { appsPlugin } from './plugins/apps/index.js';
import { corePlugin, memoryPlugin, screenPlugin, secretsPlugin, smartUiPlugin } from './plugins/basic.js';
import { browserPlugin, computerPlugin, devPlugin, webPlugin } from './plugins/hands.js';
import { emailPlugin, phonePlugin } from './plugins/identity.js';
import { skillsPlugin, tasksPlugin, telegramPlugin } from './plugins/autonomy.js';
import type { Aether } from './types.js';
import { log } from './util.js';

const l = log('aether');

export const BUILTIN_PLUGINS = [corePlugin, memoryPlugin, appsPlugin, smartUiPlugin, screenPlugin, secretsPlugin, webPlugin, devPlugin, computerPlugin, browserPlugin, emailPlugin, phonePlugin, tasksPlugin, skillsPlugin, telegramPlugin];

/** Wires every service together. Services reach each other lazily through the container getter. */
export async function createAether(opts: { config?: Partial<Config> & { dataDir?: string }; memoryDb?: boolean; skipBackground?: boolean } = {}): Promise<Aether> {
  const config = loadConfig(opts.config ?? {});
  const db = await openDb({ url: opts.memoryDb ? null : config.databaseUrl, ssl: config.databaseSsl, dir: opts.memoryDb ? null : config.dbDir });
  const bus = new EventBus();
  let aether: Aether;
  const get = () => aether;
  const settings = new SettingsStore(db, bus);
  aether = {
    config, db, bus, settings,
    vault: new Vault(db, config.masterKey),
    activity: new ActivityLog(db, bus),
    plugins: new PluginRegistry(get),
    sentinel: new Sentinel(get),
    memory: new MemoryService(get),
    conversations: new ConversationStore(db, bus),
    agent: new AgentRunner(get),
    models: new ModelGateway(get),
    apps: new AppsStore(db, bus),
    email: new EmailService(get),
    phone: new PhoneService(get),
    computer: undefined as unknown as ComputerService,
    tasks: new TaskService(get),
    skills: new SkillService(config.skillsDirs, join(config.dataDir, 'skills')),
    mcp: new McpManager(get),
    notify: new Notifier(get),
    telegram: new TelegramChannel(get),
    startedAt: new Date(),
    shutdown: async () => {
      aether.tasks.stop();
      aether.telegram.stop();
      await aether.email.stop();
      await aether.plugins.teardownAll();
      await aether.mcp.closeAll();
      await aether.computer.shutdown();
      await db.close();
    },
  };
  aether.computer = new ComputerService(get);
  await aether.sentinel.init();
  await aether.conversations.ensureMain();
  await aether.memory.ensureFiles();
  await aether.apps.seedIfEmpty();
  for (const p of BUILTIN_PLUGINS) aether.plugins.register(p);
  if (opts.skipBackground) {
    // Tests: register plugins without starting listeners/pollers.
    const rows = await db.query<{ id: string; enabled: boolean }>('select id, enabled from plugin_state');
    const state = new Map(rows.map((r) => [r.id, r.enabled]));
    for (const p of BUILTIN_PLUGINS) (aether.plugins as any).enabled.set(p.id, state.has(p.id) ? state.get(p.id) : p.defaultEnabled);
  } else {
    await aether.plugins.load();
    aether.mcp.loadAll().catch((e) => l.warn(`mcp: ${e.message}`));
    const s = await settings.get();
    if (s.computer.autoStart && aether.plugins.isEnabled('computer')) aether.computer.start().catch((e) => l.warn(`computer autostart: ${e.message}`));
  }
  bus.on('settings.changed', () => { aether.plugins.invalidate('computer'); });
  return aether;
}
