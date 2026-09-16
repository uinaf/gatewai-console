import { Effect } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

// Better Stack heartbeat semantics: POST `<url>/fail` opens an incident (the
// body becomes its output), POST `<url>` resolves it. One heartbeat per rule.

export const deliver = (heartbeat: string, firing: boolean, detail: string) =>
	Effect.gen(function* () {
		const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
		const request = firing
			? HttpClientRequest.post(`${heartbeat}/fail`).pipe(HttpClientRequest.bodyText(detail))
			: HttpClientRequest.post(heartbeat);
		yield* client.execute(request).pipe(Effect.timeout("10 seconds"), Effect.scoped);
	});
