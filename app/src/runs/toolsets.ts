import { McpServerName, WorkflowMode } from '../generated/prisma/enums';

/**
 * Which tools of which server a run of each mode sees. The constants mirror the contract.
 *
 * The running App does not read the contracts, so the contract is implemented here as constants,
 * and a contract test enforces the agreement with it (`contracts/canonical.yaml`, keys
 * `mcp_toolsets` and `mode_toolsets`).
 *
 * The constants live here, in `runs/`, because the set of tools is a property of a run's mode, and
 * two parties that know nothing of each other ask about it: the runner builds its allow-set from
 * it, and the App MCP builds from it what the run's session sees.
 */

/**
 * The servers of a run. The list is the schema's enum, not a second list beside it: the same list
 * types the call's server in the trace (`run_tool_calls`), so the perimeter and the trace name the
 * servers identically.
 */
export const MCP_SERVER_NAMES: readonly McpServerName[] = Object.values(McpServerName);

/**
 * The capabilities of a server, the bundles over them, the withheld capabilities and the untriaged
 * names.
 */
interface ServerToolset {
  readonly capabilities: Readonly<Record<string, readonly string[]>>;
  readonly bundles: Readonly<Record<string, readonly string[]>>;
  readonly withheld: readonly string[];
  readonly untriaged: readonly string[];
  /**
   * The capabilities by which the system writes to Notion on its own behalf, a closed list of
   * intents (ADR 0017). Only the App has them: domains speak in the person's voice.
   */
  readonly systemVoice: readonly string[];
}

/** A row of the mode → toolset matrix: the bundles of each server. */
type ModeToolset = Readonly<Record<McpServerName, readonly string[]>>;

