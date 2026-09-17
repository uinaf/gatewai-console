import { useRouter } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";

// The URL fragment never reaches the server, so the server snapshot is empty and
// the client value arrives after hydration; router navigations do not fire
// `hashchange`, so the store follows the router's own resolved location.
export const useHash = (): string => {
	const router = useRouter();
	return useSyncExternalStore(
		(listener) => router.subscribe("onResolved", listener),
		() => router.state.location.hash,
		() => "",
	);
};
