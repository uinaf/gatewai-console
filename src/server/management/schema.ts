import { Schema } from "effect";

// Wire shapes of the CLIProxyAPI management API, verified against v7.3.4.
// Structs drop unknown keys on decode, so token material in `auth-files` never
// leaves this boundary.

const Signals = Schema.Record(Schema.String, Schema.String);

const QuotaSnapshot = Schema.Struct({
	observed_at: Schema.optionalKey(Schema.String),
	signals: Schema.optionalKey(Signals),
});

const Cooldown = Schema.Struct({
	scope: Schema.optionalKey(Schema.String),
	model_key: Schema.optionalKey(Schema.String),
	reason: Schema.optionalKey(Schema.String),
	retry_at: Schema.optionalKey(Schema.String),
	remaining_seconds: Schema.optionalKey(Schema.Number),
	http_status: Schema.optionalKey(Schema.Number),
});

const RequestBucket = Schema.Struct({
	time: Schema.String,
	success: Schema.Number,
	failed: Schema.Number,
});

export const AuthFile = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	auth_index: Schema.String,
	provider: Schema.String,
	label: Schema.optionalKey(Schema.String),
	email: Schema.optionalKey(Schema.String),
	account_type: Schema.optionalKey(Schema.String),
	status: Schema.String,
	status_message: Schema.optionalKey(Schema.String),
	disabled: Schema.Boolean,
	unavailable: Schema.optionalKey(Schema.Boolean),
	cooldowns: Schema.optionalKey(Schema.NullOr(Schema.Array(Cooldown))),
	success: Schema.optionalKey(Schema.Number),
	failed: Schema.optionalKey(Schema.Number),
	last_refresh: Schema.optionalKey(Schema.String),
	recent_requests: Schema.optionalKey(Schema.NullOr(Schema.Array(RequestBucket))),
	quota: Schema.optionalKey(QuotaSnapshot),
	model_quotas: Schema.optionalKey(Schema.NullOr(Schema.Record(Schema.String, QuotaSnapshot))),
	websockets: Schema.optionalKey(Schema.Boolean),
});
export type AuthFile = typeof AuthFile.Type;

export const AuthFiles = Schema.Struct({
	observed_at: Schema.optionalKey(Schema.String),
	files: Schema.Array(AuthFile),
});
export type AuthFiles = typeof AuthFiles.Type;

const TokenBreakdown = Schema.Struct({
	total_tokens: Schema.optionalKey(Schema.Number),
	input: Schema.optionalKey(
		Schema.Struct({
			total_tokens: Schema.optionalKey(Schema.Number),
			uncached_tokens: Schema.optionalKey(Schema.Number),
			cache_read_tokens: Schema.optionalKey(Schema.Number),
			cache_write_tokens: Schema.optionalKey(Schema.Number),
		}),
	),
	output: Schema.optionalKey(
		Schema.Struct({
			total_tokens: Schema.optionalKey(Schema.Number),
			reasoning_tokens: Schema.optionalKey(Schema.Number),
		}),
	),
});

// One record per proxied request. `GET /usage-queue?count=N` removes what it returns.
export const UsageRecord = Schema.Struct({
	request_id: Schema.optionalKey(Schema.String),
	timestamp: Schema.String,
	api_key: Schema.optionalKey(Schema.String),
	auth_index: Schema.optionalKey(Schema.String),
	source: Schema.optionalKey(Schema.String),
	provider: Schema.String,
	model: Schema.String,
	alias: Schema.optionalKey(Schema.String),
	stream: Schema.optionalKey(Schema.Boolean),
	failed: Schema.optionalKey(Schema.Boolean),
	latency_ms: Schema.optionalKey(Schema.Number),
	ttft_ms: Schema.optionalKey(Schema.Number),
	token_breakdown: Schema.optionalKey(TokenBreakdown),
	reasoning_effort: Schema.optionalKey(Schema.String),
	service_tier: Schema.optionalKey(Schema.String),
	user_agent: Schema.optionalKey(Schema.String),
	client_ip: Schema.optionalKey(Schema.String),
	response_headers: Schema.optionalKey(Schema.Record(Schema.String, Schema.Array(Schema.String))),
});
export type UsageRecord = typeof UsageRecord.Type;

// Records are decoded one by one after the pop; see `ManagementApi.popUsage`.
export const UsageQueue = Schema.Array(Schema.Unknown);

export const ApiKeys = Schema.Struct({ "api-keys": Schema.Array(Schema.String) });

export const LatestVersion = Schema.Struct({ "latest-version": Schema.String });

// `/config` is large and mostly irrelevant; keep the keys the console reads.
export const ProxyConfig = Schema.Struct({
	"commercial-mode": Schema.optionalKey(Schema.Boolean),
	"request-log": Schema.optionalKey(Schema.Boolean),
	"api-keys": Schema.optionalKey(Schema.Array(Schema.String)),
});
export type ProxyConfig = typeof ProxyConfig.Type;

export const ResetQuotaResponse = Schema.Struct({
	status: Schema.String,
	auth_index: Schema.optionalKey(Schema.String),
	models: Schema.optionalKey(Schema.Unknown),
});
export type ResetQuotaResponse = typeof ResetQuotaResponse.Type;

export const RefreshResponse = Schema.Struct({
	ok: Schema.Boolean,
	error: Schema.optionalKey(Schema.String),
});

export const PatchFieldsResponse = Schema.Struct({ status: Schema.String });