export const MCP_TOOLSETS: Readonly<Record<McpServerName, ServerToolset>> = {
  app: {
    capabilities: {
      comment_write: ['add_comment'],
      capture_convert: ['convert_inbox_item'],
      capture_close: ['close_inbox_item'],
      capture_park: ['park_inbox_item'],
      continuation_write: ['schedule_continuation', 'reschedule_continuation'],
      continuation_read: ['get_continuation_state'],
      delivery_write: ['queue_notification'],
      delivery_read: ['get_delivery_state'],
      approval_propose: ['create_pending_action'],
      approval_read: ['get_pending_action', 'list_pending_actions'],
      approval_decide: ['decide_pending_action'],
      runtime_read: ['get_runtime_state'],
      schema_read: ['get_schema_mapping'],
      memory_record: ['record_memory'],
    },
    bundles: {
      attention: ['comment_write'],
      capture: ['capture_convert', 'capture_close'],
      continuation: ['continuation_write', 'continuation_read'],
      delivery: ['delivery_write', 'delivery_read'],
      approval: ['approval_propose', 'approval_read'],
      approval_view: ['approval_read'],
      introspection: ['runtime_read', 'schema_read'],
      memory: ['memory_record'],
    },
    withheld: ['approval_decide', 'capture_park'],
    untriaged: [],
    systemVoice: ['comment_write', 'capture_convert', 'capture_close', 'memory_record'],
  },
  notion: {
    capabilities: {
      search: ['notion-search'],
      ai_search: ['notion-ai-search'],
      fetch: ['notion-fetch'],
      query: ['notion-query-data-sources', 'notion-query-multiple-data-sources'],
      lists: [
        'notion-list-recent-pages',
        'notion-list-shared-pages',
        'notion-list-private-pages',
        'notion-list-favorite-pages',
      ],
      directory: ['notion-get-users', 'notion-get-teams'],
      comments_read: ['notion-get-comments'],
      comments_write: ['notion-create-comment'],
      comments_edit: [
        'notion-update-comment',
        'notion-delete-comment',
        'notion-set-comment-reaction',
      ],
      discussion_resolution: ['notion-set-discussion-resolved'],
      backlinks: ['notion-list-page-backlinks'],
      groups: ['notion-get-groups'],
      page_create: ['notion-create-pages'],
      page_update: ['notion-update-page'],
      async_status: ['notion-get-async-task'],
      schema_mutation: [
        'notion-create-database',
        'notion-update-data-source',
        'notion-create-view',
        'notion-update-view',
      ],
      structure_mutation: [
        'notion-move-pages',
        'notion-duplicate-page',
        'notion-create-folder',
        'notion-update-folder',
        'notion-restore-pages',
      ],
      trashing: ['notion-delete-pages', 'notion-delete-databases'],
      attachments: [
        'notion-create-attachment',
        'notion-create-file-upload',
        'notion-download-attachment',
        'notion-get-file-download-urls',
      ],
      notion_skills: [
        'notion-convert-page-to-skill',
        'notion-upload-skill',
        'notion-download-skill',
        'notion-get-enabled-skills',
        'notion-update-enabled-skills',
      ],
      custom_agents: [
        'notion-spawn-session',
        'notion-stop-session',
        'notion-wait-session',
        'notion-send-message-to-session',
        'notion-get-session-status',
        'notion-query-sessions',
        'notion-search-sessions',
        'notion-list-session-events',
        'notion-read-session-event',
        'notion-search-agents',
      ],
      meeting_notes: ['notion-query-meeting-notes'],
      calendar: [
        'notion-calendar-list-calendars',
        'notion-calendar-list-events',
        'notion-calendar-list-coworkers-events',
        'notion-calendar-list-calendar-resources',
        'notion-calendar-list-contacts',
        'notion-calendar-create-events',
        'notion-calendar-update-events',
        'notion-calendar-cancel-events',
      ],
      agent_memory: ['notion-memory-search'],
      vendor_ui_cards: ['notion-check-mcp-next-steps', 'notion-show-advanced-analysis-next-steps'],
      suggested_edits: [
        'notion-create-suggested-edit',
        'notion-get-suggested-edit',
        'notion-resolve-suggested-edit',
      ],
      tool_access_introspection: ['notion-get-tool-access'],
      identity_introspection: ['notion-get-self'],
    },
    bundles: {
      read: ['search', 'fetch', 'query', 'lists', 'directory', 'comments_read'],
    },
    withheld: [
      'page_create',
      'page_update',
      'comments_write',
      'comments_edit',
      'discussion_resolution',
      'backlinks',
      'groups',
      'trashing',
      'ai_search',
      'async_status',
      'schema_mutation',
      'structure_mutation',
      'attachments',
      'notion_skills',
      'custom_agents',
      'meeting_notes',
      'calendar',
      'agent_memory',
      'vendor_ui_cards',
      'suggested_edits',
      'tool_access_introspection',
      'identity_introspection',
    ],
    untriaged: [],
    systemVoice: [],
  },
  gbrain: {
    capabilities: {
      search: ['search', 'query'],
      pages: ['get_page', 'list_pages', 'resolve_slugs'],
      hybrid_retrieval: ['context_pack', 'delta', 'entity'],
      facts_read: ['recall'],
      timeline_read: ['get_timeline'],
      graph_read: ['get_links', 'get_backlinks', 'traverse_graph'],
      identity: ['whoami'],
      facts_write: ['remember'],
      timeline_write: ['add_timeline_entry'],
      graph_write: ['add_link'],
      page_write: ['put_page'],
      synthesis: ['synthesize'],
      facts_forget: ['forget'],
    },
    bundles: {
      read: [
        'search',
        'pages',
        'hybrid_retrieval',
        'facts_read',
        'timeline_read',
        'graph_read',
        'identity',
      ],
      write: ['facts_write', 'timeline_write', 'graph_write', 'page_write'],
    },
    withheld: ['synthesis', 'facts_forget'],
    systemVoice: [],
    untriaged: [
      'add_tag',
      'capture',
      'chronicle_day',
      'chronicle_last_seen',
      'chronicle_on_this_day',
      'chronicle_since',
      'code_blast',
      'code_callees',
      'code_callers',
      'code_def',
      'code_flow',
      'code_refs',
      'delete_page',
      'entity_identity_list',
      'extract_entities',
      'extract_facts',
      'extraction_pending',
      'fetch',
      'find_anomalies',
      'find_contradictions',
      'find_experts',
      'find_orphans',
      'find_trajectory',
      'forget_fact',
      'get_active_schema_pack',
      'get_brain_identity',
      'get_calibration_profile',
      'get_chunks',
      'get_ingest_log',
      'get_raw_data',
      'get_recent_salience',
      'get_skill',
      'get_tags',
      'get_versions',
      'list_brain_skillpack',
      'list_link_sources',
      'list_schema_packs',
      'list_skills',
      'log_ingest',
      'loops_close',
      'loops_mute',
      'loops_unmute',
      'ontology_conflicts',
      'ontology_dimensions',
      'ontology_get',
      'ontology_propose',
      'open_loops',
      'put_raw_data',
      'remove_link',
      'remove_tag',
      'request_tools',
      'restore_page',
      'revert_version',
      'schema_explain_type',
      'schema_graph',
      'schema_lint',
      'schema_review_orphans',
      'schema_stats',
      'search_by_image',
      'search_modes',
      'sources_list',
      'sources_status',
      'takes_add',
      'takes_calibration',
      'takes_list',
      'takes_resolve',
      'takes_scorecard',
      'takes_search',
      'takes_supersede',
      'takes_update',
      'think',
      'volunteer_chronicle',
      'volunteer_context',
    ],
  },
};

