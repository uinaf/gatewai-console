import { readFileSync } from "node:fs";

import {
	Cause,
	Config,
	ConfigProvider,
	Context,
	Duration,
	Effect,
	Layer,
	Redacted,
	Schedule,
	Schema,
	flow,
} from "effect";
import {
	FetchHttpClient,
	HttpClient,
	HttpClientError,
	HttpClientRequest,
	HttpClientResponse,
} from "effect/unstable/http";

import {
	CLAUDE_HEADERS,
	CLAUDE_USAGE_URL,
	ClaudeUsage,
	withClaudeUsage,
} from "#/server/management/claude";
import {
	CODEX_USAGE_URL,
	CodexUsage,
	codexHeaders,
	withCodexUsage,
} from "#/server/management/codex";
import { type Pools, poolsOf } from "#/server/management/credential";
import {
	XAI_BILLING_URL,
	XAI_HEADERS,
	XaiBilling,
	type XaiBillingConfig,
	withXaiBilling,
} from "#/server/management/xai";
import {
	ApiKeys,
	AuthFiles,
	LatestVersion,
	PatchFieldsResponse,
	ProxyConfig,
	RefreshResponse,
	ResetQuotaResponse,
	UsageQueue,
	UsageRecord,
} from "#/server/management/schema";

// `POST /api-call`: the proxy performs the request with the credential's own
// token substituted for `$TOKEN$`. The body comes back as a string.
const ApiCallResponse = Schema.Struct({ status_code: Schema.Number, body: Schema.String });
const decodeXaiBilling = Schema.decodeUnknownOption(XaiBilling);
const decodeCodexUsage = Schema.decodeUnknownOption(CodexUsage);
const decodeClaudeUsage = Schema.decodeUnknownOption(ClaudeUsage);

const decodeUsageRecord = Schema.decodeUnknownResult(UsageRecord);

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

const RequestTimeout = Config.Duration("GATEWAI_MANAGEMENT_TIMEOUT").pipe(
	Config.withDefault(Duration.seconds(10)),
);

// The key comes from the environment in development and from a mounted secret
// file in production. It stays `Redacted` so it never prints.
const KeySource = Config.Redacted("GATEWAI_MANAGEMENT_KEY").pipe(
	Config.map((key) => ({ kind: "inline" as const, key })),
	Config.orElse(() =>
		Config.String("GATEWAI_MANAGEMENT_KEY_FILE").pipe(
			Config.map((file) => ({ kind: "file" as const, file })),
		),
	),
);

const notConfigured = (message: string) => (cause: unknown) =>
	new ManagementError({ reason: "unauthorized", message, cause });

const ManagementKey = KeySource.pipe(
	Effect.mapError(notConfigured("management key is not configured")),
	Effect.flatMap((source) =>
		source.kind === "inline"
			? Effect.succeed(source.key)
			: Effect.try({
					try: () => Redacted.make(readFileSync(source.file, "utf8").trim()),
					catch: notConfigured("management key file could not be read"),
				}),
	),
);

// Config is read per call, not at layer build, so a missing key surfaces as an
// `unauthorized` fault on management calls only and never stops the runtime.
const settings = Effect.all({
	baseUrl: BaseUrl.pipe(Effect.mapError(notConfigured("management url is not configured"))),
	key: ManagementKey,
	timeout: RequestTimeout.pipe(
		Effect.mapError(notConfigured("management timeout is not a duration")),
	),
});

// Schema failures can quote the offending body, which for `auth-files` is token
// material, so messages stay fixed and the detail lives only in `cause`.
const toManagementError = (
	error: HttpClientError.HttpClientError | Schema.SchemaError | Cause.TimeoutError,
) => {
	if (Schema.isSchemaError(error)) {
		return new ManagementError({
			reason: "mismatch",
			message: "response did not match the expected shape",
			cause: error,
		});
	}
	if (Cause.isTimeoutError(error)) {
		return new ManagementError({
			reason: "unreachable",
			message: "request timed out",
			cause: error,
		});
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
		return new ManagementError({
			reason: "mismatch",
			message: "response body could not be decoded",
			cause: error,
		});
	}
	return new ManagementError({ reason: "unreachable", message: error.message, cause: error });
};

