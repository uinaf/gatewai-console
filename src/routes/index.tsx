import { createFileRoute, Link } from "@tanstack/react-router";

import { CredentialCard } from "#/components/pools/card";
import { Fault } from "#/components/pools/fault";
import { credentialAnchor } from "#/components/pools/format";
import { Stats } from "#/components/pools/stats";
import { Shell } from "#/components/shell";
import { loadPools } from "#/functions/pools";
import { useAutoRefresh } from "#/hooks/use-auto-refresh";
import { useHash } from "#/hooks/use-hash";
import { useNow } from "#/hooks/use-now";
import {
	type Credential,
	primaryWindow,
	requestsLastHour,
	summarize,
} from "#/server/management/credential";

const SORTS = ["remaining", "name", "requests"] as const;
type Sort = (typeof SORTS)[number];

type Dir = "asc" | "desc";

interface Search {
	readonly provider?: string;
	readonly sort?: Sort;
	readonly dir?: Dir;
}

// The natural direction per key; the search param carries only a flip.
const DEFAULT_DIR: Record<Sort, Dir> = { remaining: "asc", name: "asc", requests: "desc" };

const REFRESH_MS = 30_000;

export const Route = createFileRoute("/")({
	validateSearch: (search: Record<string, unknown>): Search => ({
		...(typeof search.provider === "string" && search.provider !== "all"
			? { provider: search.provider }
			: {}),
		...(SORTS.includes(search.sort as Sort) && search.sort !== "remaining"
			? { sort: search.sort as Sort }
			: {}),
		...(search.dir === "asc" || search.dir === "desc" ? { dir: search.dir } : {}),
	}),
	loader: () => loadPools(),
	component: PoolsPage,
});

const remaining = (credential: Credential) => {
	const window = primaryWindow(credential);
	return window ? 100 - window.usedPercent : Number.POSITIVE_INFINITY;
};

const comparators: Record<Sort, (a: Credential, b: Credential) => number> = {
	remaining: (a, b) => remaining(a) - remaining(b) || a.label.localeCompare(b.label),
	name: (a, b) => a.label.localeCompare(b.label),
	requests: (a, b) => requestsLastHour(a) - requestsLastHour(b) || a.label.localeCompare(b.label),
};

function PoolsPage() {
	const view = Route.useLoaderData();
	const search = Route.useSearch();
	const now = useNow(Date.parse(view.fetchedAt));
	// Client-side navigation does not re-evaluate `:target`, so the landed card is marked from the hash.
	const hash = useHash();
	useAutoRefresh(REFRESH_MS);

	const sort: Sort = search.sort ?? "remaining";
	const dir: Dir = search.dir ?? DEFAULT_DIR[sort];
	const stamp = {
		observedAt: view.result.ok ? view.result.pools.observedAt : null,
		serverNow: now,
	};

	if (!view.result.ok) {
		return (
			<Shell host={view.host} operator={view.operator} stamp={stamp} title="pools">
				<Fault reason={view.result.reason} message={view.result.message} host={view.host} />
			</Shell>
		);
	}

	const { credentials } = view.result.pools;
	const providers = ["all", ...new Set(credentials.map((credential) => credential.provider))];
	const active = search.provider ?? "all";
	const shown = credentials
		.filter((credential) => active === "all" || credential.provider === active)
		.sort((a, b) => (dir === "asc" ? 1 : -1) * comparators[sort](a, b));

	return (
		<Shell host={view.host} operator={view.operator} stamp={stamp} title="pools">
			<Stats summaries={summarize(credentials)} now={now} />

			<div className="u-toolbar pools-toolbar">
				<nav className="u-segmented" aria-label="provider">
					{providers.map((provider) => (
						<Link
							key={provider}
							to="/"
							search={(prev) => ({ ...prev, provider: provider === "all" ? undefined : provider })}
							aria-current={active === provider ? "true" : undefined}
						>
							{provider}
						</Link>
					))}
				</nav>
				<nav className="u-segmented pools-sort" aria-label="sort">
					{SORTS.map((key) => {
						const active = key === sort;
						// Clicking the active key flips it; a flip back to the natural direction drops the param.
						const next: Dir = active ? (dir === "asc" ? "desc" : "asc") : DEFAULT_DIR[key];
						return (
							<Link
								key={key}
								to="/"
								search={(prev) => ({
									...prev,
									sort: key === "remaining" ? undefined : key,
									dir: next === DEFAULT_DIR[key] ? undefined : next,
								})}
								aria-current={active ? "true" : undefined}
								aria-label={`sort by ${key}, ${next}ending`}
							>
								{key}
								{active ? (
									<span className="sort-dir" aria-hidden="true">
										{dir === "asc" ? "↑" : "↓"}
									</span>
								) : null}
							</Link>
						);
					})}
				</nav>
			</div>

			{shown.length === 0 ? (
				<p className="u-meta pools-empty">no credentials for {active}.</p>
			) : (
				<div className="cards">
					{shown.map((credential) => (
						<CredentialCard
							key={credential.name}
							credential={credential}
							now={now}
							landed={credentialAnchor(credential.name) === hash}
						/>
					))}
				</div>
			)}
		</Shell>
	);
}