export const MODE_TOOLSETS: Readonly<Record<WorkflowMode, ModeToolset>> = {
  event_evaluation: {
    notion: ['read'],
    gbrain: ['read'],
    app: ['attention', 'continuation', 'delivery', 'approval', 'memory', 'introspection'],
  },
  scheduled_recheck: {
    notion: ['read'],
    gbrain: ['read'],
    app: ['attention', 'continuation', 'delivery', 'approval', 'introspection'],
  },
  closure_processing: {
    notion: ['read'],
    gbrain: ['read'],
    app: ['memory', 'introspection'],
  },
  daily_control: {
    notion: ['read'],
    gbrain: [],
    app: ['delivery', 'approval_view', 'introspection'],
  },
  weekly_control_review: {
    notion: ['read'],
    gbrain: ['read'],
    app: ['attention', 'delivery', 'approval', 'introspection'],
  },
  strategic_review: {
    notion: ['read'],
    gbrain: ['read'],
    app: ['attention', 'delivery', 'approval', 'introspection'],
  },
  deep_review: { notion: ['read'], gbrain: ['read'], app: ['delivery', 'introspection'] },
  dialogue: {
    notion: ['read'],
    gbrain: ['read'],
    app: [
      'attention',
      'capture',
      'continuation',
      'delivery',
      'approval',
      'memory',
      'introspection',
    ],
  },
};

/**
 * The App tools of a chat session, listed as capabilities, not bundles: `approval_decide` and
 * `capture_park` are withheld from runs, have no bundles and belong to the chat. The chat does not
 * see `comment_write` (the person's voice is the Notion MCP) or `approval_propose` (a proposal
 * from the chat stays an Inbox item). See `contracts/canonical.yaml`, key `chat_toolset`.
 */
export const CHAT_TOOLSET: { readonly app: readonly string[] } = {
  app: [
    'capture_convert',
    'capture_park',
    'capture_close',
    'continuation_write',
    'continuation_read',
    'delivery_write',
    'delivery_read',
    'approval_read',
    'approval_decide',
    'runtime_read',
    'schema_read',
    'memory_record',
  ],
};

/** Returns the names of the App tools the chat session sees. */
export function chatTools(): string[] {
  const { capabilities } = MCP_TOOLSETS.app;

  return CHAT_TOOLSET.app.flatMap((capability) => {
    const tools = capabilities[capability];

    if (tools === undefined) {
      throw new Error(`the chat toolset names an unknown capability ${capability}`);
    }

    return tools;
  });
}

/**
 * Returns the names of a server bundle's tools; a withheld capability cannot get into a bundle.
 */
export function bundleTools(server: McpServerName, bundle: string): string[] {
  const toolset = MCP_TOOLSETS[server];
  const capabilities = toolset.bundles[bundle];

  if (capabilities === undefined) {
    throw new Error(`${server} has no bundle ${bundle}`);
  }

  return capabilities.flatMap((capability) => {
    if (toolset.withheld.includes(capability)) {
      throw new Error(`${server} bundle ${bundle} grants withheld ${capability}`);
    }

    return toolset.capabilities[capability] ?? [];
  });
}

/** Returns the server's tools that a run of this mode sees, under the server's own names. */
export function serverTools(mode: WorkflowMode, server: McpServerName): string[] {
  return [...new Set(MODE_TOOLSETS[mode][server].flatMap((bundle) => bundleTools(server, bundle)))];
}
