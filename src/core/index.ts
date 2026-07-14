/**
 * Island Router core — shared actions for MCP and AXI CLI.
 * Prefer this layer for new router capabilities; adapt at the surface.
 */

export { withSession } from "./session.js";
export {
  validateMac,
  validateIp,
  validateSafe,
  validateDomain,
  requireParam,
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
} from "./query.js";
export {
  CONFIGURE_ACTIONS,
  type ConfigureAction,
  type ConfigureParams,
  dispatchConfigure,
  configAddDhcp,
  configRemoveDhcp,
  configSyslog,
  configRemoveSyslog,
  configHostname,
  configAutoUpdate,
  configLed,
  configTimezone,
  configNtp,
  configAddDnsRedirect,
  configRemoveDnsRedirect,
} from "./configure.js";
