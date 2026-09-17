import { createFileRoute, Link } from "@tanstack/react-router";

import { CredentialCard } from "#/components/pools/card";
import { Fault } from "#/components/pools/fault";
import { Stats } from "#/components/pools/stats";
import { Shell } from "#/components/shell";
import { loadPools } from "#/functions/pools";
import { useAutoRefresh } from "#/hooks/use-auto-refresh";
import { useNow } from "#/hooks/use-now";
import {
	type Credential,
	primaryWindow,
	requestsLastHour,
	summarize,
} from "#/server/management/credential";

const SORTS = ["remaining", "name", "requests"] as const;
type Sort = (typeof SORTS)[number];

interface Search {
	readonly provider?: string;
	readonly sort?: Sort;
}

const REFRESH_MS = 30_000;

export const Route = createFileRoute("/")({
	validateSearch: (search: Record<string, unknown>): Search => ({
		...(typeof search.provider === "string" && search.provider !== "all"
			? { provider: search.provider }
			: {}),
		...(SORTS.includes(search.sort as Sort) && search.sort !== "remaining"
			? { sort: search.sort as Sort }
			: {}),
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
	requests: (a, b) => requestsLastHour(b) - requestsLastHour(a) || a.label.localeCompare(b.label),
};

function PoolsPage() {
	const view = Route.useLoaderData();
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const now = useNow(Date.parse(view.fetchedAt));
	useAutoRefresh(REFRESH_MS);

	const sort: Sort = search.sort ?? "remaining";
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
		.sort(comparators[sort]);

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
				<label className="pools-sort">
					<span className="visually-hidden">sort</span>
					<select
						className="u-select"
						value={sort}
						onChange={(event) =>
							void navigate({
								search: (prev) => ({
									...prev,
									sort:
										event.target.value === "remaining" ? undefined : (event.target.value as Sort),
								}),
							})
						}
					>
						<option value="remaining">remaining ↑</option>
						<option value="name">name</option>
						<option value="requests">requests</option>
					</select>
				</label>
			</div>

			{shown.length === 0 ? (
				<p className="u-meta pools-empty">no credentials for {active}.</p>
			) : (
				<div className="cards">
					{shown.map((credential) => (
						<CredentialCard key={credential.name} credential={credential} now={now} />
					))}
				</div>
			)}
		</Shell>
	);
}
