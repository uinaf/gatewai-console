import { readFileSync } from "node:fs";

import { Config, Context, Effect, Layer, Redacted, Schedule, Schema, flow } from "effect";
import {
	FetchHttpClient,
	HttpClient,
	HttpClientError,
	HttpClientRequest,
	HttpClientResponse,
} from "effect/unstable/http";

import { type Pools, poolsOf } from "#/server/management/credential";
import {
	ApiKeys,
	AuthFiles,
	LatestVersion,
	PatchFieldsResponse,
	ProxyConfig,
	RefreshResponse,
	ResetQuotaResponse,
	UsageQueue,
	type UsageRecord,
} from "#/server/management/schema";

// The only module that knows the CLIProxyAPI management API. Reasons map to the
// fault screens: unreachable, unauthorized, and mismatch (a body the schema no
// longer recognises).
export class ManagementError extends Schema.TaggedError<ManagementError>()("ManagementError", {
	reason: Schema.Literals(["unreachable", "unauthorized", "status", "mismatch"]),
	message: Schema.String,
	cause: Schema.Defect(),
}) {}

const BaseUrl = Config.String("GATEWAI_MANAGEMENT_URL").pipe(
	Config.withDefault("http://127.0.0.1:8317/v0/management"),
);

// The key comes from the environment in development and from a mounted secret
// file in production. It stays `Redacted` so it never prints.
const ManagementKey = Config.Redacted("GATEWAI_MANAGEMENT_KEY").pipe(
	Config.orElse(() =>
		Config.String("GATEWAI_MANAGEMENT_KEY_FILE").pipe(
			Config.map((file) => Redacted.make(readFileSync(file, "utf8").trim())),
		),
	),
);

const toManagementError = (error: HttpClientError.HttpClientError | Schema.SchemaError) => {
	if (Schema.isSchemaError(error)) {
		return new ManagementError({ reason: "mismatch", message: error.message, cause: error });
	}
	const reason = error.reason;
	if (reason._tag === "StatusCodeError") {
		const status = reason.response.status;
		return new ManagementError({
			reason: status === 401 || status === 403 ? "unauthorized" : "status",
			message: `${status} ${reason.request.method} ${reason.request.url}`,
			cause: error,
		});
	}
	if (reason._tag === "DecodeError" || reason._tag === "EmptyBodyError") {
		return new ManagementError({ reason: "mismatch", message: error.message, cause: error });
	}
	return new ManagementError({ reason: "unreachable", message: error.message, cause: error });
};

export class ManagementApi extends Context.Service<
	ManagementApi,
	{
		readonly authFiles: Effect.Effect<AuthFiles, ManagementError>;
		readonly pools: Effect.Effect<Pools, ManagementError>;
		popUsage(count: number): Effect.Effect<ReadonlyArray<UsageRecord>, ManagementError>;
		readonly apiKeys: Effect.Effect<ReadonlyArray<string>, ManagementError>;
		readonly config: Effect.Effect<ProxyConfig, ManagementError>;
		readonly latestVersion: Effect.Effect<string, ManagementError>;
		resetQuota(authIndex: string): Effect.Effect<ResetQuotaResponse, ManagementError>;
		refresh(name: string): Effect.Effect<void, ManagementError>;
		patchFields(
			name: string,
			fields: Record<string, unknown>,
		): Effect.Effect<void, ManagementError>;
	}
>()("gatewai-console/server/management/ManagementApi") {
	static readonly layerNoDeps = Layer.effect(
		ManagementApi,
		Effect.gen(function* () {
			const baseUrl = yield* BaseUrl;
			const key = yield* ManagementKey;

			// `usage-queue` pops on read, so that client never retries.
			const once = (yield* HttpClient.HttpClient).pipe(
				HttpClient.mapRequest(
					flow(
						HttpClientRequest.prependUrl(baseUrl),
						HttpClientRequest.bearerToken(key),
						HttpClientRequest.acceptJson,
					),
				),
				HttpClient.filterStatusOk,
			);
			const client = once.pipe(
				HttpClient.retryTransient({ schedule: Schedule.exponential(200), times: 2 }),
			);

			const decodeWith =
				<S extends Schema.Top>(schema: S) =>
				<E extends HttpClientError.HttpClientError, R>(
					response: Effect.Effect<HttpClientResponse.HttpClientResponse, E, R>,
				) =>
					response.pipe(
						Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
						Effect.mapError(toManagementError),
					);

			const authFiles = client
				.get("/auth-files")
				.pipe(decodeWith(AuthFiles), Effect.withSpan("ManagementApi.authFiles"));

			const popUsage = Effect.fn("ManagementApi.popUsage")((count: number) =>
				once
					.get("/usage-queue", { urlParams: { count: String(count) } })
					.pipe(decodeWith(UsageQueue)),
			);

			const resetQuota = Effect.fn("ManagementApi.resetQuota")((authIndex: string) =>
				HttpClientRequest.post("/reset-quota").pipe(
					HttpClientRequest.bodyJsonUnsafe({ auth_index: authIndex }),
					once.execute,
					decodeWith(ResetQuotaResponse),
				),
			);

			const refresh = Effect.fn("ManagementApi.refresh")((name: string) =>
				HttpClientRequest.post("/auth-files/refresh").pipe(
					HttpClientRequest.bodyJsonUnsafe({ name }),
					once.execute,
					decodeWith(RefreshResponse),
					Effect.asVoid,
				),
			);

			const patchFields = Effect.fn("ManagementApi.patchFields")(
				(name: string, fields: Record<string, unknown>) =>
					HttpClientRequest.patch("/auth-files/fields").pipe(
						HttpClientRequest.bodyJsonUnsafe({ name, ...fields }),
						once.execute,
						decodeWith(PatchFieldsResponse),
						Effect.asVoid,
					),
			);

			return ManagementApi.of({
				authFiles,
				pools: Effect.map(authFiles, poolsOf),
				popUsage,
				apiKeys: client.get("/api-keys").pipe(
					decodeWith(ApiKeys),
					Effect.map((body) => body["api-keys"]),
				),
				config: client.get("/config").pipe(decodeWith(ProxyConfig)),
				latestVersion: client.get("/latest-version").pipe(
					decodeWith(LatestVersion),
					Effect.map((body) => body["latest-version"]),
				),
				resetQuota,
				refresh,
				patchFields,
			});
		}),
	);

	static readonly layer = this.layerNoDeps.pipe(Layer.provide(FetchHttpClient.layer));
}
