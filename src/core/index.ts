/**
 * Island Router core — shared actions for MCP and AXI CLI.
 * Prefer this layer for new router capabilities; adapt at the surface.
 * MCP progressive discovery lives in actionCatalog.ts.
 */

export { withSession } from "./session.js";
export {
  validateMac,
  validateIp,
  validateSafe,
  validateDomain,
  requireParam,
  validateVlanId,
  validateInterfaceName,
  validateCidr,
  validateDhcpScope,
} from "./validate.js";
export { SYSLOG_LEVEL_NAMES } from "./syslog.js";
export {
  QUERY_ACTIONS,
  type QueryAction,
  type QueryParams,
  dispatchQuery,
  queryStatus,
  queryInterfaces,
  queryNeighbors,
  queryRoutes,
  queryLogs,
  queryConfig,
  queryConfigDiff,
  queryVpns,
  queryDhcpReservations,
  querySpeedtest,
  queryHistory,
  queryNtp,
  queryDnsRedirects,
  queryCommand,
  queryPing,
  queryVlans,
  querySubscribers,
} from "./query.js";
export {
  ACTION_CATALOG,
  ActionCatalogError,
  describeAction,
  formatActionError,
  formatDescribe,
  listActions,
  pickActionParams,
  type ActionErrorPayload,
  type ActionKind,
  type ActionSpec,
  type CompactAction,
  type ListActionsResult,
} from "./actionCatalog.js";
export {
  CONFIGURE_ACTIONS,
  type ConfigureAction,
  type ConfigureParams,
  type CreateVlanOptions,
  dispatchConfigure,
  configAddDhcp,
  configRemoveDhcp,
  configSyslog,
  configRemoveSyslog,
  configHostname,
  configAutoUpdate,
  configUpdate,
  configClearUpdate,
  configLed,
  configTimezone,
  configNtp,
  configAddDnsRedirect,
  configRemoveDnsRedirect,
  configCreateVlan,
  configDeleteVlan,
} from "./configure.js";