const decodeWith =
	<S extends Schema.Top>(schema: S) =>
	<E extends HttpClientError.HttpClientError | Cause.TimeoutError, R>(
		response: Effect.Effect<HttpClientResponse.HttpClientResponse, E, R>,
	) =>
		response.pipe(
			Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
			Effect.mapError(toManagementError),
		);

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
			const http = yield* HttpClient.HttpClient;
			// The provider is captured here so per-call reads see the same source the
			// layer was built with (tests inject one; production reads the env).
			const provider = yield* ConfigProvider.ConfigProvider;

			// `once` never retries: `usage-queue` pops on read and actions are not
			// idempotent. `retrying` wraps it for plain reads.
			const clients = Effect.map(
				Effect.provideService(settings, ConfigProvider.ConfigProvider, provider),
				({ baseUrl, key, timeout }) => {
					const once = http.pipe(
						HttpClient.mapRequest(
							flow(
								HttpClientRequest.prependUrl(baseUrl),
								HttpClientRequest.bearerToken(key),
								HttpClientRequest.acceptJson,
							),
						),
						HttpClient.transformResponse(Effect.timeout(timeout)),
						HttpClient.filterStatusOk,
					);
					const retrying = once.pipe(
						HttpClient.retryTransient({ schedule: Schedule.exponential(200), times: 2 }),
					);
					return { once, retrying };
				},
			);
			type Clients = Effect.Success<typeof clients>;

			const read = <A>(use: (client: Clients["retrying"]) => Effect.Effect<A, ManagementError>) =>
				Effect.flatMap(clients, ({ retrying }) => use(retrying));
			const consume = <A>(use: (client: Clients["once"]) => Effect.Effect<A, ManagementError>) =>
				Effect.flatMap(clients, ({ once }) => use(once));

			const authFiles = read((client) =>
				client.get("/auth-files").pipe(decodeWith(AuthFiles)),
			).pipe(Effect.withSpan("ManagementApi.authFiles"));

			// Popping is destructive, so one malformed record must not discard the
			// batch: decode each record and log what was dropped.
			const popUsage = Effect.fn("ManagementApi.popUsage")((count: number) =>
				consume((client) =>
					client.get("/usage-queue", { urlParams: { count: String(count) } }).pipe(
						decodeWith(UsageQueue),
						Effect.flatMap((records) => {
							const kept: Array<UsageRecord> = [];
							let dropped = 0;
							for (const record of records) {
								const result = decodeUsageRecord(record);
								if (result._tag === "Success") kept.push(result.success);
								else dropped += 1;
							}
							return dropped === 0
								? Effect.succeed(kept)
								: Effect.logWarning("usage-queue: dropped records", dropped).pipe(Effect.as(kept));
						}),
					),
				),
			);

			const resetQuota = Effect.fn("ManagementApi.resetQuota")((authIndex: string) =>
				consume((client) =>
					HttpClientRequest.post("/reset-quota").pipe(
						HttpClientRequest.bodyJsonUnsafe({ auth_index: authIndex }),
						client.execute,
						decodeWith(ResetQuotaResponse),
					),
				),
			);

			const refresh = Effect.fn("ManagementApi.refresh")((name: string) =>
				consume((client) =>
					HttpClientRequest.post("/auth-files/refresh").pipe(
						HttpClientRequest.bodyJsonUnsafe({ name }),
						client.execute,
						decodeWith(RefreshResponse),
						Effect.flatMap((body) =>
							body.ok
								? Effect.void
								: Effect.fail(
										new ManagementError({
											reason: "status",
											message: "refresh reported failure",
											cause: body,
										}),
									),
						),
					),
				),
			);

			const patchFields = Effect.fn("ManagementApi.patchFields")(
				(name: string, fields: Record<string, unknown>) =>
					consume((client) =>
						HttpClientRequest.patch("/auth-files/fields").pipe(
							HttpClientRequest.bodyJsonUnsafe({ name, ...fields }),
							client.execute,
							decodeWith(PatchFieldsResponse),
							Effect.asVoid,
						),
					),
			);

			// Anthropic 429s oauth usage if we poll it every snapshot. One cached
			// read per credential is shared by the collector and the pools page.
			const live = new Map<string, Effect.Effect<unknown>>();

			const apiCall = <A>(
				name: string,
				authIndex: string,
				url: string,
				header: Readonly<Record<string, string>>,
				decode: (body: unknown) => { _tag: "Some"; value: A } | { _tag: "None" },
			): Effect.Effect<A | undefined> => {
				const key = `${name}:${authIndex}`;
				return Effect.gen(function* () {
					let cached = live.get(key) as Effect.Effect<A | undefined> | undefined;
					if (!cached) {
						const task = read((client) =>
							HttpClientRequest.post("/api-call").pipe(
								HttpClientRequest.bodyJsonUnsafe({
									auth_index: authIndex,
									method: "GET",
									url,
									header,
								}),
								client.execute,
								decodeWith(ApiCallResponse),
							),
						).pipe(
							Effect.tap((reply) =>
								reply.status_code === 429 ? Effect.logWarning(`${name} rate limited`) : Effect.void,
							),
							Effect.map((reply): A | undefined => {
								if (reply.status_code < 200 || reply.status_code >= 300) return undefined;
								try {
									const parsed = decode(JSON.parse(reply.body));
									return parsed._tag === "Some" ? parsed.value : undefined;
								} catch {
									return undefined;
								}
							}),
							Effect.catch((error) =>
								Effect.logWarning(`${name} unavailable`, error.message).pipe(
									Effect.as(undefined as A | undefined),
								),
							),
						);
						cached = yield* Effect.cachedWithTTL(task, Duration.minutes(5));
						live.set(key, cached);
					}
					return yield* cached;
				}).pipe(Effect.withSpan(`ManagementApi.${name}`));
			};

			const xaiBilling = (authIndex: string) =>
				apiCall("xaiBilling", authIndex, XAI_BILLING_URL, XAI_HEADERS, (body) => {
					const parsed = decodeXaiBilling(body);
					return parsed._tag === "Some"
						? { _tag: "Some", value: parsed.value.config as XaiBillingConfig | undefined }
						: { _tag: "None" };
				});

			const codexUsage = (authIndex: string, accountId: string) =>
				apiCall(
					"codexUsage",
					authIndex,
					CODEX_USAGE_URL,
					codexHeaders(accountId),
					decodeCodexUsage,
				);

			const claudeUsage = (authIndex: string) =>
				apiCall("claudeUsage", authIndex, CLAUDE_USAGE_URL, CLAUDE_HEADERS, decodeClaudeUsage);

			const pools = Effect.gen(function* () {
				const files = yield* authFiles;
				const base = poolsOf(files);
				const observedAt = new Date().toISOString();
				const xai = base.credentials.filter((credential) => credential.provider === "xai");
				const claude = base.credentials.filter((credential) => credential.provider === "claude");
				const codex = files.files.flatMap((file) => {
					const accountId = file.id_token?.chatgpt_account_id;
					return file.provider === "codex" && accountId
						? [{ authIndex: file.auth_index, accountId }]
						: [];
				});
				const [billing, usage, anthropic] = yield* Effect.all(
					[
						Effect.forEach(
							xai,
							(credential) =>
								Effect.map(
									xaiBilling(credential.authIndex),
									(config) => [credential.authIndex, config] as const,
								),
							{ concurrency: 4 },
						),
						Effect.forEach(
							codex,
							({ authIndex, accountId }) =>
								Effect.map(codexUsage(authIndex, accountId), (read) => [authIndex, read] as const),
							{ concurrency: 4 },
						),
						Effect.forEach(
							claude,
							(credential) =>
								Effect.map(
									claudeUsage(credential.authIndex),
									(read) => [credential.authIndex, read] as const,
								),
							{ concurrency: 4 },
						),
					],
					{ concurrency: "unbounded" },
				);
				return withClaudeUsage(
					withCodexUsage(
						withXaiBilling(base, new Map(billing), observedAt),
						new Map(usage),
						observedAt,
					),
					new Map(anthropic),
					observedAt,
				);
			}).pipe(Effect.withSpan("ManagementApi.pools"));

			return ManagementApi.of({
				authFiles,
				pools,
				popUsage,
				apiKeys: read((client) =>
					client.get("/api-keys").pipe(
						decodeWith(ApiKeys),
						Effect.map((body) => body["api-keys"]),
					),
				),
				config: read((client) => client.get("/config").pipe(decodeWith(ProxyConfig))),
				latestVersion: read((client) =>
					client.get("/latest-version").pipe(
						decodeWith(LatestVersion),
						Effect.map((body) => body["latest-version"]),
					),
				),
				resetQuota,
				refresh,
				patchFields,
			});
		}),
	);

	static readonly layer = this.layerNoDeps.pipe(Layer.provide(FetchHttpClient.layer));
}
