import { readFileSync } from "node:fs";

import { Config, Effect, Option, Redacted } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

// Email through Cloudflare Email Sending, the same route the gateway hosts
// already use for other notifications: one message when a rule fires and one
// when it clears. Absent configuration means no email, silently.

interface EmailConfig {
	readonly accountId: string;
	readonly token: Redacted.Redacted;
	readonly from: string;
	readonly to: string;
}

const Token = Config.Redacted("CLOUDFLARE_EMAIL_SENDING_API_TOKEN").pipe(
	Config.orElse(() =>
		Config.String("CLOUDFLARE_EMAIL_SENDING_API_TOKEN_FILE").pipe(
			Config.map((file) => Redacted.make(readFileSync(file, "utf8").trim())),
		),
	),
);

const EmailSettings = Config.all({
	accountId: Config.String("CLOUDFLARE_ACCOUNT_ID"),
	token: Token,
	from: Config.String("GATEWAI_ALERT_EMAIL_FROM"),
	to: Config.String("GATEWAI_ALERT_EMAIL_TO"),
}).pipe(Config.option);

export interface Message {
	readonly subject: string;
	readonly text: string;
}

/** Sends one message, or does nothing when email is not configured. Returns whether it sent. */
export const sendEmail = (message: Message) =>
	Effect.gen(function* () {
		const settings = yield* EmailSettings;
		if (Option.isNone(settings)) return false;
		const { accountId, token, from, to }: EmailConfig = settings.value;
		const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
		yield* HttpClientRequest.post(
			`https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`,
		).pipe(
			HttpClientRequest.bearerToken(token),
			HttpClientRequest.bodyJsonUnsafe({ from, to, subject: message.subject, text: message.text }),
			client.execute,
			Effect.timeout("10 seconds"),
			Effect.scoped,
		);
		return true;
	});
