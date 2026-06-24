import pkg from '../package.json' with { type: 'json' };

/** MCP server / client version — kept in sync with package.json. */
export const PACKAGE_VERSION = pkg.version;
