import { createRootRoute, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Fault } from "#/components/pools/fault";
import { Shell } from "#/components/shell";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ name: "robots", content: "noindex, nofollow" },
			{ name: "color-scheme", content: "dark" },
			{ title: "gatewai-console" },
		],
		links: [
			{ rel: "preconnect", href: "https://cdn.uinaf.dev", crossOrigin: "anonymous" },
			{ rel: "stylesheet", href: appCss },
			{
				rel: "icon",
				type: "image/webp",
				href: "https://cdn.uinaf.dev/images/webp/uinaf-computer-favicon-256w.webp",
			},
		],
	}),
	component: Outlet,
	// Neither boundary has loader data, so the topbar shows a placeholder host.
	errorComponent: ({ error, reset }) => (
		<Shell host="—" operator={null} title="error">
			<Fault
				reason="render"
				message={error instanceof Error ? error.message : String(error)}
				host="—"
				onRetry={reset}
			/>
		</Shell>
	),
	notFoundComponent: () => (
		<Shell host="—" operator={null} title="not found">
			<p className="u-meta">
				no such page. <Link to="/">pools →</Link>
			</p>
		</Shell>
	),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body className="uinaf">
				{children}
				<Scripts />
			</body>
		</html>
	);
}
