import { AuthOrchestrationReadScope, EnvironmentHttpApi } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  failEnvironmentScopeRequired,
  requireEnvironmentScope,
} from "../auth/http.ts";
import { CLOUD_CONNECT_SUBJECT } from "../auth/EnvironmentAuth.ts";
import { traceLocalHandlerWork } from "../cloud/traceRelayRequest.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as PullRequestService from "./PullRequestService.ts";

// Large patches benefit from HTTP compression and flow control.
export const layer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "pullRequests",
  Effect.fnUntraced(function* (handlers) {
    const pullRequests = yield* PullRequestService.PullRequestService;
    const serverSettings = yield* ServerSettings.ServerSettingsService;
    return handlers.handle(
      "diff",
      Effect.fn("environment.pullRequests.diff")(function* (args) {
        yield* annotateEnvironmentRequest(args.endpoint.name);
        const principal = yield* requireEnvironmentScope(AuthOrchestrationReadScope);
        if (principal.subject === CLOUD_CONNECT_SUBJECT) {
          const settings = yield* serverSettings.getSettings.pipe(
            Effect.catch((cause) => failEnvironmentInternal("internal_error", cause)),
          );
          if (settings.connectSharedProjects[args.payload.projectId] !== true) {
            return yield* failEnvironmentScopeRequired(AuthOrchestrationReadScope);
          }
        }
        return yield* pullRequests.diff(args.payload).pipe(traceLocalHandlerWork);
      }),
    );
  }),
);
