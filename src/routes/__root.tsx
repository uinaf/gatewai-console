import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";

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
	component: RootComponent,
	shellComponent: RootDocument,
});

function RootComponent() {
	return (
		<div className="console-shell">
			<header className="u-topbar">
				<div className="u-shell-wide u-topbar-row">
					<a className="u-topbar-mark" href="/" aria-label="home">
						<img src="https://cdn.uinaf.dev/images/uinaf-computer.png" alt="" />
					</a>
					<nav className="u-topbar-nav">
						<a href="/" aria-current="page">
							gatewai-console
						</a>
					</nav>
				</div>
			</header>
			<main className="u-shell-wide console-main">
				<Outlet />
			</main>
		</div>
	);
}

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
