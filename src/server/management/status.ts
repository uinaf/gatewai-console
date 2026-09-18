// Gateway status_message is often a provider JSON blob. Classify it at the
// boundary so the UI never renders request ids or nested type keys.

export type StatusKind = "limited" | "auth" | "overloaded" | "error";

export interface ClassifiedStatus {
	readonly kind: StatusKind;
	readonly message: string;
}

const sentence = (value: string): string => {
	const text = value.trim().replace(/\s+/g, " ");
	if (!text) return "gateway reports an error.";
	const lowered = text.charAt(0).toLowerCase() + text.slice(1);
	return /[.!?]$/.test(lowered) ? lowered : `${lowered}.`;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;

const textOf = (value: unknown): string | null =>
	typeof value === "string" && value.trim() ? value.trim() : null;

const unwrap = (value: unknown): { type: string | null; message: string | null } => {
	const record = asRecord(value);
	if (!record) return { type: null, message: null };
	const nested = unwrap(record.error);
	return {
		type: nested.type ?? textOf(record.type),
		message: nested.message ?? textOf(record.message),
	};
};

const parse = (raw: string): unknown => {
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
};

const isRateLimit = (type: string | null, message: string | null, raw: string): boolean => {
	const hay = `${type ?? ""} ${message ?? ""} ${raw}`.toLowerCase();
	return hay.includes("rate_limit") || hay.includes("rate limited") || /\b429\b/.test(hay);
};

const isAuth = (type: string | null, message: string | null): boolean => {
	const hay = `${type ?? ""} ${message ?? ""}`.toLowerCase();
	return (
		hay.includes("authentication") ||
		hay.includes("permission") ||
		hay.includes("unauthorized") ||
		hay.includes("invalid_api_key") ||
		hay.includes("invalid x-api-key")
	);
};

const isOverloaded = (type: string | null, message: string | null): boolean => {
	const hay = `${type ?? ""} ${message ?? ""}`.toLowerCase();
	return hay.includes("overloaded");
};

const FALLBACK: ClassifiedStatus = { kind: "error", message: "gateway reports an error." };

/** Fold a proxy status_message into a kind and a short operator line. */
export const classifyStatus = (raw: string | null | undefined): ClassifiedStatus => {
	const text = raw?.trim() ?? "";
	if (!text) return FALLBACK;
	const parsed = parse(text);
	const { type, message } = unwrap(parsed ?? text);
	if (isRateLimit(type, message, text)) return { kind: "limited", message: "rate limited." };
	if (isAuth(type, message)) return { kind: "auth", message: "auth failed." };
	if (isOverloaded(type, message)) return { kind: "overloaded", message: "provider overloaded." };
	if (message && !message.includes("{") && message.length <= 80) {
		return { kind: "error", message: sentence(message) };
	}
	if (!parsed && text.length <= 80 && !text.includes("{")) {
		return { kind: "error", message: sentence(text) };
	}
	return FALLBACK;
};
