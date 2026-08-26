import {
  runWithAtlasRequestGuard,
  type AtlasCallLedger,
} from "./request-guard";

type AtlasModelOperationOptions<T> = {
  installationId: string;
  key: string;
  graphId: string;
  resolveCallLedger: () => Promise<AtlasCallLedger | undefined>;
  operation: () => Promise<T>;
};

export async function runAtlasModelOperation<T>(
  options: AtlasModelOperationOptions<T>,
) {
  const callLedger = await options.resolveCallLedger();
  return runWithAtlasRequestGuard({
    installationId: options.installationId,
    key: options.key,
    graphId: options.graphId,
    consumesAtlasCall: true,
    ...(callLedger ? { atlasCallLedger: callLedger } : {}),
    operation: options.operation,
  });
}
