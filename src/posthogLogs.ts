import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";

const projectToken = process.env.POSTHOG_PROJECT_TOKEN;
const host = process.env.POSTHOG_HOST;

const loggerProvider =
  projectToken && host
    ? new LoggerProvider({
        resource: resourceFromAttributes({
          "service.name": "island-router-mcp",
          "service.version": "0.5.0",
        }),
        processors: [
          new BatchLogRecordProcessor({
            exporter: new OTLPLogExporter({
              url: `${host.replace(/\/$/, "")}/i/v1/logs`,
              headers: { Authorization: `Bearer ${projectToken}` },
            }),
          }),
        ],
      })
    : undefined;

const posthogLogger = loggerProvider?.getLogger("island-router-mcp-posthog");

export function logMcpLifecycle(event: "mcp_server_starting" | "mcp_server_connected"): void {
  posthogLogger?.emit({
    severityText: "INFO",
    body: event,
    attributes: { event },
  });
}

export async function shutdownPosthogLogs(): Promise<void> {
  await loggerProvider?.shutdown().catch(() => {});
}
