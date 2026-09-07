import type { Client, InArgs, InStatement } from '@libsql/client';

export type VoiceDatabaseClient = Pick<Client, 'execute' | 'executeMultiple' | 'batch' | 'close'>;

// Only our static SQL identifiers are rewritten. Bound values (including story
// text) never pass through this function. Local files keep their existing schema.
const names = [
  'generation_templates', 'generation_templates_by_expiry',
  'generation_leases', 'generation_leases_by_expiry',
  'atlas_call_usage', 'atlas_call_usage_by_updated',
  'installation_generation_state', 'installation_generation_state_by_updated',
  'installation_requests', 'installation_requests_by_time', 'installation_requests_by_expiry',
  'registered_graphs', 'registered_graphs_by_updated', 'voice_stories', 'voice_selections',
  'voice_story_catalogs', 'voice_story_catalogs_created', 'voice_story_refresh_guard',
];
const identifiers = new RegExp(`\\b(${names.join('|')})\\b`, 'g');
export const voiceDatabaseSql = (sql: string) => sql.replace(identifiers, name => `the_voice_v1_${name}`);

export function voiceDatabaseClient(client: VoiceDatabaseClient, hosted: boolean): VoiceDatabaseClient {
  if (!hosted) return client;
  const statement = (input: InStatement): InStatement => typeof input === 'string'
    ? voiceDatabaseSql(input) : { ...input, sql: voiceDatabaseSql(input.sql) };
  return {
    execute: (input: InStatement, args?: InArgs) => typeof input === 'string'
      ? client.execute(voiceDatabaseSql(input), args) : client.execute(statement(input)),
    executeMultiple: sql => client.executeMultiple(voiceDatabaseSql(sql)),
    batch: (inputs, mode) => client.batch(inputs.map(input => Array.isArray(input)
      ? [voiceDatabaseSql(input[0]), input[1]] : statement(input)), mode),
    close: () => client.close(),
  };
}
